// findSequences.cc – With new high-performance Pixel Check feature
#include <napi.h>
#include <vector>
#include <string>
#include <set>
#include <cstdint>
#include <thread>
#include <cmath>
#include <algorithm>
#include <unordered_map>
#include <atomic>

#include <immintrin.h>

// ---------- Constants ----------
const uint32_t ANY_COLOR_HASH = 0xFFFFFFFF;

// ---------- Structures ----------
struct SearchArea {
    uint32_t x = 0, y = 0, width = 0, height = 0;
    bool active = false;
};

// NEW: Structure for a single point check
struct PixelCheck {
    uint32_t x, y;
    std::string id;
};

struct SequenceDefinition {
    std::string name;
    std::vector<uint32_t> sequenceHashes;
    std::string direction = "horizontal";
    int offsetX = 0, offsetY = 0;
    std::string variant = "primary";
};

struct FirstCandidate {
    int x = 0, y = 0;
    size_t pixelIndex = static_cast<size_t>(-1);
};

struct FoundCoords {
    int x, y;
    bool operator<(const FoundCoords& o) const {
        return y != o.y ? y < o.y : x < o.x;
    }
};

using FirstCandidateMap = std::unordered_map<std::string, std::pair<FirstCandidate, FirstCandidate>>;
using AllCandidateMap   = std::unordered_map<std::string, std::pair<std::set<FoundCoords>, std::set<FoundCoords>>>;
// NEW: Result map for pixel checks
using PixelCheckResultMap = std::unordered_map<std::string, bool>;

struct SearchTask {
    std::string taskName;
    std::unordered_map<uint32_t, std::vector<SequenceDefinition>> firstColorLookup;
    // NEW: Map of color hash to a vector of points to check
    std::unordered_map<uint32_t, std::vector<PixelCheck>> pixelChecks;
    std::vector<std::string> targetNames;
    SearchArea searchArea;
    std::string occurrenceMode = "first";
};

struct WorkerData {
    const uint8_t* bgraData;
    uint32_t bufferWidth, bufferHeight, stride;
    size_t bgraDataLength;
    const std::vector<SearchTask>& tasks;
    FirstCandidateMap* localFirstResults;
    AllCandidateMap* localAllResults;
    std::atomic<uint32_t>* next_row;
};

// ---------- Parsing utilities ----------
uint32_t HexToUint32(const std::string& hex) {
    if (hex.length() > 1 && hex[0] == '#') {
        return std::stoul(hex.substr(1), nullptr, 16);
    }
    return 0;
}

bool ParseColorSequence(Napi::Env env, const Napi::Array& jsSeq, std::vector<uint32_t>& out) {
    out.clear();
    uint32_t len = jsSeq.Length();
    out.reserve(len);
    for (uint32_t i = 0; i < len; ++i) {
        Napi::Value v = jsSeq.Get(i);
        if (v.IsString() && v.As<Napi::String>().Utf8Value() == "any") {
            out.push_back(ANY_COLOR_HASH);
            continue;
        }
        if (!v.IsArray()) return false;
        Napi::Array arr = v.As<Napi::Array>();
        if (arr.Length() != 3) return false;
        uint32_t r = arr.Get(0u).As<Napi::Number>().Uint32Value();
        uint32_t g = arr.Get(1u).As<Napi::Number>().Uint32Value();
        uint32_t b = arr.Get(2u).As<Napi::Number>().Uint32Value();
        out.push_back((r << 16) | (g << 8) | b);
    }
    return true;
}

bool ParseTargetSequences(Napi::Env env,
                          const Napi::Object& jsSequences,
                          std::unordered_map<uint32_t, std::vector<SequenceDefinition>>& firstColorLookup,
                          std::vector<std::string>& targetNames) {
    firstColorLookup.clear();
    targetNames.clear();
    Napi::Array names = jsSequences.GetPropertyNames();
    uint32_t n = names.Length();
    targetNames.reserve(n);
    for (uint32_t i = 0; i < n; ++i) {
        Napi::Value keyVal = names.Get(i);
        if (!keyVal.IsString()) continue;
        std::string name = keyVal.As<Napi::String>().Utf8Value();
        targetNames.emplace_back(name);
        Napi::Object cfg = jsSequences.Get(keyVal).As<Napi::Object>();
        SequenceDefinition def;
        def.name = name;
        def.direction = cfg.Has("direction") ? cfg.Get("direction").As<Napi::String>().Utf8Value() : "horizontal";
        if (cfg.Has("offset")) {
            Napi::Object off = cfg.Get("offset").As<Napi::Object>();
            def.offsetX = off.Has("x") ? off.Get("x").As<Napi::Number>().Int32Value() : 0;
            def.offsetY = off.Has("y") ? off.Get("y").As<Napi::Number>().Int32Value() : 0;
        }
        if (cfg.Has("sequence")) {
            def.variant = "primary";
            if (!ParseColorSequence(env, cfg.Get("sequence").As<Napi::Array>(), def.sequenceHashes)) return false;
            if (!def.sequenceHashes.empty() && def.sequenceHashes[0] != ANY_COLOR_HASH)
                firstColorLookup[def.sequenceHashes[0]].push_back(def);
        }
        if (cfg.Has("backupSequence")) {
            SequenceDefinition back = def;
            back.variant = "backup";
            if (!ParseColorSequence(env, cfg.Get("backupSequence").As<Napi::Array>(), back.sequenceHashes)) return false;
            if (!back.sequenceHashes.empty() && back.sequenceHashes[0] != ANY_COLOR_HASH)
                firstColorLookup[back.sequenceHashes[0]].push_back(back);
        }
    }
    return true;
}

// ---------- Verification & Worker Functions (Unchanged) ----------
void VerifyAndRecordMatch(const WorkerData& data, const SequenceDefinition& seqDef, const SearchTask& task, uint32_t x, uint32_t y) {
    const size_t seqLen = seqDef.sequenceHashes.size();
    if (seqLen == 0) return;
    bool match = true;

    if (seqDef.direction == "horizontal") {
        if (x + seqLen > data.bufferWidth) return;
        for (size_t j = 1; j < seqLen; ++j) {
            uint32_t expectedColor = seqDef.sequenceHashes[j];
            if (expectedColor == ANY_COLOR_HASH) continue;
            size_t nextPixelOffset = (y * data.stride) + ((x + j) * 4);
            if (nextPixelOffset + 2 >= data.bgraDataLength) { match = false; break; }
            uint32_t actualColor = (static_cast<uint32_t>(data.bgraData[nextPixelOffset + 2]) << 16) | (static_cast<uint32_t>(data.bgraData[nextPixelOffset + 1]) << 8) | (static_cast<uint32_t>(data.bgraData[nextPixelOffset]));
            if (actualColor != expectedColor) { match = false; break; }
        }
    } else { // Vertical
        if (y + seqLen > data.bufferHeight) return;
        for (size_t j = 1; j < seqLen; ++j) {
            uint32_t expectedColor = seqDef.sequenceHashes[j];
            if (expectedColor == ANY_COLOR_HASH) continue;
            size_t nextPixelOffset = ((y + j) * data.stride) + (x * 4);
            if (nextPixelOffset + 2 >= data.bgraDataLength) { match = false; break; }
            uint32_t actualColor = (static_cast<uint32_t>(data.bgraData[nextPixelOffset + 2]) << 16) | (static_cast<uint32_t>(data.bgraData[nextPixelOffset + 1]) << 8) | (static_cast<uint32_t>(data.bgraData[nextPixelOffset]));
            if (actualColor != expectedColor) { match = false; break; }
        }
    }

    if (match) {
        size_t currentPixelIndex = y * data.bufferWidth + x;
        int foundX = static_cast<int>(x) + seqDef.offsetX;
        int foundY = static_cast<int>(y) + seqDef.offsetY;
        if (task.occurrenceMode == "first") {
            auto& candidatePair = (*data.localFirstResults)[seqDef.name];
            if (seqDef.variant == "primary") {
                if (candidatePair.first.pixelIndex == static_cast<size_t>(-1) || currentPixelIndex < candidatePair.first.pixelIndex) {
                    candidatePair.first = {foundX, foundY, currentPixelIndex};
                }
            } else {
                if (candidatePair.first.pixelIndex == static_cast<size_t>(-1)) {
                    if (candidatePair.second.pixelIndex == static_cast<size_t>(-1) || currentPixelIndex < candidatePair.second.pixelIndex) {
                        candidatePair.second = {foundX, foundY, currentPixelIndex};
                    }
                }
            }
        } else {
            auto& candidatePair = (*data.localAllResults)[seqDef.name];
            if (seqDef.variant == "primary") candidatePair.first.insert({foundX, foundY});
            else candidatePair.second.insert({foundX, foundY});
        }
    }
}

void FindSequencesWorker(const WorkerData& d) {
    const uint32_t chunk = 16;
    while (true) {
        uint32_t startY = d.next_row->fetch_add(chunk);
        if (startY >= d.bufferHeight) break;
        uint32_t endY = std::min(startY + chunk, d.bufferHeight);

        for (const SearchTask& task : d.tasks) {
            if (task.firstColorLookup.empty()) continue;
            uint32_t taskStartY = std::max(startY, task.searchArea.y);
            uint32_t taskEndY   = std::min(endY, task.searchArea.y + task.searchArea.height);
            uint32_t startX = task.searchArea.x;
            uint32_t endX   = task.searchArea.x + task.searchArea.width;

            for (uint32_t y = taskStartY; y < taskEndY; ++y) {
                const uint8_t* row = d.bgraData + y * d.stride;
                uint32_t x = startX;
                for (; x + 8 <= endX; x += 8) {
                    __m256i chunkVec = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(row + x * 4));
                    for (const auto& [color, seqs] : task.firstColorLookup) {
                        uint32_t r = (color >> 16) & 0xFF;
                        uint32_t g = (color >> 8)  & 0xFF;
                        uint32_t b =  color        & 0xFF;
                        uint32_t target_bgra = (0xFF << 24) | (r << 16) | (g << 8) | b;
                        __m256i target = _mm256_set1_epi32(target_bgra);
                        __m256i cmp    = _mm256_cmpeq_epi32(chunkVec, target);
                        int mask       = _mm256_movemask_ps(_mm256_castsi256_ps(cmp));
                        if (mask) {
                            for (int j = 0; j < 8; ++j) {
                                if (mask & (1 << j)) {
                                    for (const SequenceDefinition& seq : seqs) {
                                        VerifyAndRecordMatch(d, seq, task, x + j, y);
                                    }
                                }
                            }
                        }
                    }
                }
                for (; x < endX; ++x) {
                    const uint8_t* pixel = row + x * 4;
                    uint32_t r = pixel[2], g = pixel[1], b = pixel[0];
                    uint32_t currentColorHash = (r << 16) | (g << 8) | b;
                    auto it = task.firstColorLookup.find(currentColorHash);
                    if (it != task.firstColorLookup.end()) {
                        for (const SequenceDefinition& seq : it->second) {
                            VerifyAndRecordMatch(d, seq, task, x, y);
                        }
                    }
                }
            }
        }
    }
}

// ---------- Async Worker Class ----------
class SearchWorker : public Napi::AsyncWorker {
public:
    SearchWorker(Napi::Promise::Deferred deferred, const Napi::Buffer<uint8_t>& imageBuffer, const Napi::Object& jsSearchTasks, bool isBatch)
        : Napi::AsyncWorker(deferred.Env()), deferred(deferred), isBatchCall(isBatch) {

        bufferRef = Napi::ObjectReference::New(imageBuffer, 1);

        uint8_t* bufferData = imageBuffer.Data();
        if (imageBuffer.Length() < 8) {
            Napi::Error::New(Env(), "Buffer too small for header").ThrowAsJavaScriptException();
            return;
        }
        bufferWidth = *reinterpret_cast<uint32_t*>(bufferData);
        bufferHeight = *reinterpret_cast<uint32_t*>(bufferData + 4);
        bgraData = bufferData + 8;
        bgraDataLength = static_cast<size_t>(bufferWidth) * bufferHeight * 4;
        stride = bufferWidth * 4;

        if (imageBuffer.Length() < bgraDataLength + 8) {
            Napi::Error::New(Env(), "Buffer length does not match dimensions in header").ThrowAsJavaScriptException();
            return;
        }

        Napi::Array names = jsSearchTasks.GetPropertyNames();
        uint32_t n = names.Length();
        tasks.reserve(n);
        for (uint32_t i = 0; i < n; ++i) {
            Napi::Value keyVal = names.Get(i);
            if (!keyVal.IsString()) continue;
            std::string taskName = keyVal.As<Napi::String>().Utf8Value();
            Napi::Object cfg = jsSearchTasks.Get(keyVal).As<Napi::Object>();
            SearchTask task;
            task.taskName = taskName;

            // Parse sequence searches
            if (cfg.Has("sequences")) {
                if (!ParseTargetSequences(Env(), cfg.Get("sequences").As<Napi::Object>(), task.firstColorLookup, task.targetNames)) {
                    Napi::Error::New(Env(), "Failed to parse target sequences for task: " + taskName).ThrowAsJavaScriptException();
                    return;
                }
                task.occurrenceMode = cfg.Get("occurrence").As<Napi::String>().Utf8Value();
            }

            // NEW: Parse pixel checks
            if (cfg.Has("pixelChecks")) {
                Napi::Object checksObj = cfg.Get("pixelChecks").As<Napi::Object>();
                Napi::Array colorKeys = checksObj.GetPropertyNames();
                for (uint32_t j = 0; j < colorKeys.Length(); ++j) {
                    std::string colorHex = colorKeys.Get(j).As<Napi::String>().Utf8Value();
                    uint32_t colorHash = HexToUint32(colorHex);
                    uint32_t r = (colorHash >> 16) & 0xFF;
                    uint32_t g = (colorHash >> 8) & 0xFF;
                    uint32_t b = colorHash & 0xFF;
                    colorHash = (r << 16) | (g << 8) | b; // Ensure RGB order

                    Napi::Array points = checksObj.Get(colorKeys.Get(j)).As<Napi::Array>();
                    std::vector<PixelCheck> checkList;
                    checkList.reserve(points.Length());
                    for (uint32_t k = 0; k < points.Length(); ++k) {
                        Napi::Object point = points.Get(k).As<Napi::Object>();
                        checkList.push_back({
                            point.Get("x").As<Napi::Number>().Uint32Value(),
                            point.Get("y").As<Napi::Number>().Uint32Value(),
                            point.Get("id").As<Napi::String>().Utf8Value()
                        });
                    }
                    task.pixelChecks[colorHash] = checkList;
                }
            }

            Napi::Object areaObj = cfg.Get("searchArea").As<Napi::Object>();
            task.searchArea.x = areaObj.Get("x").As<Napi::Number>().Uint32Value();
            task.searchArea.y = areaObj.Get("y").As<Napi::Number>().Uint32Value();
            task.searchArea.width = areaObj.Get("width").As<Napi::Number>().Uint32Value();
            task.searchArea.height = areaObj.Get("height").As<Napi::Number>().Uint32Value();
            task.searchArea.active = true;
            tasks.emplace_back(std::move(task));
        }
    }

    ~SearchWorker() {}

protected:
    // NEW: Dedicated function for direct pixel checks
    void PerformPixelChecks() {
        for (const auto& task : tasks) {
            if (task.pixelChecks.empty()) continue;

            for (const auto& [colorHash, checks] : task.pixelChecks) {
                for (const auto& check : checks) {
                    if (check.x >= bufferWidth || check.y >= bufferHeight) continue;

                    size_t offset = (check.y * stride) + (check.x * 4);
                    if (offset + 2 >= bgraDataLength) continue;

                    uint32_t actualColor = (static_cast<uint32_t>(bgraData[offset + 2]) << 16) |
                                           (static_cast<uint32_t>(bgraData[offset + 1]) << 8) |
                                           (static_cast<uint32_t>(bgraData[offset]));

                    if (actualColor == colorHash) {
                        mergedPixelCheckResults[task.taskName][check.id] = true;
                    }
                }
            }
        }
    }

    void Execute() override {
        // --- Perform high-speed pixel checks first ---
        PerformPixelChecks();

        // --- Perform sequence searches (if any) using threading ---
        bool hasSequenceSearches = false;
        for(const auto& t : tasks) {
            if (!t.firstColorLookup.empty()) {
                hasSequenceSearches = true;
                break;
            }
        }

        if (hasSequenceSearches) {
            unsigned numThreads = std::min((unsigned)std::thread::hardware_concurrency(), bufferHeight);
            if (!numThreads) numThreads = 1;

            std::vector<FirstCandidateMap> threadFirstResults(numThreads);
            std::vector<AllCandidateMap> threadAllResults(numThreads);
            std::set<std::string> uniqueNames;
            for (const auto& t : tasks) uniqueNames.insert(t.targetNames.begin(), t.targetNames.end());
            for (unsigned i = 0; i < numThreads; ++i) {
                threadFirstResults[i].reserve(uniqueNames.size());
                threadAllResults[i].reserve(uniqueNames.size());
            }

            std::atomic<uint32_t> nextRow(0);
            std::vector<std::thread> threads;
            for (unsigned i = 0; i < numThreads; ++i) {
                threads.emplace_back(FindSequencesWorker, WorkerData{
                    bgraData, bufferWidth, bufferHeight, stride, bgraDataLength,
                    tasks, &threadFirstResults[i], &threadAllResults[i], &nextRow
                });
            }
            for (auto& t : threads) t.join();

            for (const auto& localMap : threadFirstResults) {
                for (const auto& [name, pair] : localMap) {
                    if (mergedFirstResults.find(name) == mergedFirstResults.end()) {
                        mergedFirstResults[name] = pair;
                        continue;
                    }
                    auto& best = mergedFirstResults.at(name);
                    if (pair.first.pixelIndex != static_cast<size_t>(-1) && (best.first.pixelIndex == static_cast<size_t>(-1) || pair.first.pixelIndex < best.first.pixelIndex)) best.first = pair.first;
                    if (best.first.pixelIndex == static_cast<size_t>(-1) && pair.second.pixelIndex != static_cast<size_t>(-1) && (best.second.pixelIndex == static_cast<size_t>(-1) || pair.second.pixelIndex < best.second.pixelIndex)) best.second = pair.second;
                }
            }

            for (const auto& localMap : threadAllResults) {
                for (const auto& [name, pair] : localMap) {
                    mergedAllResults[name].first.insert(pair.first.begin(), pair.first.end());
                    mergedAllResults[name].second.insert(pair.second.begin(), pair.second.end());
                }
            }
        }
    }

    void OnOK() override {
        Napi::Env env = Env();
        Napi::HandleScope scope(env);

        Napi::Object finalResults = Napi::Object::New(env);
        for (const SearchTask& task : tasks) {
            Napi::Object taskResult = Napi::Object::New(env);

            // Add sequence search results
            if (!task.firstColorLookup.empty()) {
                if (task.occurrenceMode == "first") {
                    for (const std::string& name : task.targetNames) {
                        auto it = mergedFirstResults.find(name);
                        if (it == mergedFirstResults.end()) {
                            taskResult.Set(name, env.Null());
                            continue;
                        }
                        const auto& pair = it->second;
                        if (pair.first.pixelIndex != static_cast<size_t>(-1)) {
                            Napi::Object c = Napi::Object::New(env); c.Set("x", pair.first.x); c.Set("y", pair.first.y);
                            taskResult.Set(name, c);
                        } else if (pair.second.pixelIndex != static_cast<size_t>(-1)) {
                            Napi::Object c = Napi::Object::New(env); c.Set("x", pair.second.x); c.Set("y", pair.second.y);
                            taskResult.Set(name, c);
                        } else {
                            taskResult.Set(name, env.Null());
                        }
                    }
                } else { // "all"
                    for (const std::string& name : task.targetNames) {
                        auto it = mergedAllResults.find(name);
                        if (it == mergedAllResults.end()) {
                            taskResult.Set(name, Napi::Array::New(env, 0));
                            continue;
                        }
                        const auto& [pri, bak] = it->second;
                        const auto& resultSet = !pri.empty() ? pri : bak;
                        Napi::Array arr = Napi::Array::New(env, resultSet.size());
                        size_t idx = 0;
                        for (const FoundCoords& fc : resultSet) {
                            Napi::Object c = Napi::Object::New(env); c.Set("x", fc.x); c.Set("y", fc.y);
                            arr[idx++] = c;
                        }
                        taskResult.Set(name, arr);
                    }
                }
            }

            // NEW: Add pixel check results
            auto pixelCheckIt = mergedPixelCheckResults.find(task.taskName);
            if (pixelCheckIt != mergedPixelCheckResults.end()) {
                for (const auto& [id, found] : pixelCheckIt->second) {
                    if (found) {
                        taskResult.Set(id, Napi::Boolean::New(env, true));
                    }
                }
            }

            finalResults.Set(task.taskName, taskResult);
        }

        bufferRef.Unref();

        if (isBatchCall) {
            deferred.Resolve(finalResults);
        } else {
            if (finalResults.Has("defaultTask")) {
                deferred.Resolve(finalResults.Get("defaultTask"));
            } else {
                deferred.Resolve(env.Null());
            }
        }
    }

    void OnError(const Napi::Error& e) override {
        bufferRef.Unref();
        deferred.Reject(e.Value());
    }

private:
    Napi::ObjectReference bufferRef;
    uint8_t* bgraData;
    uint32_t bufferWidth, bufferHeight, stride;
    size_t bgraDataLength;
    std::vector<SearchTask> tasks;
    bool isBatchCall;
    Napi::Promise::Deferred deferred;
    FirstCandidateMap mergedFirstResults;
    AllCandidateMap mergedAllResults;
    // NEW: Result map for pixel checks
    std::unordered_map<std::string, PixelCheckResultMap> mergedPixelCheckResults;
};


// ---------- Public Async Wrappers (Unchanged) ----------
Napi::Value FindSequencesAsyncBatch(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsBuffer() || !info[1].IsObject()) {
        Napi::TypeError::New(env, "Expected (Buffer, Object searchTasks)").ThrowAsJavaScriptException();
        return env.Null();
    }

    auto deferred = Napi::Promise::Deferred::New(env);
    auto worker = new SearchWorker(deferred, info[0].As<Napi::Buffer<uint8_t>>(), info[1].As<Napi::Object>(), true);
    worker->Queue();
    return deferred.Promise();
}

Napi::Value FindSequencesAsync(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsBuffer() || !info[1].IsObject()) {
        Napi::TypeError::New(env, "Expected (Buffer, Object sequences, [Object searchArea], [String occurrence])").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Object searchTasks = Napi::Object::New(env);
    Napi::Object singleTask = Napi::Object::New(env);
    singleTask.Set("sequences", info[1]);
    singleTask.Set("occurrence", (info.Length() > 3 && !info[3].IsNull()) ? info[3] : Napi::String::New(env, "first"));
    Napi::Object searchArea = Napi::Object::New(env);
    if (info.Length() > 2 && info[2].IsObject()) {
        searchArea = info[2].As<Napi::Object>();
    } else {
        uint8_t* bufferData = info[0].As<Napi::Buffer<uint8_t>>().Data();
        uint32_t w = *reinterpret_cast<uint32_t*>(bufferData);
        uint32_t h = *reinterpret_cast<uint32_t*>(bufferData + 4);
        searchArea.Set("x", 0); searchArea.Set("y", 0);
        searchArea.Set("width", w); searchArea.Set("height", h);
    }
    singleTask.Set("searchArea", searchArea);
    searchTasks.Set("defaultTask", singleTask);

    auto deferred = Napi::Promise::Deferred::New(env);
    auto worker = new SearchWorker(deferred, info[0].As<Napi::Buffer<uint8_t>>(), searchTasks, false);
    worker->Queue();
    return deferred.Promise();
}

// ---------- Module registration ----------
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("findSequencesNative", Napi::Function::New(env, FindSequencesAsync));
    exports.Set("findSequencesNativeBatch", Napi::Function::New(env, FindSequencesAsyncBatch));
    return exports;
}

NODE_API_MODULE(findSequences, Init)