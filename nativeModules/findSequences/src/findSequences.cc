#include <napi.h>
#include <vector>
#include <string>
#include <map>
#include <set> // For deduplication in 'all' mode
#include <cstdint>
#include <stdexcept> // For exceptions
#include <limits>   // For numeric_limits
#include <algorithm> // For std::min, std::max
#include <thread> // Include thread support
#include <cmath>  // For std::ceil
#include <iostream> // For potential debugging

// Include header for SSE2 intrinsics
#include <immintrin.h> // Usually includes emmintrin.h (SSE2) and others

// --- Constants ---
const uint32_t ANY_COLOR_HASH = 0xFFFFFFFF; // Special value for "any"

// --- Data Structures ---

// NEW: Structure to define the search area rectangle
struct SearchArea {
    uint32_t x = 0;
    uint32_t y = 0;
    uint32_t width = 0; // Will be set to full buffer width if not provided
    uint32_t height = 0; // Will be set to full buffer height if not provided
    bool active = false; // Flag to indicate if a sub-area search is requested
};


struct SequenceDefinition {
    std::string name;
    std::vector<uint32_t> sequenceHashes; // Color hashes or ANY_COLOR_HASH
    std::string direction;                // "horizontal" or "vertical"
    int offsetX = 0;
    int offsetY = 0;
    std::string variant;                  // "primary" or "backup"
};

// Structure for 'first' occurrence mode result candidate
struct FirstCandidate {
    int x = 0;
    int y = 0;
    size_t pixelIndex = std::numeric_limits<size_t>::max();
};
// Structure for 'all' occurrence mode result candidate
struct FoundCoords {
    int x;
    int y;
    // Needed for using std::set for deduplication
    bool operator<(const FoundCoords& other) const {
        if (y != other.y) return y < other.y;
        return x < other.x;
    }
     bool operator==(const FoundCoords& other) const {
        return x == other.x && y == other.y;
    }
};

// Map for 'first' mode results {primary, backup}
using FirstCandidateMap = std::map<std::string, std::pair<FirstCandidate, FirstCandidate>>;
// Map for 'all' mode results {primary_list, backup_list}
// Use std::set for automatic deduplication during insertion in worker
using AllCandidateMap = std::map<std::string, std::pair<std::set<FoundCoords>, std::set<FoundCoords>>>;

// Structure to pass data to each worker thread (MODIFIED: Added searchArea)
struct WorkerData {
    const uint8_t* rgbData;
    uint32_t bufferWidth;
    uint32_t bufferHeight;
    uint32_t stride;
    size_t rgbDataLength;
    uint32_t startRow;
    uint32_t endRow; // Exclusive [startRow, endRow)
    const std::map<uint32_t, std::vector<SequenceDefinition>>& firstColorLookup;
    SearchArea searchArea;      // NEW: The area to search within
    std::string occurrenceMode; // "first" or "all"
    // Pointers to the appropriate result map type for this thread
    FirstCandidateMap* localFirstResults;
    AllCandidateMap* localAllResults;

    WorkerData(const uint8_t* data, uint32_t w, uint32_t h, uint32_t s, size_t len,
               uint32_t start, uint32_t end,
               const std::map<uint32_t, std::vector<SequenceDefinition>>& lookup,
               const SearchArea& area,
               const std::string& mode,
               FirstCandidateMap* firstResults, // Pass pointer
               AllCandidateMap* allResults)     // Pass pointer
        : rgbData(data), bufferWidth(w), bufferHeight(h), stride(s), rgbDataLength(len),
          startRow(start), endRow(end), firstColorLookup(lookup), searchArea(area),
          occurrenceMode(mode), localFirstResults(firstResults), localAllResults(allResults)
          {}
};


// --- Helper Functions ---

// ParseColorSequence (no changes needed)
bool ParseColorSequence(Napi::Env env, const Napi::Array& jsSequence, std::vector<uint32_t>& outHashes) {
    outHashes.clear();
    outHashes.reserve(jsSequence.Length());
    for (uint32_t i = 0; i < jsSequence.Length(); ++i) {
        Napi::Value element = jsSequence[i];
        if (element.IsString() && element.As<Napi::String>().Utf8Value() == "any") {
            outHashes.push_back(ANY_COLOR_HASH);
        } else if (element.IsArray()) {
            Napi::Array colorArray = element.As<Napi::Array>();
            if (colorArray.Length() != 3) {
                Napi::TypeError::New(env, "Color array must have 3 elements [R, G, B]").ThrowAsJavaScriptException();
                return false;
            }
            uint32_t r = colorArray.Get((uint32_t)0).As<Napi::Number>().Uint32Value();
            uint32_t g = colorArray.Get((uint32_t)1).As<Napi::Number>().Uint32Value();
            uint32_t b = colorArray.Get((uint32_t)2).As<Napi::Number>().Uint32Value();
            if (r > 255 || g > 255 || b > 255) {
                 Napi::TypeError::New(env, "RGB values must be between 0 and 255").ThrowAsJavaScriptException();
                 return false;
            }
            // Store as 0x00RRGGBB for easier SIMD comparison later if needed
            outHashes.push_back((r << 16) | (g << 8) | b);
        } else {
            Napi::TypeError::New(env, "Sequence element must be 'any' or an array [R, G, B]").ThrowAsJavaScriptException();
            return false;
        }
    }
    return true;
}


// ParseTargetSequences (no changes needed)
bool ParseTargetSequences(
    Napi::Env env,
    const Napi::Object& jsSequences,
    std::map<uint32_t, std::vector<SequenceDefinition>>& firstColorLookup,
    std::vector<std::string>& targetNames // To keep track of all defined targets
) {
    firstColorLookup.clear();
    targetNames.clear();
    Napi::Array names = jsSequences.GetPropertyNames();
    targetNames.reserve(names.Length());

    for (uint32_t i = 0; i < names.Length(); ++i) {
        Napi::Value keyVal = names[i];
        if (!keyVal.IsString()) continue; // Should not happen, but safety check
        Napi::String nameString = keyVal.As<Napi::String>();
        std::string targetName = nameString.Utf8Value();
        targetNames.push_back(targetName);

        Napi::Value configVal = jsSequences.Get(nameString);
        if (!configVal.IsObject()) {
            Napi::TypeError::New(env, "Sequence configuration for '" + targetName + "' must be an object.").ThrowAsJavaScriptException();
            return false;
        }
        Napi::Object config = configVal.As<Napi::Object>();

        // --- Get common properties ---
        std::string direction = config.Has("direction") ? config.Get("direction").As<Napi::String>().Utf8Value() : "horizontal";
        int offsetX = 0;
        int offsetY = 0;
        if (config.Has("offset")) {
            Napi::Object offsetObj = config.Get("offset").As<Napi::Object>();
            if (offsetObj.Has("x")) offsetX = offsetObj.Get("x").As<Napi::Number>().Int32Value();
            if (offsetObj.Has("y")) offsetY = offsetObj.Get("y").As<Napi::Number>().Int32Value();
        }

        // --- Parse Primary Sequence ---
        if (!config.Has("sequence") || !config.Get("sequence").IsArray()) {
             Napi::TypeError::New(env, "Missing or invalid 'sequence' array for target '" + targetName + "'.").ThrowAsJavaScriptException();
             return false;
        }
        Napi::Array primarySeqArray = config.Get("sequence").As<Napi::Array>();
        SequenceDefinition primarySeqDef;
        primarySeqDef.name = targetName;
        primarySeqDef.direction = direction;
        primarySeqDef.offsetX = offsetX;
        primarySeqDef.offsetY = offsetY;
        primarySeqDef.variant = "primary";
        if (!ParseColorSequence(env, primarySeqArray, primarySeqDef.sequenceHashes)) return false; // Error already thrown

        if (!primarySeqDef.sequenceHashes.empty()) {
             if (primarySeqDef.sequenceHashes[0] != ANY_COLOR_HASH) {
                firstColorLookup[primarySeqDef.sequenceHashes[0]].push_back(primarySeqDef);
             } else {
                // Handle sequences starting with 'any' - associate with a special key?
                // For now, we require a non-'any' first color for lookup optimization.
                // If 'any' is the first, it would require checking *every* pixel.
                // Consider adding a separate list for 'any' start sequences if needed.
             }
        } else {
             Napi::Error::New(env, "Sequence cannot be empty for target '" + targetName + "'.").ThrowAsJavaScriptException();
             return false;
        }


        // --- Parse Backup Sequence (Optional) ---
        if (config.Has("backupSequence")) {
             Napi::Value backupVal = config.Get("backupSequence");
             if (!backupVal.IsArray()) {
                 Napi::TypeError::New(env, "Invalid 'backupSequence' for target '" + targetName + "', must be an array.").ThrowAsJavaScriptException();
                 return false;
             }
             Napi::Array backupSeqArray = backupVal.As<Napi::Array>();
             SequenceDefinition backupSeqDef;
             backupSeqDef.name = targetName;
             backupSeqDef.direction = direction;
             backupSeqDef.offsetX = offsetX;
             backupSeqDef.offsetY = offsetY;
             backupSeqDef.variant = "backup";
             if (!ParseColorSequence(env, backupSeqArray, backupSeqDef.sequenceHashes)) return false;

             if (!backupSeqDef.sequenceHashes.empty()) {
                if (backupSeqDef.sequenceHashes[0] != ANY_COLOR_HASH) {
                    firstColorLookup[backupSeqDef.sequenceHashes[0]].push_back(backupSeqDef);
                } else {
                   // See comment above for 'any' start
                }
             } else {
                  Napi::Error::New(env, "Backup sequence cannot be empty for target '" + targetName + "'.").ThrowAsJavaScriptException();
                  return false;
             }
        }
    }
    // TODO (Optional): Add handling for sequences starting with 'any' if required.
    // This would likely involve iterating through *all* pixels in the search area
    // and checking these specific sequences, bypassing the firstColorLookup.
    return true;
}

// --- Worker Thread Function --- (MODIFIED: Handles both occurrence modes)
void FindSequencesWorker(const WorkerData& data) {
    uint32_t effectiveStartRow = data.startRow;
    uint32_t effectiveEndRow = data.endRow;
    if (data.searchArea.active) {
        effectiveStartRow = std::max(data.startRow, data.searchArea.y);
        effectiveEndRow = std::min(data.endRow, data.searchArea.y + data.searchArea.height);
    }
    uint32_t searchEndX = data.searchArea.active ? (data.searchArea.x + data.searchArea.width) : data.bufferWidth;
    const __m128i any_color_vec = _mm_set1_epi32(ANY_COLOR_HASH);

    for (uint32_t currentY = effectiveStartRow; currentY < effectiveEndRow; ++currentY) {
        size_t rowStartOffset = static_cast<size_t>(currentY) * data.stride;
        uint32_t startX = data.searchArea.active ? data.searchArea.x : 0;
        size_t startOffsetInRow = rowStartOffset + static_cast<size_t>(startX) * 3;
        uint32_t endX = data.searchArea.active ? searchEndX : data.bufferWidth;
        size_t endOffsetInRow = rowStartOffset + static_cast<size_t>(endX) * 3;
        endOffsetInRow = std::min({endOffsetInRow, rowStartOffset + data.stride, data.rgbDataLength}); // Clamp

        for (size_t i = startOffsetInRow; i < endOffsetInRow; i += 3) {
             uint32_t currentX = static_cast<uint32_t>((i - rowStartOffset) / 3);
             uint32_t currentColorHash = (static_cast<uint32_t>(data.rgbData[i]) << 16) |
                                         (static_cast<uint32_t>(data.rgbData[i + 1]) << 8) |
                                         (static_cast<uint32_t>(data.rgbData[i + 2]));
             auto lookupIt = data.firstColorLookup.find(currentColorHash);
             if (lookupIt == data.firstColorLookup.end()) continue;

             for (const auto& seqDef : lookupIt->second) {
                 const size_t seqLen = seqDef.sequenceHashes.size();
                 if (seqLen == 0) continue;
                 bool match = true; // Assume match

                 // --- Sequence Comparison (Horizontal with SIMD, Vertical scalar) ---
                 // ... (Keep the existing comparison logic using SIMD for horizontal) ...
                if (seqDef.direction == "horizontal") {
                    if (currentX + seqLen > data.bufferWidth) continue;
                    const uint32_t* seqPtr = seqDef.sequenceHashes.data() + 1;
                    const uint8_t* pixelPtr = data.rgbData + i + 3;
                    size_t remainingLen = seqLen - 1;
                    size_t j = 0;
                    const size_t simd_chunk_size = 4;
                    for (; j + simd_chunk_size <= remainingLen; j += simd_chunk_size) {
                        __m128i expected_colors = _mm_loadu_si128((const __m128i*)(seqPtr + j));
                        uint32_t actual[simd_chunk_size];
                        const uint8_t* currentPixel = pixelPtr + j * 3;
                        for(size_t k = 0; k < simd_chunk_size; ++k) {
                           size_t pixelAbsoluteOffset = (size_t)(currentPixel + k*3 - data.rgbData);
                            if (pixelAbsoluteOffset + 2 >= data.rgbDataLength) { match = false; break; }
                             actual[k] = (static_cast<uint32_t>(data.rgbData[pixelAbsoluteOffset]) << 16) | (static_cast<uint32_t>(data.rgbData[pixelAbsoluteOffset + 1]) << 8) | (static_cast<uint32_t>(data.rgbData[pixelAbsoluteOffset + 2]));
                        }
                        if (!match) break;
                        __m128i actual_colors = _mm_loadu_si128((const __m128i*)actual);
                        __m128i any_mask = _mm_cmpeq_epi32(expected_colors, any_color_vec);
                        __m128i compare_mask = _mm_cmpeq_epi32(actual_colors, expected_colors);
                        __m128i combined_mask = _mm_or_si128(compare_mask, any_mask);
                        if (_mm_movemask_epi8(combined_mask) != 0xFFFF) { match = false; break; }
                    }
                    if (!match) continue;
                    for (; j < remainingLen; ++j) {
                        uint32_t expectedColor = seqPtr[j];
                        if (expectedColor == ANY_COLOR_HASH) continue;
                        size_t nextPixelOffset = i + (j + 1) * 3;
                        if (nextPixelOffset + 2 >= data.rgbDataLength) { match = false; break; }
                        uint32_t actualColor = (static_cast<uint32_t>(data.rgbData[nextPixelOffset]) << 16) | (static_cast<uint32_t>(data.rgbData[nextPixelOffset + 1]) << 8) | (static_cast<uint32_t>(data.rgbData[nextPixelOffset + 2]));
                        if (actualColor != expectedColor) { match = false; break; }
                    }
                 } else { // Vertical
                     if (currentY + seqLen > data.bufferHeight) continue;
                     for (size_t j = 1; j < seqLen; ++j) {
                         uint32_t expectedColor = seqDef.sequenceHashes[j];
                         if (expectedColor == ANY_COLOR_HASH) continue;
                         size_t nextPixelOffset = i + j * data.stride;
                         if (nextPixelOffset + 2 >= data.rgbDataLength) { match = false; break; }
                         uint32_t actualColor = (static_cast<uint32_t>(data.rgbData[nextPixelOffset]) << 16) | (static_cast<uint32_t>(data.rgbData[nextPixelOffset + 1]) << 8) | (static_cast<uint32_t>(data.rgbData[nextPixelOffset + 2]));
                         if (actualColor != expectedColor) { match = false; break; }
                     }
                 }


                 // --- Store result based on mode ---
                 if (match) {
                     size_t currentPixelIndex = i / 3;
                     int foundX = static_cast<int>(currentX) + seqDef.offsetX;
                     int foundY = static_cast<int>(currentY) + seqDef.offsetY;

                     if (data.occurrenceMode == "first") {
                         // --- 'first' mode logic ---
                         auto& candidatePair = (*data.localFirstResults)[seqDef.name]; // Use pointer
                         if (seqDef.variant == "primary") {
                             if (currentPixelIndex < candidatePair.first.pixelIndex) {
                                 candidatePair.first = {foundX, foundY, currentPixelIndex};
                             }
                         } else { // Backup
                             if (candidatePair.first.pixelIndex == std::numeric_limits<size_t>::max()) {
                                 if (currentPixelIndex < candidatePair.second.pixelIndex) {
                                     candidatePair.second = {foundX, foundY, currentPixelIndex};
                                 }
                             }
                         }
                     } else { // --- 'all' mode logic ---
                         auto& candidatePair = (*data.localAllResults)[seqDef.name]; // Use pointer
                         if (seqDef.variant == "primary") {
                            // Insert into the set (automatic deduplication)
                            candidatePair.first.insert({foundX, foundY});
                         } else { // Backup
                            // Insert into backup set
                            candidatePair.second.insert({foundX, foundY});
                         }
                     }
                 } // end if match
             } // end loop seqDef
        } // end loop pixels in row
    } // end loop rows
}


// --- Main N-API Function --- (MODIFIED: Added occurrence mode parsing and handling)

Napi::Value FindSequencesNative(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // 1. --- Argument Validation --- (MODIFIED: Check 4th arg)
    if (info.Length() < 2 || info.Length() > 4) { // Allow 2, 3 or 4 arguments
        Napi::TypeError::New(env, "Expected 2 to 4 arguments: imageData (Buffer), targetSequences (Object), [searchArea (Object)], [occurrence (String)]").ThrowAsJavaScriptException();
        return env.Null();
    }
    // Validate Buffer and Object (Args 0, 1)
    if (!info[0].IsBuffer()) { Napi::TypeError::New(env, "Argument 1 must be a Buffer (imageData)").ThrowAsJavaScriptException(); return env.Null(); }
    if (!info[1].IsObject()) { Napi::TypeError::New(env, "Argument 2 must be an Object (targetSequences)").ThrowAsJavaScriptException(); return env.Null(); }
    // Validate optional searchArea (Arg 2)
    SearchArea searchArea; // Default to inactive
    if (info.Length() >= 3 && !info[2].IsUndefined() && !info[2].IsNull()) {
        if (!info[2].IsObject()) {
            Napi::TypeError::New(env, "Argument 3 (searchArea) must be an Object").ThrowAsJavaScriptException();
            return env.Null();
        }
         // Parse searchArea object (logic moved to step 2.5)
    }
     // Validate optional occurrence (Arg 3)
     std::string occurrenceMode = "first"; // Default
     if (info.Length() == 4 && !info[3].IsUndefined() && !info[3].IsNull()) {
         if (!info[3].IsString()) {
            Napi::TypeError::New(env, "Argument 4 (occurrence) must be a String ('first' or 'all')").ThrowAsJavaScriptException();
            return env.Null();
         }
         occurrenceMode = info[3].As<Napi::String>().Utf8Value();
         if (occurrenceMode != "first" && occurrenceMode != "all") {
            Napi::TypeError::New(env, "Argument 4 (occurrence) must be either 'first' or 'all'").ThrowAsJavaScriptException();
            return env.Null();
         }
     }


    Napi::Buffer<uint8_t> imageBuffer = info[0].As<Napi::Buffer<uint8_t>>();
    Napi::Object jsTargetSequences = info[1].As<Napi::Object>();

    // 2. --- Read Header --- (No changes)
    // ... (Header reading logic) ...
    if (imageBuffer.Length() < 8) { Napi::Error::New(env, "Buffer too short for dimensions header").ThrowAsJavaScriptException(); return env.Null(); }
    uint8_t* bufferData = imageBuffer.Data();
    size_t bufferLength = imageBuffer.Length();
    uint32_t bufferWidth = static_cast<uint32_t>(bufferData[0]) | (static_cast<uint32_t>(bufferData[1]) << 8) | (static_cast<uint32_t>(bufferData[2]) << 16) | (static_cast<uint32_t>(bufferData[3]) << 24);
    uint32_t bufferHeight = static_cast<uint32_t>(bufferData[4]) | (static_cast<uint32_t>(bufferData[5]) << 8) | (static_cast<uint32_t>(bufferData[6]) << 16) | (static_cast<uint32_t>(bufferData[7]) << 24);
    uint8_t* rgbData = bufferData + 8;
    size_t rgbDataLength = bufferLength - 8;
    if (bufferWidth == 0 || bufferHeight == 0) { Napi::Error::New(env, "Invalid dimensions read from header").ThrowAsJavaScriptException(); return env.Null(); }
    uint64_t expectedDataLength = static_cast<uint64_t>(bufferWidth) * bufferHeight * 3;
    if (rgbDataLength < expectedDataLength) { /* Error handling */
        char errorMsg[200]; snprintf(errorMsg, sizeof(errorMsg), "Buffer data too short for declared dimensions %ux%u. Expected: %llu, Received: %zu", bufferWidth, bufferHeight, (unsigned long long)expectedDataLength, rgbDataLength); Napi::Error::New(env, errorMsg).ThrowAsJavaScriptException(); return env.Null();
    }
    rgbDataLength = std::min(rgbDataLength, (size_t)expectedDataLength);
    uint32_t stride = bufferWidth * 3;

    // 2.5 --- Parse Optional Search Area --- (Moved parsing here)
    searchArea.width = bufferWidth; searchArea.height = bufferHeight; searchArea.active = false;
    if (info.Length() >= 3 && info[2].IsObject()) {
        Napi::Object jsSearchArea = info[2].As<Napi::Object>();
        // ... (Keep the validation and parsing logic for searchArea) ...
        bool hasX = jsSearchArea.Has("x") && jsSearchArea.Get("x").IsNumber();
        bool hasY = jsSearchArea.Has("y") && jsSearchArea.Get("y").IsNumber();
        bool hasWidth = jsSearchArea.Has("width") && jsSearchArea.Get("width").IsNumber();
        bool hasHeight = jsSearchArea.Has("height") && jsSearchArea.Get("height").IsNumber();
        if (!(hasX && hasY && hasWidth && hasHeight)) { Napi::TypeError::New(env, "searchArea object must contain numeric x, y, width, height").ThrowAsJavaScriptException(); return env.Null(); }
        int64_t sx = jsSearchArea.Get("x").As<Napi::Number>().Int64Value();
        int64_t sy = jsSearchArea.Get("y").As<Napi::Number>().Int64Value();
        int64_t sw = jsSearchArea.Get("width").As<Napi::Number>().Int64Value();
        int64_t sh = jsSearchArea.Get("height").As<Napi::Number>().Int64Value();
        if (sx < 0 || sy < 0 || sw <= 0 || sh <= 0 || static_cast<uint64_t>(sx) >= bufferWidth || static_cast<uint64_t>(sy) >= bufferHeight || static_cast<uint64_t>(sx) + static_cast<uint64_t>(sw) > bufferWidth || static_cast<uint64_t>(sy) + static_cast<uint64_t>(sh) > bufferHeight) {
             char errorMsg[256]; snprintf(errorMsg, sizeof(errorMsg), "Invalid searchArea bounds: x=%lld, y=%lld, w=%lld, h=%lld for buffer dimensions %ux%u", static_cast<long long>(sx), static_cast<long long>(sy), static_cast<long long>(sw), static_cast<long long>(sh), bufferWidth, bufferHeight); Napi::RangeError::New(env, errorMsg).ThrowAsJavaScriptException(); return env.Null();
        }
        searchArea.x = static_cast<uint32_t>(sx); searchArea.y = static_cast<uint32_t>(sy); searchArea.width = static_cast<uint32_t>(sw); searchArea.height = static_cast<uint32_t>(sh); searchArea.active = true;
    }


    // 3. --- Parse Target Sequences --- (No changes)
    std::map<uint32_t, std::vector<SequenceDefinition>> firstColorLookup;
    std::vector<std::string> targetNames;
    if (!ParseTargetSequences(env, jsTargetSequences, firstColorLookup, targetNames)) {
        return env.Null(); // Error already thrown
    }

    // 4. --- Multi-threaded Search --- (MODIFIED: Create correct result maps)
    unsigned int numThreadsHint = std::thread::hardware_concurrency();
    unsigned int numThreads = (numThreadsHint == 0) ? 1 : numThreadsHint;
    uint32_t heightToDivide = searchArea.active ? searchArea.height : bufferHeight;
    numThreads = std::min(numThreads, heightToDivide);
    if (numThreads == 0) { numThreads = 1; }

    std::vector<std::thread> threads;
    // Create result maps based on mode
    std::vector<FirstCandidateMap> threadFirstResults(occurrenceMode == "first" ? numThreads : 0);
    std::vector<AllCandidateMap> threadAllResults(occurrenceMode == "all" ? numThreads : 0);


    uint32_t rowsPerThread = (bufferHeight + numThreads - 1) / numThreads; // Ceiling division

    threads.reserve(numThreads);
    for (unsigned int i = 0; i < numThreads; ++i) {
        uint32_t startRow = i * rowsPerThread;
        uint32_t endRow = std::min(startRow + rowsPerThread, bufferHeight);

        if (startRow >= endRow) continue;
        if (searchArea.active) { /* Skip thread if range outside searchArea */
            uint32_t searchStartY = searchArea.y; uint32_t searchEndY = searchArea.y + searchArea.height;
            if (endRow <= searchStartY || startRow >= searchEndY) { continue; }
        }

        // Get pointers to the correct result map for this thread
        FirstCandidateMap* firstResultsPtr = (occurrenceMode == "first") ? &threadFirstResults[i] : nullptr;
        AllCandidateMap* allResultsPtr = (occurrenceMode == "all") ? &threadAllResults[i] : nullptr;


        // Launch thread using lambda
        threads.emplace_back(
            [/* Capture necessary variables */ rgbData, bufferWidth, bufferHeight, stride, rgbDataLength, startRow, endRow, &firstColorLookup, searchArea, occurrenceMode, firstResultsPtr, allResultsPtr]() {
                // Construct temporary WorkerData inside thread (or pass args directly)
                WorkerData data(rgbData, bufferWidth, bufferHeight, stride, rgbDataLength,
                                startRow, endRow, firstColorLookup, searchArea, occurrenceMode,
                                firstResultsPtr, allResultsPtr);
                FindSequencesWorker(data); // Call worker with WorkerData struct
            }
        );
    }

    // Wait for threads
    for (auto& t : threads) { if (t.joinable()) { t.join(); } }

    // 5. --- Merge Results --- (MODIFIED: Handle both modes)
    Napi::Object results = Napi::Object::New(env);

    if (occurrenceMode == "first") {
        // --- Merge for 'first' mode ---
        FirstCandidateMap finalFirstResults;
        // Initialize final map to ensure all targets exist
        for (const auto& name : targetNames) { finalFirstResults[name]; }

        for (const auto& localResultMap : threadFirstResults) {
            for (const auto& pair : localResultMap) {
                const std::string& name = pair.first;
                const FirstCandidate& localPrimary = pair.second.first;
                const FirstCandidate& localBackup = pair.second.second;
                auto& finalCandidatePair = finalFirstResults.at(name); // Use .at for safety

                if (localPrimary.pixelIndex < finalCandidatePair.first.pixelIndex) {
                    finalCandidatePair.first = localPrimary;
                }
                if (finalCandidatePair.first.pixelIndex == std::numeric_limits<size_t>::max()) { // Check FINAL primary
                    if (localBackup.pixelIndex < finalCandidatePair.second.pixelIndex) {
                        finalCandidatePair.second = localBackup;
                    }
                }
            }
        }
         // --- Build 'first' results object ---
         for (const std::string& name : targetNames) {
             const auto& finalCandidatePair = finalFirstResults.at(name);
             const auto& primaryCandidate = finalCandidatePair.first;
             const auto& backupCandidate = finalCandidatePair.second;
             if (primaryCandidate.pixelIndex != std::numeric_limits<size_t>::max()) {
                 Napi::Object coords = Napi::Object::New(env);
                 coords.Set("x", Napi::Number::New(env, primaryCandidate.x));
                 coords.Set("y", Napi::Number::New(env, primaryCandidate.y));
                 results.Set(name, coords);
             } else if (backupCandidate.pixelIndex != std::numeric_limits<size_t>::max()) {
                 Napi::Object coords = Napi::Object::New(env);
                 coords.Set("x", Napi::Number::New(env, backupCandidate.x));
                 coords.Set("y", Napi::Number::New(env, backupCandidate.y));
                 results.Set(name, coords);
             } else {
                 results.Set(name, env.Null());
             }
         }

    } else { // --- Merge for 'all' mode ---
        AllCandidateMap finalAllResults;
         // Initialize final map
        for (const auto& name : targetNames) { finalAllResults[name]; }

        for (const auto& localResultMap : threadAllResults) {
            for (const auto& pair : localResultMap) {
                const std::string& name = pair.first;
                const auto& localPrimarySet = pair.second.first;
                const auto& localBackupSet = pair.second.second;
                auto& finalCandidatePair = finalAllResults.at(name);

                // Merge sets (inserts unique elements)
                finalCandidatePair.first.insert(localPrimarySet.begin(), localPrimarySet.end());
                finalCandidatePair.second.insert(localBackupSet.begin(), localBackupSet.end());
            }
        }
         // --- Build 'all' results object ---
        for (const std::string& name : targetNames) {
             const auto& finalCandidatePair = finalAllResults.at(name);
             const auto& primarySet = finalCandidatePair.first;
             const auto& backupSet = finalCandidatePair.second;

             Napi::Array coordsArray = Napi::Array::New(env);
             size_t index = 0;

             if (!primarySet.empty()) {
                 coordsArray = Napi::Array::New(env, primarySet.size());
                 for (const auto& coords : primarySet) {
                     Napi::Object obj = Napi::Object::New(env);
                     obj.Set("x", Napi::Number::New(env, coords.x));
                     obj.Set("y", Napi::Number::New(env, coords.y));
                     coordsArray[index++] = obj;
                 }
             } else if (!backupSet.empty()) {
                  coordsArray = Napi::Array::New(env, backupSet.size());
                 for (const auto& coords : backupSet) {
                     Napi::Object obj = Napi::Object::New(env);
                     obj.Set("x", Napi::Number::New(env, coords.x));
                     obj.Set("y", Napi::Number::New(env, coords.y));
                     coordsArray[index++] = obj;
                 }
             }
             // If both are empty, coordsArray remains an empty array

             results.Set(name, coordsArray);
        }
    }


    return results;
}

// --- Module Initialization --- (No changes)
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "findSequencesNative"),
                Napi::Function::New(env, FindSequencesNative));
    return exports;
}

NODE_API_MODULE(findSequences, Init)