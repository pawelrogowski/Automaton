// minimapMatcher.cc (MODIFIED FOR 4-BIT PACKING)

#include "minimapMatcher.h"
#include "positionFinderWorker.h"
#include <iostream>

// --- Helper to convert Napi::Value to std::vector<uint8_t> ---
std::vector<uint8_t> NapiBufferToVector(const Napi::Buffer<uint8_t>& buffer) {
    return std::vector<uint8_t>(buffer.Data(), buffer.Data() + buffer.Length());
}

// --- Static member initialization ---
Napi::FunctionReference MinimapMatcher::constructor;

// --- MinimapMatcher Implementation ---

Napi::Object MinimapMatcher::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "MinimapMatcher", {
        InstanceAccessor("isLoaded", &MinimapMatcher::IsLoadedGetter, &MinimapMatcher::IsLoadedSetter),
        InstanceAccessor("palette", &MinimapMatcher::PaletteGetter, &MinimapMatcher::PaletteSetter),
        InstanceAccessor("landmarkData", &MinimapMatcher::LandmarkDataGetter, &MinimapMatcher::LandmarkDataSetter),
        InstanceMethod("findPosition", &MinimapMatcher::FindPosition),
        InstanceMethod("cancelSearch", &MinimapMatcher::CancelSearch)
    });

    constructor = Napi::Persistent(func);
    exports.Set("MinimapMatcher", func);
    return exports;
}

MinimapMatcher::MinimapMatcher(const Napi::CallbackInfo& info) : Napi::ObjectWrap<MinimapMatcher>(info) {
    Napi::Object constants = info[0].As<Napi::Object>();
    LANDMARK_SIZE = constants.Get("LANDMARK_SIZE").As<Napi::Number>().Int32Value();
    // This will now receive 25 from JavaScript
    LANDMARK_PATTERN_BYTES = constants.Get("LANDMARK_PATTERN_BYTES").As<Napi::Number>().Int32Value();

    Napi::Array excludedColorsArray = constants.Get("EXCLUDED_COLORS_RGB").As<Napi::Array>();
    for (uint32_t i = 0; i < excludedColorsArray.Length(); ++i) {
        EXCLUDED_COLORS_RGB.push_back(Napi::Persistent(excludedColorsArray.Get(i).As<Napi::Object>()));
    }

    this->liveNoiseIndices = {0, 14};
    this->isLoaded = false;
    this->activeWorker = nullptr;
}

// --- Accessors (No Changes) ---
void MinimapMatcher::IsLoadedSetter(const Napi::CallbackInfo& info, const Napi::Value& value) { this->isLoaded = value.As<Napi::Boolean>().Value(); }
Napi::Value MinimapMatcher::IsLoadedGetter(const Napi::CallbackInfo& info) { return Napi::Boolean::New(info.Env(), this->isLoaded); }
void MinimapMatcher::PaletteSetter(const Napi::CallbackInfo& info, const Napi::Value& value) { this->palette = Napi::Persistent(value.As<Napi::Array>()); }
Napi::Value MinimapMatcher::PaletteGetter(const Napi::CallbackInfo& info) { return this->palette.Value(); }
Napi::Value MinimapMatcher::LandmarkDataGetter(const Napi::CallbackInfo& info) { return Napi::String::New(info.Env(), "Landmark data is stored natively."); }

// --- LandmarkDataSetter (No Changes) ---
// This function is already generic enough. It reads a buffer of LANDMARK_PATTERN_BYTES
// and uses it as a key, so it works perfectly with the new 25-byte patterns.
void MinimapMatcher::LandmarkDataSetter(const Napi::CallbackInfo& info, const Napi::Value& value) {
    Napi::Object obj = value.As<Napi::Object>();
    Napi::Array keys = obj.GetPropertyNames();
    this->landmarkData.clear();
    for (uint32_t i = 0; i < keys.Length(); ++i) {
        Napi::Value key_value = keys.Get(i);
        std::string key_str = key_value.As<Napi::String>().Utf8Value();
        int z_level = std::stoi(key_str);
        Napi::Array landmarksArray = obj.Get(key_value).As<Napi::Array>();

        LandmarkMap nativeLandmarkMap;
        for (uint32_t j = 0; j < landmarksArray.Length(); ++j) {
            Napi::Object lm_js = landmarksArray.Get(j).As<Napi::Object>();
            Napi::Buffer<uint8_t> pattern_buffer = lm_js.Get("pattern").As<Napi::Buffer<uint8_t>>();

            LandmarkPattern pattern_key(
                reinterpret_cast<const char*>(pattern_buffer.Data()),
                pattern_buffer.Length()
            );

            NativeLandmark nativeLm;
            nativeLm.x = lm_js.Get("x").As<Napi::Number>().Int32Value();
            nativeLm.y = lm_js.Get("y").As<Napi::Number>().Int32Value();

            nativeLandmarkMap[pattern_key] = nativeLm;
        }
        this->landmarkData[z_level] = std::move(nativeLandmarkMap);
    }
}

// --- FindPosition & CancelSearch (No Changes) ---
Napi::Value MinimapMatcher::FindPosition(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (this->activeWorker != nullptr) {
        this->activeWorker->Cancel();
    }
    Napi::Buffer<uint8_t> unpackedMinimapBuffer = info[0].As<Napi::Buffer<uint8_t>>();
    int minimapWidth = info[1].As<Napi::Number>().Int32Value();
    int minimapHeight = info[2].As<Napi::Number>().Int32Value();
    int targetZ = info[3].As<Napi::Number>().Int32Value();
    if (!this->isLoaded) {
         Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
         deferred.Reject(Napi::Error::New(env, "Matcher not loaded").Value());
         return deferred.Promise();
    }
    std::vector<uint8_t> unpackedMinimapVec = NapiBufferToVector(unpackedMinimapBuffer);
    PositionFinderWorker* worker = new PositionFinderWorker(env, this, unpackedMinimapVec, minimapWidth, minimapHeight, targetZ);
    worker->Queue();
    return worker->GetPromise();
}

Napi::Value MinimapMatcher::CancelSearch(const Napi::CallbackInfo& info) {
    if (this->activeWorker != nullptr) {
        this->activeWorker->Cancel();
    }
    return info.Env().Undefined();
}

// --- PositionFinderWorker Implementation ---

PositionFinderWorker::PositionFinderWorker(
    Napi::Env env,
    MinimapMatcher* matcher,
    const std::vector<uint8_t>& unpackedMinimap,
    int minimapWidth,
    int minimapHeight,
    int targetZ
) : Napi::AsyncWorker(env),
    matcherInstance(matcher),
    unpackedMinimap(unpackedMinimap),
    minimapWidth(minimapWidth),
    minimapHeight(minimapHeight),
    targetZ(targetZ),
    deferred(Napi::Promise::Deferred::New(env)) {
    this->matcherInstance->activeWorker = this;
}

PositionFinderWorker::~PositionFinderWorker() {
    if (this->matcherInstance->activeWorker == this) {
        this->matcherInstance->activeWorker = nullptr;
    }
}

void PositionFinderWorker::Cancel() { this->wasCancelled = true; }
Napi::Promise PositionFinderWorker::GetPromise() { return deferred.Promise(); }
void PositionFinderWorker::OnError(const Napi::Error& e) {
    Napi::HandleScope scope(Env());
    deferred.Reject(e.Value());
}

// --- THE CORE CHANGE IS IN THIS METHOD ---
void PositionFinderWorker::Execute() {
    auto start_time = std::chrono::high_resolution_clock::now();

    auto z_it = this->matcherInstance->landmarkData.find(targetZ);
    if (z_it == this->matcherInstance->landmarkData.end() || z_it->second.empty()) {
        this->searchMethod = "fallback_no_landmarks";
        auto end_time = std::chrono::high_resolution_clock::now();
        this->durationMs = std::chrono::duration_cast<std::chrono::microseconds>(end_time - start_time).count() / 1000.0;
        return;
    }

    const auto& landmarkMapForZ = z_it->second;
    this->searchMethod = "v2.1";
    int halfLandmark = this->matcherInstance->LANDMARK_SIZE / 2;
    const int patternPixelCount = this->matcherInstance->LANDMARK_SIZE * this->matcherInstance->LANDMARK_SIZE; // 49

    // Pre-allocate the string for our packed probe pattern (25 bytes).
    MinimapMatcher::LandmarkPattern probePattern(this->matcherInstance->LANDMARK_PATTERN_BYTES, '\0');
    char* probePatternData = probePattern.data();

    for (int y = halfLandmark; y < minimapHeight - halfLandmark; ++y) {
        if (this->wasCancelled) { return; }
        for (int x = halfLandmark; x < minimapWidth - halfLandmark; ++x) {
            bool isClean = true;

            // --- NEW: Pack the live 7x7 minimap area into the 25-byte probePattern ---
            for (int i = 0; i < patternPixelCount; ++i) {
                int my = i / this->matcherInstance->LANDMARK_SIZE;
                int mx = i % this->matcherInstance->LANDMARK_SIZE;

                uint8_t liveIndex = unpackedMinimap[(y - halfLandmark + my) * minimapWidth + (x - halfLandmark + mx)];

                if (this->matcherInstance->liveNoiseIndices.count(liveIndex)) {
                    isClean = false;
                    break;
                }

                // Pack two 4-bit palette indices into one byte
                int byteIndex = i / 2;
                if (i % 2 == 0) {
                    // First pixel goes into the high 4 bits
                    probePatternData[byteIndex] = static_cast<char>(liveIndex << 4);
                } else {
                    // Second pixel goes into the low 4 bits
                    probePatternData[byteIndex] |= static_cast<char>(liveIndex);
                }
            }

            if (isClean) {
                // This is now a lookup using the 25-byte packed key
                auto lm_it = landmarkMapForZ.find(probePattern);
                if (lm_it != landmarkMapForZ.end()) {
                    const NativeLandmark& foundLandmark = lm_it->second;

                    this->resultPosition.found = true;
                    int mapViewX = foundLandmark.x - x;
                    int mapViewY = foundLandmark.y - y;
                    this->resultPosition.x = mapViewX + (minimapWidth / 2);
                    this->resultPosition.y = mapViewY + (minimapHeight / 2);
                    this->resultPosition.z = targetZ;
                    this->resultPosition.mapViewX = mapViewX;
                    this->resultPosition.mapViewY = mapViewY;

                    auto end_time = std::chrono::high_resolution_clock::now();
                    this->durationMs = std::chrono::duration_cast<std::chrono::microseconds>(end_time - start_time).count() / 1000.0;
                    return; // Position found, exit immediately.
                }
            }
        }
    }

    this->searchMethod = "fallback_no_match";
    auto end_time = std::chrono::high_resolution_clock::now();
    this->durationMs = std::chrono::duration_cast<std::chrono::microseconds>(end_time - start_time).count() / 1000.0;
}

// --- OnOK (No Changes) ---
void PositionFinderWorker::OnOK() {
    Napi::Env env = Env();
    Napi::HandleScope scope(env);
    if (this->wasCancelled) {
        deferred.Reject(Napi::Error::New(env, "Search cancelled").Value());
        return;
    }
    Napi::Object performance = Napi::Object::New(env);
    performance.Set("totalTimeMs", Napi::Number::New(env, this->durationMs));
    performance.Set("method", Napi::String::New(env, this->searchMethod));
    Napi::Object result = Napi::Object::New(env);
    result.Set("performance", performance);
    if (this->resultPosition.found) {
        Napi::Object position = Napi::Object::New(env);
        position.Set("x", Napi::Number::New(env, this->resultPosition.x));
        position.Set("y", Napi::Number::New(env, this->resultPosition.y));
        position.Set("z", Napi::Number::New(env, this->resultPosition.z));
        result.Set("position", position);
        result.Set("mapViewX", Napi::Number::New(env, this->resultPosition.mapViewX));
        result.Set("mapViewY", Napi::Number::New(env, this->resultPosition.mapViewY));
    } else {
        result.Set("position", env.Null());
    }
    deferred.Resolve(result);
}

// --- Module Registration (No Changes) ---
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    MinimapMatcher::Init(env, exports);
    return exports;
}

NODE_API_MODULE(NODE_GYP_MODULE_NAME, Init)
