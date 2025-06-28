// minimapMatcher.h

#ifndef MINIMAP_MATCHER_H
#define MINIMAP_MATCHER_H

#include <napi.h>
#include <vector>
#include <string>        // <--- ADDED
#include <set>
#include <map>
#include <unordered_map> // <--- ADDED
#include <atomic>

// --- Forward Declarations ---
// We tell the compiler these classes exist without defining them yet.
class PositionFinderWorker;

// --- Native Data Structures ---
struct NativeLandmark {
    int x;
    int y;
};

// --- The Main MinimapMatcher Class Declaration ---
class MinimapMatcher : public Napi::ObjectWrap<MinimapMatcher> {
public:
    // --- Static Methods ---
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    static Napi::FunctionReference constructor;

    // --- Constructor ---
    MinimapMatcher(const Napi::CallbackInfo& info);

    // --- Public Members (for worker access) ---
    int LANDMARK_SIZE;
    int LANDMARK_PATTERN_BYTES;
    std::set<int> liveNoiseIndices;

    // --- NEW: Type aliases for clarity and easy modification ---
    using LandmarkPattern = std::string;
    using LandmarkMap = std::unordered_map<LandmarkPattern, NativeLandmark>;

    // --- CHANGED: Use the new, faster unordered_map ---
    std::map<int, LandmarkMap> landmarkData;

    PositionFinderWorker* activeWorker; // Pointer to an incomplete type is allowed

private:
    // --- Instance Methods ---
    Napi::Value FindPosition(const Napi::CallbackInfo& info);
    Napi::Value CancelSearch(const Napi::CallbackInfo& info);

    // --- Accessors ---
    void IsLoadedSetter(const Napi::CallbackInfo& info, const Napi::Value& value);
    Napi::Value IsLoadedGetter(const Napi::CallbackInfo& info);
    void PaletteSetter(const Napi::CallbackInfo& info, const Napi::Value& value);
    Napi::Value PaletteGetter(const Napi::CallbackInfo& info);
    void LandmarkDataSetter(const Napi::CallbackInfo& info, const Napi::Value& value);
    Napi::Value LandmarkDataGetter(const Napi::CallbackInfo& info);

    // --- Private Members ---
    bool isLoaded;
    Napi::Reference<Napi::Array> palette;
    std::vector<Napi::Reference<Napi::Object>> EXCLUDED_COLORS_RGB;
};

#endif 