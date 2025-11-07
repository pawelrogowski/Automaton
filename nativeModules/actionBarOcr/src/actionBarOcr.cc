#include <napi.h>
#include <vector>
#include <string>
#include <cstdint>
#include <algorithm>
#include <set>
#include <array>
#include <tuple>
#include <map>
#include <utility>
#include <unordered_map>
#include <unordered_set>
#include <immintrin.h>
#include "actionBarFontData.h"

// Include ocr_structs.h for CharTemplate, Point, FoundChar
#include "../../fontOcr/src/ocr_structs.h"

// --- Global State ---
static std::vector<CharTemplate> fontAtlas;
static std::map<Point, std::vector<const CharTemplate*>> triggerMap;   // Point is from ocr_structs.h
static std::map<char, const CharTemplate*> charToTemplateMap;

// --- Helper: pack RGB -> 0xAARRGGBB (A=0xFF) matching BGRA byte order in memory ---
static inline uint32_t PackBGRA(uint8_t r, uint8_t g, uint8_t b) {
    return (0xFFu << 24) | (uint32_t(r) << 16) | (uint32_t(g) << 8) | uint32_t(b);
}

// --- Fast color set built from valid font colors (in packed ARGB/BGRA) ---
struct ColorSet {
    std::unordered_set<uint32_t> S;
    std::vector<__m256i> v; // AVX2 broadcast constants for prescan

    void build(const std::vector<std::tuple<uint8_t,uint8_t,uint8_t>>& colors) {
        S.clear(); v.clear();
        S.reserve(colors.size()*2);
        v.reserve(colors.size());
        for (auto &t : colors) {
            uint8_t r = std::get<0>(t), g = std::get<1>(t), b = std::get<2>(t);
            uint32_t packed = PackBGRA(r,g,b);
            S.insert(packed);
            v.push_back(_mm256_set1_epi32((int)packed));
        }
    }
    inline bool has(uint32_t packed) const {
        return S.find(packed) != S.end();
    }
};

// Global templates
const Pixel* digit_templates[10] = {
    digit0_pixels, digit1_pixels, digit2_pixels, digit3_pixels, digit4_pixels,
    digit5_pixels, digit6_pixels, digit7_pixels, digit8_pixels, digit9_pixels
};
const size_t digit_counts[10] = {
    digit0_pixel_count, digit1_pixel_count, digit2_pixel_count, digit3_pixel_count,
    digit4_pixel_count, digit5_pixel_count, digit6_pixel_count, digit7_pixel_count,
    digit8_pixel_count, digit9_pixel_count
};

// --- Helper Functions ---
inline bool is_valid_font_color_tuple(uint8_t r, uint8_t g, uint8_t b,
    const std::vector<std::tuple<uint8_t,uint8_t,uint8_t>>& valid_colors)
{
    for (const auto& color : valid_colors)
        if (std::get<0>(color)==r && std::get<1>(color)==g && std::get<2>(color)==b) return true;
    return false;
}

// Tight/fast final match: compare glyph "on" pixels to a reference font color, and ensure bg pixels are NOT any valid font color.
static inline bool FinalMatchTestFast(
    const uint8_t* __restrict screen_data,
    uint32_t screen_width,
    uint32_t match_x, uint32_t match_y,
    const CharTemplate& tpl,
    uint32_t ref_packed,                      // packed BGRA 0xAARRGGBB
    const ColorSet& validPacked               // set of packed BGRA valid colors
){
    // Foreground: must equal ref_packed
    for (const auto& off : tpl.font_pixel_offsets) {
        size_t idx = ((size_t)(match_y + off.second) * screen_width + (match_x + off.first)) * 4u;
        uint32_t pix = *reinterpret_cast<const uint32_t*>(screen_data + idx);
        if (pix != ref_packed) return false;
    }
    // Background guard: must NOT be any valid font color
    for (const auto& off : tpl.bg_pixel_offsets) {
        size_t idx = ((size_t)(match_y + off.second) * screen_width + (match_x + off.first)) * 4u;
        uint32_t pix = *reinterpret_cast<const uint32_t*>(screen_data + idx);
        if (validPacked.has(pix)) return false;
    }
    return true;
}

// --- Pre-computation ---
static void PrecomputeMaps() {
    if (!triggerMap.empty()) return;
    for (const auto& tpl : fontAtlas) {
        for (const auto& offset : tpl.font_pixel_offsets) {
            triggerMap[{offset.first, offset.second}].push_back(&tpl);
        }
        charToTemplateMap[tpl.character] = &tpl;
    }
}

// Check if a 4x6 window at (dx, dy) matches the digit template exactly
// Assumes scale=1; for scale>1, would need block matching
bool matchesDigit(const uint8_t* screen_data, uint32_t screen_width, uint32_t screen_height,
                  uint32_t dx, uint32_t dy, int digit_idx) {
    if (digit_idx < 0 || digit_idx > 9) return false;
    const Pixel* templ = digit_templates[digit_idx];
    size_t count = digit_counts[digit_idx];

    // Check all template pixels match exactly
    for (size_t i = 0; i < count; ++i) {
        const Pixel& p = templ[i];
        uint32_t sx = dx + p.x;
        uint32_t sy = dy + p.y;
        if (sx >= screen_width || sy >= screen_height) return false;
        size_t idx = ((sy * screen_width + sx) * 4);
        uint8_t screen_r = screen_data[idx + 2];  // R in BGRA
        uint8_t screen_g = screen_data[idx + 1];  // G
        uint8_t screen_b = screen_data[idx + 0];  // B
        if (screen_r != p.r || screen_g != p.g || screen_b != p.b) return false;
    }
    return true;
}

struct Candidate {
    int digit;
    uint32_t x, y;
};


Napi::Value RecognizeNumber(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 5 || !info[0].IsBuffer() || !info[1].IsNumber() ||
        !info[2].IsNumber() || !info[3].IsNumber() || !info[4].IsNumber()) {
        Napi::TypeError::New(env, "Usage: recognizeNumber(screenBuffer, width, height, x, y, [scale])").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Buffer<uint8_t> screenBuffer = info[0].As<Napi::Buffer<uint8_t>>();
    if (screenBuffer.Length() < 8) {
        Napi::TypeError::New(env, "screenBuffer too small").ThrowAsJavaScriptException();
        return env.Null();
    }

    // Parse screen dimensions from buffer header (matching fontOcr)
    const uint32_t screen_width = *reinterpret_cast<const uint32_t*>(screenBuffer.Data());
    const uint32_t screen_height = *reinterpret_cast<const uint32_t*>(screenBuffer.Data() + 4);
    const uint8_t* screen_data = screenBuffer.Data() + 8;

    uint32_t start_x = info[3].As<Napi::Number>().Uint32Value();
    uint32_t start_y = info[4].As<Napi::Number>().Uint32Value();
    uint32_t scale = (info.Length() > 5 && info[5].IsNumber()) ? info[5].As<Napi::Number>().Uint32Value() : 1u;

    // For now, implement for scale=1; scale parameter parsed but not used in matching
    // TODO: Extend matching for scale >1 by checking blocks of scale x scale pixels
    if (scale != 1) {
        Napi::TypeError::New(env, "Scale must be 1 (not yet supported for >1)").ThrowAsJavaScriptException();
        return env.Null();
    }

    // Bounds check
    if (start_x + 32 > screen_width || start_y + 10 > screen_height) {
        return Napi::String::New(env, "-1");
    }

    std::vector<Candidate> candidates;
    for (uint32_t sy = start_y; sy < start_y + 10; ++sy) {
        for (uint32_t sx = start_x; sx < start_x + 32; ++sx) {
            if (sy >= screen_height || sx >= screen_width) continue;
            size_t idx = ((sy * screen_width + sx) * 4);
            uint8_t screen_r = screen_data[idx + 2];
            uint8_t screen_g = screen_data[idx + 1];
            uint8_t screen_b = screen_data[idx + 0];

            ColorKey color = {screen_r, screen_g, screen_b};
            auto map_it = colorCandidates.find(color);
            if (map_it != colorCandidates.end()) {
                for (const auto& cand : map_it->second) {
                    uint32_t ax = sx - cand.rel_x;
                    uint32_t ay = sy - cand.rel_y;

                    // Check if aligned position is within the slot
                    if (ax < start_x || ax + 4 > start_x + 32) continue;

                    if (matchesDigit(screen_data, screen_width, screen_height, ax, ay, cand.digit)) {
                        candidates.push_back({cand.digit, ax, ay});
                    }
                }
            }
        }
    }

    // Remove duplicates
    std::set<std::tuple<uint32_t, uint32_t, int>> unique_cands;
    for (const auto& c : candidates) {
        unique_cands.insert(std::make_tuple(c.x, c.y, c.digit));
    }
    candidates.clear();
    for (const auto& t : unique_cands) {
        uint32_t xx, yy;
        int dd;
        std::tie(xx, yy, dd) = t;
        candidates.push_back({dd, xx, yy});
    }

    // Group by y
    std::map<uint32_t, std::map<uint32_t, int>> y_to_xdigit;
    for (const auto& c : candidates) {
        y_to_xdigit[c.y][c.x] = c.digit;
    }

    int best_length = 0;
    uint32_t best_start_x = 0;
    std::string best_str;

    for (const auto& ypair : y_to_xdigit) {
        const auto& xmap = ypair.second;
        if (xmap.empty()) continue;

        std::vector<uint32_t> xs;
        for (const auto& p : xmap) {
            xs.push_back(p.first);
        }
        std::sort(xs.begin(), xs.end());

        for (size_t i = 0; i < xs.size(); ++i) {
            uint32_t curr_x = xs[i];
            std::vector<int> seq;
            seq.push_back(xmap.at(curr_x));
            uint32_t last_x = curr_x;
            int len = 1;
            while (len < 5) {
                uint32_t min_next = last_x + 4;
                uint32_t max_next = last_x + 6;
                auto it = xmap.lower_bound(min_next);
                if (it == xmap.end() || it->first > max_next) break;
                seq.push_back(it->second);
                last_x = it->first;
                ++len;
            }

            if (len > best_length || (len == best_length && curr_x > best_start_x)) {
                best_length = len;
                best_start_x = curr_x;
                best_str.clear();
                for (int dd : seq) {
                    best_str += static_cast<char>('0' + dd);
                }
            }
        }
    }

    std::string number_str = (best_length >= 1) ? best_str : "-1";

    return Napi::String::New(env, number_str);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("recognizeNumber", Napi::Function::New(env, RecognizeNumber));
    return exports;
}

NODE_API_MODULE(actionbarocr, Init)