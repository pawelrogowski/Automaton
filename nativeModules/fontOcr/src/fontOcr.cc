#include <napi.h>
#include <vector>
#include <string>
#include <cstdint>
#include <algorithm>
#include <tuple>
#include <cmath>
#include <chrono>
#include <iostream>
#include <iomanip>
#include <map>
#include <queue>

// --- Configuration ---
const bool ENABLE_BENCHMARKING = false;

// --- Globals & Structs ---
static bool color_lookup[256][256][256] = {false};

struct CharTemplate {
    char character;
    uint32_t width;
    uint32_t height;
    uint32_t offset;
    std::vector<uint8_t> rgba_data;
};

struct FoundChar {
    char character;
    uint32_t x;
    uint32_t y;
    uint32_t width;
    uint32_t height;
    uint32_t offset;
};

static std::vector<CharTemplate> fontAtlas;

// --- Helper Functions ---
inline bool is_magic_color(const uint8_t r, const uint8_t g, const uint8_t b) {
    return r == 255 && g == 0 && b == 255;
}

inline bool is_valid_font_color_fast(const uint8_t r, const uint8_t g, const uint8_t b) {
    return color_lookup[r][g][b];
}

// FINAL, ROBUST MATCH FUNCTION: Handles multi-colored characters correctly.
bool PerfectMatchTest_Final(
    const uint8_t* screen_data, const uint32_t screen_width,
    const uint32_t match_x, const uint32_t match_y,
    const CharTemplate& tpl
) {
    for (uint32_t ty = 0; ty < tpl.height; ++ty) {
        for (uint32_t tx = 0; tx < tpl.width; ++tx) {
            const size_t tpl_idx = (ty * tpl.width + tx) * 4;
            const uint8_t tpl_r = tpl.rgba_data[tpl_idx];
            const uint8_t tpl_g = tpl.rgba_data[tpl_idx + 1];
            const uint8_t tpl_b = tpl.rgba_data[tpl_idx + 2];

            const size_t screen_idx = ((match_y + ty) * screen_width + (match_x + tx)) * 4;
            const uint8_t screen_r = screen_data[screen_idx + 2];
            const uint8_t screen_g = screen_data[screen_idx + 1];
            const uint8_t screen_b = screen_data[screen_idx + 0];

            if (is_magic_color(tpl_r, tpl_g, tpl_b)) {
                // If template expects a font pixel, the screen pixel MUST be a valid font color.
                if (!is_valid_font_color_fast(screen_r, screen_g, screen_b)) {
                    return false;
                }
            } else { // Template expects a background pixel.
                // If template expects a background pixel, the screen pixel MUST NOT be a valid font color.
                if (is_valid_font_color_fast(screen_r, screen_g, screen_b)) {
                    return false;
                }
            }
        }
    }

    return true; // The template pattern matches perfectly.
}

// --- N-API Functions ---

Napi::Value LoadFontAtlas(const Napi::CallbackInfo& info) {
    // This function is correct and unchanged
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Expected an object as the font atlas").ThrowAsJavaScriptException();
        return env.Null();
    }
    fontAtlas.clear();
    Napi::Object jsAtlas = info[0].As<Napi::Object>();
    Napi::Array chars = jsAtlas.GetPropertyNames();
    for (uint32_t i = 0; i < chars.Length(); ++i) {
        Napi::String jsChar = chars.Get(i).As<Napi::String>();
        std::string charStr = jsChar.Utf8Value();
        Napi::Object jsTpl = jsAtlas.Get(jsChar).As<Napi::Object>();
        Napi::Buffer<uint8_t> tplData = jsTpl.Get("data").As<Napi::Buffer<uint8_t>>();
        CharTemplate tpl;
        tpl.character = charStr.length() > 0 ? charStr[0] : ' ';
        tpl.width = jsTpl.Get("width").As<Napi::Number>().Uint32Value();
        tpl.height = jsTpl.Get("height").As<Napi::Number>().Uint32Value();
        tpl.offset = jsTpl.Get("offset").As<Napi::Number>().Uint32Value();
        tpl.rgba_data.assign(tplData.Data(), tplData.Data() + tplData.Length());
        fontAtlas.push_back(tpl);
    }
    const std::vector<std::tuple<uint8_t, uint8_t, uint8_t>> VALID_FONT_COLORS = {
        {240, 240, 0},   {96, 248, 248},  {32, 160, 255},  {247, 95, 95},
        {144, 144, 144}, {223, 223, 223}, {240, 240, 240}, {244, 244, 244},
        {170, 170, 170}, {255, 255, 255}
    };
    memset(color_lookup, 0, sizeof(color_lookup));
    for (const auto& color : VALID_FONT_COLORS) {
        color_lookup[std::get<0>(color)][std::get<1>(color)][std::get<2>(color)] = true;
    }
    return env.Undefined();
}

Napi::Value RecognizeText(const Napi::CallbackInfo& info) {
    auto start_time = std::chrono::high_resolution_clock::now();
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsBuffer() || !info[1].IsObject()) { /* error handling */ }

    Napi::Buffer<uint8_t> screenBuffer = info[0].As<Napi::Buffer<uint8_t>>();
    Napi::Object roi = info[1].As<Napi::Object>();
    const uint32_t screen_width = *reinterpret_cast<uint32_t*>(screenBuffer.Data());
    const uint8_t* screen_data = screenBuffer.Data() + 8;
    const uint32_t roi_x = roi.Get("x").As<Napi::Number>().Uint32Value();
    const uint32_t roi_y = roi.Get("y").As<Napi::Number>().Uint32Value();
    const uint32_t roi_w = roi.Get("width").As<Napi::Number>().Uint32Value();
    const uint32_t roi_h = roi.Get("height").As<Napi::Number>().Uint32Value();

    std::vector<FoundChar> final_chars;
    std::vector<bool> consumed(roi_w * roi_h, false);

    const int SEARCH_RADIUS_X = 8;
    const int SEARCH_RADIUS_Y = 16;

    for (uint32_t y = 0; y < roi_h; ++y) {
        for (uint32_t x = 0; x < roi_w; ++x) {
            if (consumed[y * roi_w + x]) continue;

            const size_t screen_idx = ((roi_y + y) * screen_width + (roi_x + x)) * 4;
            if (!is_valid_font_color_fast(screen_data[screen_idx + 2], screen_data[screen_idx + 1], screen_data[screen_idx + 0])) {
                continue;
            }

            std::vector<FoundChar> candidates;
            int start_y = std::max(0, (int)y - SEARCH_RADIUS_Y);
            int start_x = std::max(0, (int)x - SEARCH_RADIUS_X);

            for (int cy = start_y; cy <= (int)y; ++cy) {
                for (int cx = start_x; cx <= (int)x; ++cx) {
                    for (const auto& tpl : fontAtlas) {
                        if (cx + tpl.width > roi_w || cy + tpl.height > roi_h) continue;
                        if (x < cx || x >= cx + tpl.width || y < cy || y >= cy + tpl.height) continue;

                        if (PerfectMatchTest_Final(screen_data, screen_width, roi_x + cx, roi_y + cy, tpl)) {
                            candidates.push_back({tpl.character, (uint32_t)(roi_x + cx), (uint32_t)(roi_y + cy), tpl.width, tpl.height, tpl.offset});
                        }
                    }
                }
            }

            if (!candidates.empty()) {
                auto best_it = std::max_element(candidates.begin(), candidates.end(),
                    [](const FoundChar& a, const FoundChar& b) {
                        return (a.width * a.height) < (b.width * b.height);
                    });

                FoundChar best_match = *best_it;
                final_chars.push_back(best_match);

                uint32_t local_x_start = best_match.x - roi_x;
                uint32_t local_y_start = best_match.y - roi_y;
                for (uint32_t my = 0; my < best_match.height; ++my) {
                    for (uint32_t mx = 0; mx < best_match.width; ++mx) {
                        uint32_t consumed_y = local_y_start + my;
                        uint32_t consumed_x = local_x_start + mx;
                        if (consumed_y < roi_h && consumed_x < roi_w) {
                            consumed[consumed_y * roi_w + consumed_x] = true;
                        }
                    }
                }
            }
        }
    }

    // --- Line Assembly (Unchanged, your original code is fine here) ---
    std::string final_result = "";
    if (!final_chars.empty()) {
        std::map<uint32_t, std::vector<FoundChar>> lines_map;
        const int LINE_Y_TOLERANCE = 2;
        for (const auto& character : final_chars) {
            uint32_t line_top_y = character.y - character.offset;
            bool added = false;
            for (auto& pair : lines_map) {
                if (std::abs(static_cast<int>(line_top_y) - static_cast<int>(pair.first)) <= LINE_Y_TOLERANCE) {
                    pair.second.push_back(character);
                    added = true;
                    break;
                }
            }
            if (!added) { lines_map[line_top_y].push_back(character); }
        }
        const int32_t SPACE_THRESHOLD = 4; // Your preferred value
        bool first_line = true;
        for (auto& pair : lines_map) {
            auto& line = pair.second;
            std::sort(line.begin(), line.end(), [](const FoundChar& a, const FoundChar& b) { return a.x < b.x; });
            if (!first_line) final_result += "\n";
            first_line = false;
            if (!line.empty()) {
                final_result += line[0].character;
                for (size_t j = 1; j < line.size(); ++j) {
                    const auto& prev = line[j-1];
                    const auto& curr = line[j];
                    int32_t gap = curr.x - (prev.x + prev.width);
                    if (gap >= SPACE_THRESHOLD) { final_result += ' '; }
                    final_result += curr.character;
                }
            }
        }
    }

    if (ENABLE_BENCHMARKING) {
        auto end_time = std::chrono::high_resolution_clock::now();
        auto duration = std::chrono::duration_cast<std::chrono::microseconds>(end_time - start_time);
        std::cout << "[OCR BENCHMARK Final] Chars: " << final_chars.size()
                  << " | Time: " << duration.count() << " us" << std::endl;
    }

    return Napi::String::New(env, final_result);
}

// --- Module Initialization ---
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("loadFontAtlas", Napi::Function::New(env, LoadFontAtlas));
    exports.Set("recognizeText", Napi::Function::New(env, RecognizeText));
    return exports;
}

NODE_API_MODULE(fontocr, Init)