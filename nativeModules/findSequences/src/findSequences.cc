#include <napi.h>
#include <vector>
#include <string>
#include <map>
#include <set>
#include <cstdint>
#include <thread>
#include <cmath>
#include <algorithm>
#include <unordered_map> // Use unordered_map for performance

// SSE2/AVX intrinsics
#include <immintrin.h>

// --- Constants & Data Structures ---
const uint32_t ANY_COLOR_HASH = 0xFFFFFFFF;

struct SearchArea {
    uint32_t x = 0;
    uint32_t y = 0;
    uint32_t width = 0;
    uint32_t height = 0;
    bool active = false;
};

struct SequenceDefinition {
    std::string name;
    std::vector<uint32_t> sequenceHashes;
    std::string direction;
    int offsetX = 0;
    int offsetY = 0;
    std::string variant;
};

struct FirstCandidate {
    int x = 0;
    int y = 0;
    size_t pixelIndex = -1; // Use -1 as max value
};

struct FoundCoords {
    int x;
    int y;
    bool operator<(const FoundCoords& other) const {
        if (y != other.y) return y < other.y;
        return x < other.x;
    }
};

using FirstCandidateMap = std::map<std::string, std::pair<FirstCandidate, FirstCandidate>>;
using AllCandidateMap = std::map<std::string, std::pair<std::set<FoundCoords>, std::set<FoundCoords>>>;

struct SearchTask {
    std::string taskName;
    std::unordered_map<uint32_t, std::vector<SequenceDefinition>> firstColorLookup;
    std::vector<std::string> targetNames;
    SearchArea searchArea;
    std::string occurrenceMode;
};

struct WorkerData {
    const uint8_t* bgraData;
    uint32_t bufferWidth;
    uint32_t bufferHeight;
    uint32_t stride;
    size_t bgraDataLength;
    uint32_t startRow;
    uint32_t endRow;
    const std::vector<SearchTask>& tasks;
    FirstCandidateMap* localFirstResults;
    AllCandidateMap* localAllResults;
};

// --- Helper Functions ---

bool ParseColorSequence(Napi::Env env, const Napi::Array& jsSequence, std::vector<uint32_t>& outHashes) {
    outHashes.clear();
    outHashes.reserve(jsSequence.Length());
    for (uint32_t i = 0; i < jsSequence.Length(); ++i) {
        Napi::Value element = jsSequence.Get(i);
        if (element.IsString() && element.As<Napi::String>().Utf8Value() == "any") {
            outHashes.push_back(ANY_COLOR_HASH);
        } else if (element.IsArray()) {
            Napi::Array colorArray = element.As<Napi::Array>();
            if (colorArray.Length() != 3) return false;
            uint32_t r = colorArray.Get((uint32_t)0).As<Napi::Number>().Uint32Value();
            uint32_t g = colorArray.Get((uint32_t)1).As<Napi::Number>().Uint32Value();
            uint32_t b = colorArray.Get((uint32_t)2).As<Napi::Number>().Uint32Value();
            outHashes.push_back((r << 16) | (g << 8) | b);
        } else {
            return false;
        }
    }
    return true;
}

bool ParseTargetSequences(
    Napi::Env env,
    const Napi::Object& jsSequences,
    std::unordered_map<uint32_t, std::vector<SequenceDefinition>>& firstColorLookup,
    std::vector<std::string>& targetNames
) {
    firstColorLookup.clear();
    targetNames.clear();
    Napi::Array names = jsSequences.GetPropertyNames();
    targetNames.reserve(names.Length());

    for (uint32_t i = 0; i < names.Length(); ++i) {
        Napi::Value keyVal = names.Get(i);
        if (!keyVal.IsString()) continue;
        Napi::String nameString = keyVal.As<Napi::String>();
        std::string targetName = nameString.Utf8Value();
        targetNames.push_back(targetName);

        Napi::Object config = jsSequences.Get(nameString).As<Napi::Object>();
        std::string direction = config.Has("direction") ? config.Get("direction").As<Napi::String>().Utf8Value() : "horizontal";
        int offsetX = 0, offsetY = 0;
        if (config.Has("offset")) {
            Napi::Object offsetObj = config.Get("offset").As<Napi::Object>();
            if (offsetObj.Has("x")) offsetX = offsetObj.Get("x").As<Napi::Number>().Int32Value();
            if (offsetObj.Has("y")) offsetY = offsetObj.Get("y").As<Napi::Number>().Int32Value();
        }

        if (config.Has("sequence")) {
            SequenceDefinition primarySeqDef;
            primarySeqDef.name = targetName;
            primarySeqDef.direction = direction;
            primarySeqDef.offsetX = offsetX;
            primarySeqDef.offsetY = offsetY;
            primarySeqDef.variant = "primary";
            if (!ParseColorSequence(env, config.Get("sequence").As<Napi::Array>(), primarySeqDef.sequenceHashes)) return false;
            if (!primarySeqDef.sequenceHashes.empty() && primarySeqDef.sequenceHashes[0] != ANY_COLOR_HASH) {
                firstColorLookup[primarySeqDef.sequenceHashes[0]].push_back(primarySeqDef);
            }
        }

        if (config.Has("backupSequence")) {
            SequenceDefinition backupSeqDef;
            backupSeqDef.name = targetName;
            backupSeqDef.direction = direction;
            backupSeqDef.offsetX = offsetX;
            backupSeqDef.offsetY = offsetY;
            backupSeqDef.variant = "backup";
            if (!ParseColorSequence(env, config.Get("backupSequence").As<Napi::Array>(), backupSeqDef.sequenceHashes)) return false;
            if (!backupSeqDef.sequenceHashes.empty() && backupSeqDef.sequenceHashes[0] != ANY_COLOR_HASH) {
                firstColorLookup[backupSeqDef.sequenceHashes[0]].push_back(backupSeqDef);
            }
        }
    }
    return true;
}

// --- Verification Function (The original "slow path") ---
void VerifyAndRecordMatch(
    const WorkerData& data,
    const SequenceDefinition& seqDef,
    const SearchTask& task, // Pass in the current task
    uint32_t x,
    uint32_t y
) {
    const size_t seqLen = seqDef.sequenceHashes.size();
    bool match = true;
    size_t pixelOffset = (y * data.stride) + (x * 4);

    if (seqDef.direction == "horizontal") {
        if (x + seqLen > data.bufferWidth) return;
        for (size_t j = 1; j < seqLen; ++j) {
            uint32_t expectedColor = seqDef.sequenceHashes[j];
            if (expectedColor == ANY_COLOR_HASH) continue;
            size_t nextPixelOffset = pixelOffset + j * 4;
            if (nextPixelOffset + 3 >= data.bgraDataLength) { match = false; break; }
            uint32_t actualColor = (static_cast<uint32_t>(data.bgraData[nextPixelOffset + 2]) << 16) | (static_cast<uint32_t>(data.bgraData[nextPixelOffset + 1]) << 8) | (static_cast<uint32_t>(data.bgraData[nextPixelOffset]));
            if (actualColor != expectedColor) { match = false; break; }
        }
    } else { // Vertical
        if (y + seqLen > data.bufferHeight) return;
        for (size_t j = 1; j < seqLen; ++j) {
            uint32_t expectedColor = seqDef.sequenceHashes[j];
            if (expectedColor == ANY_COLOR_HASH) continue;
            size_t nextPixelOffset = pixelOffset + j * data.stride;
            if (nextPixelOffset + 3 >= data.bgraDataLength) { match = false; break; }
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
                if (candidatePair.first.pixelIndex == (size_t)-1 || currentPixelIndex < candidatePair.first.pixelIndex) {
                    candidatePair.first = {foundX, foundY, currentPixelIndex};
                }
            } else {
                if (candidatePair.first.pixelIndex == (size_t)-1) {
                    if (candidatePair.second.pixelIndex == (size_t)-1 || currentPixelIndex < candidatePair.second.pixelIndex) {
                        candidatePair.second = {foundX, foundY, currentPixelIndex};
                    }
                }
            }
        } else { // "all"
            auto& candidatePair = (*data.localAllResults)[seqDef.name];
            if (seqDef.variant == "primary") {
                candidatePair.first.insert({foundX, foundY});
            } else {
                candidatePair.second.insert({foundX, foundY});
            }
        }
    }
}

// --- Worker Thread Function (AVX2-Optimized) ---
void FindSequencesWorker(const WorkerData& data) {
    // REFACTORED: Use a map to find unique colors first, avoiding vector alignment warnings.
    std::unordered_map<uint32_t, bool> unique_colors;
    for (const auto& task : data.tasks) {
        for (const auto& pair : task.firstColorLookup) {
            unique_colors[pair.first] = true;
        }
    }

    std::vector<__m256i> first_color_vectors;
    for (const auto& color_pair : unique_colors) {
        uint32_t rgb_hash = color_pair.first;
        uint32_t r = (rgb_hash >> 16) & 0xFF;
        uint32_t g = (rgb_hash >> 8) & 0xFF;
        uint32_t b = rgb_hash & 0xFF;
        // FIX: Correctly construct the 32-bit integer to match the BGRA memory layout
        // when read as a little-endian uint32_t. Alpha is 0xFF.
        uint32_t bgra_val = (0xFF << 24) | (r << 16) | (g << 8) | b;
        first_color_vectors.push_back(_mm256_set1_epi32(bgra_val));
    }

    if (first_color_vectors.empty()) {
        return;
    }

    for (const auto& task : data.tasks) {
        uint32_t startY = std::max(data.startRow, task.searchArea.y);
        uint32_t endY = std::min(data.endRow, task.searchArea.y + task.searchArea.height);
        uint32_t startX = task.searchArea.x;
        uint32_t endX = task.searchArea.x + task.searchArea.width;

        for (uint32_t y = startY; y < endY; ++y) {
            const uint8_t* row_ptr = data.bgraData + (y * data.stride);

            for (uint32_t x = startX; x < endX; ) {
                if (x + 8 <= endX) {
                    __m256i screen_chunk = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(row_ptr + x * 4));

                    int found_mask = 0;
                    for (const auto& color_vec : first_color_vectors) {
                        __m256i cmp_result = _mm256_cmpeq_epi32(screen_chunk, color_vec);
                        found_mask |= _mm256_movemask_ps(_mm256_castsi256_ps(cmp_result));
                    }

                    if (found_mask != 0) {
                        for (int j = 0; j < 8; ++j) {
                            if ((found_mask >> j) & 1) {
                                uint32_t current_x = x + j;
                                size_t pixelOffset = (y * data.stride) + (current_x * 4);
                                uint32_t r_val = data.bgraData[pixelOffset + 2];
                                uint32_t g_val = data.bgraData[pixelOffset + 1];
                                uint32_t b_val = data.bgraData[pixelOffset + 0];
                                uint32_t currentColorHash = (r_val << 16) | (g_val << 8) | b_val;

                                auto lookupIt = task.firstColorLookup.find(currentColorHash);
                                if (lookupIt != task.firstColorLookup.end()) {
                                    for (const auto& seqDef : lookupIt->second) {
                                        VerifyAndRecordMatch(data, seqDef, task, current_x, y);
                                    }
                                }
                            }
                        }
                    }
                    x += 8;
                } else {
                    size_t pixelOffset = (y * data.stride) + (x * 4);
                    uint32_t r_val = data.bgraData[pixelOffset + 2];
                    uint32_t g_val = data.bgraData[pixelOffset + 1];
                    uint32_t b_val = data.bgraData[pixelOffset + 0];
                    uint32_t currentColorHash = (r_val << 16) | (g_val << 8) | b_val;

                    auto lookupIt = task.firstColorLookup.find(currentColorHash);
                    if (lookupIt != task.firstColorLookup.end()) {
                        for (const auto& seqDef : lookupIt->second) {
                            VerifyAndRecordMatch(data, seqDef, task, x, y);
                        }
                    }
                    x++;
                }
            }
        }
    }
}

// --- C++ Helper function to contain the core logic ---
Napi::Value PerformSearch(Napi::Env env, const Napi::Buffer<uint8_t>& imageBuffer, const Napi::Object& jsSearchTasks) {
    if (imageBuffer.Length() < 8) { return env.Null(); }
    uint8_t* bufferData = imageBuffer.Data();
    uint32_t bufferWidth = *reinterpret_cast<uint32_t*>(bufferData);
    uint32_t bufferHeight = *reinterpret_cast<uint32_t*>(bufferData + 4);
    uint8_t* bgraData = bufferData + 8;
    size_t bgraDataLength = imageBuffer.Length() - 8;
    uint32_t stride = bufferWidth * 4;

    std::vector<SearchTask> tasks;
    Napi::Array taskNames = jsSearchTasks.GetPropertyNames();
    for (uint32_t i = 0; i < taskNames.Length(); ++i) {
        SearchTask task;
        Napi::Value keyVal = taskNames.Get(i);
        if (!keyVal.IsString()) continue;
        task.taskName = keyVal.As<Napi::String>().Utf8Value();
        Napi::Object taskConfig = jsSearchTasks.Get(task.taskName).As<Napi::Object>();
        if (!ParseTargetSequences(env, taskConfig.Get("sequences").As<Napi::Object>(), task.firstColorLookup, task.targetNames)) {
            return env.Null();
        }
        task.occurrenceMode = taskConfig.Get("occurrence").As<Napi::String>().Utf8Value();
        Napi::Object jsSearchArea = taskConfig.Get("searchArea").As<Napi::Object>();
        task.searchArea.x = jsSearchArea.Get("x").As<Napi::Number>().Uint32Value();
        task.searchArea.y = jsSearchArea.Get("y").As<Napi::Number>().Uint32Value();
        task.searchArea.width = jsSearchArea.Get("width").As<Napi::Number>().Uint32Value();
        task.searchArea.height = jsSearchArea.Get("height").As<Napi::Number>().Uint32Value();
        task.searchArea.active = true;
        tasks.push_back(task);
    }

    unsigned int numThreads = std::min((unsigned int)std::thread::hardware_concurrency(), bufferHeight);
    if (numThreads == 0) numThreads = 1;
    std::vector<std::thread> threads;
    std::vector<FirstCandidateMap> threadFirstResults(numThreads);
    std::vector<AllCandidateMap> threadAllResults(numThreads);
    uint32_t rowsPerThread = (bufferHeight + numThreads - 1) / numThreads;

    for (unsigned int i = 0; i < numThreads; ++i) {
        uint32_t startRow = i * rowsPerThread;
        uint32_t endRow = std::min(startRow + rowsPerThread, bufferHeight);
        if (startRow >= endRow) continue;
        threads.emplace_back(FindSequencesWorker, WorkerData{
            bgraData, bufferWidth, bufferHeight, stride, bgraDataLength,
            startRow, endRow, std::ref(tasks), &threadFirstResults[i], &threadAllResults[i]
        });
    }
    for (auto& t : threads) { t.join(); }

    Napi::Object finalResultsByTask = Napi::Object::New(env);
    for (const auto& task : tasks) {
        Napi::Object taskResult = Napi::Object::New(env);
        if (task.occurrenceMode == "first") {
            FirstCandidateMap finalFirstResults;
            for (const auto& name : task.targetNames) { finalFirstResults[name]; }
            for (const auto& localMap : threadFirstResults) {
                for (const auto& pair : localMap) {
                    if (finalFirstResults.count(pair.first)) {
                        auto& finalPair = finalFirstResults.at(pair.first);
                        if (pair.second.first.pixelIndex != (size_t)-1 && (finalPair.first.pixelIndex == (size_t)-1 || pair.second.first.pixelIndex < finalPair.first.pixelIndex)) {
                            finalPair.first = pair.second.first;
                        }
                        if (finalPair.first.pixelIndex == (size_t)-1 && pair.second.second.pixelIndex != (size_t)-1 && (finalPair.second.pixelIndex == (size_t)-1 || pair.second.second.pixelIndex < finalPair.second.pixelIndex)) {
                            finalPair.second = pair.second.second;
                        }
                    }
                }
            }
            for (const auto& name : task.targetNames) {
                const auto& finalPair = finalFirstResults.at(name);
                if (finalPair.first.pixelIndex != (size_t)-1) {
                    Napi::Object coords = Napi::Object::New(env);
                    coords.Set("x", finalPair.first.x);
                    coords.Set("y", finalPair.first.y);
                    taskResult.Set(name, coords);
                } else if (finalPair.second.pixelIndex != (size_t)-1) {
                    Napi::Object coords = Napi::Object::New(env);
                    coords.Set("x", finalPair.second.x);
                    coords.Set("y", finalPair.second.y);
                    taskResult.Set(name, coords);
                } else {
                    taskResult.Set(name, env.Null());
                }
            }
        } else { // "all"
            AllCandidateMap finalAllResults;
            for (const auto& name : task.targetNames) { finalAllResults[name]; }
            for (const auto& localMap : threadAllResults) {
                for (const auto& pair : localMap) {
                    if (finalAllResults.count(pair.first)) {
                        auto& finalPair = finalAllResults.at(pair.first);
                        finalPair.first.insert(pair.second.first.begin(), pair.second.first.end());
                        finalPair.second.insert(pair.second.second.begin(), pair.second.second.end());
                    }
                }
            }
            for (const auto& name : task.targetNames) {
                const auto& finalPair = finalAllResults.at(name);
                const auto& primarySet = finalPair.first;
                const auto& backupSet = finalPair.second;
                Napi::Array coordsArray;
                if (!primarySet.empty()) {
                    coordsArray = Napi::Array::New(env, primarySet.size());
                    size_t idx = 0;
                    for (const auto& coords : primarySet) {
                        Napi::Object obj = Napi::Object::New(env);
                        obj.Set("x", coords.x);
                        obj.Set("y", coords.y);
                        coordsArray[idx++] = obj;
                    }
                } else if (!backupSet.empty()) {
                    coordsArray = Napi::Array::New(env, backupSet.size());
                    size_t idx = 0;
                    for (const auto& coords : backupSet) {
                        // FIX: Corrected Npi -> Napi typo
                        Napi::Object obj = Napi::Object::New(env);
                        obj.Set("x", coords.x);
                        obj.Set("y", coords.y);
                        coordsArray[idx++] = obj;
                    }
                } else {
                    coordsArray = Napi::Array::New(env);
                }
                taskResult.Set(name, coordsArray);
            }
        }
        finalResultsByTask.Set(task.taskName, taskResult);
    }

    return finalResultsByTask;
}

// --- BATCH N-API FUNCTION (Now a simple wrapper) ---
Napi::Value FindSequencesNativeBatch(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsBuffer() || !info[1].IsObject()) {
        Napi::TypeError::New(env, "Expected (Buffer, Object searchTasks)").ThrowAsJavaScriptException();
        return env.Null();
    }
    return PerformSearch(env, info[0].As<Napi::Buffer<uint8_t>>(), info[1].As<Napi::Object>());
}

// --- ORIGINAL FUNCTION (Now a wrapper for backward compatibility) ---
Napi::Value FindSequencesNative(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object searchTasks = Napi::Object::New(env);
    Napi::Object singleTask = Napi::Object::New(env);
    singleTask.Set("sequences", info[1]);
    singleTask.Set("occurrence", (info.Length() > 3 && !info[3].IsNull()) ? info[3] : Napi::String::New(env, "first"));
    Napi::Object searchArea = Napi::Object::New(env);
    if (info.Length() > 2 && info[2].IsObject()) {
        searchArea = info[2].As<Napi::Object>();
    } else {
        uint8_t* bufferData = info[0].As<Napi::Buffer<uint8_t>>().Data();
        uint32_t bufferWidth = *reinterpret_cast<uint32_t*>(bufferData);
        uint32_t bufferHeight = *reinterpret_cast<uint32_t*>(bufferData + 4);
        searchArea.Set("x", 0);
        searchArea.Set("y", 0);
        searchArea.Set("width", bufferWidth);
        searchArea.Set("height", bufferHeight);
    }
    singleTask.Set("searchArea", searchArea);
    searchTasks.Set("defaultTask", singleTask);
    Napi::Value batchResult = PerformSearch(env, info[0].As<Napi::Buffer<uint8_t>>(), searchTasks);
    if (batchResult.IsNull() || !batchResult.IsObject()) {
        return env.Null();
    }
    return batchResult.As<Napi::Object>().Get("defaultTask");
}

// --- Module Initialization ---
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("findSequencesNative", Napi::Function::New(env, FindSequencesNative));
    exports.Set("findSequencesNativeBatch", Napi::Function::New(env, FindSequencesNativeBatch));
    return exports;
}

NODE_API_MODULE(findSequences, Init)