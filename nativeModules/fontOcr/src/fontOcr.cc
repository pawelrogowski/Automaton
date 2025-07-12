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
#include <cctype>
#include <sstream>
#include <emmintrin.h> // Required for SSE2 SIMD intrinsics

// --- Configuration ---
const bool ENABLE_BENCHMARKING = true;

// --- Globals & Structs ---
static bool color_lookup[256][256][256] = {false};

struct CharTemplate {
    char character;
    uint32_t width;
    uint32_t height;
    uint32_t offset;
    std::vector<uint8_t> mask_data;
    // **NEW: Pre-computed offsets of font pixels for hyper-optimized search**
    std::vector<std::pair<uint8_t, uint8_t>> font_pixel_offsets;
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

bool PerfectMatchTest_SIMD(
    const uint8_t* screen_mask, const uint32_t roi_w,
    const uint32_t match_x, const uint32_t match_y,
    const CharTemplate& tpl
) {
    for (uint32_t ty = 0; ty < tpl.height; ++ty) {
        const uint8_t* tpl_mask_row = &tpl.mask_data[ty * tpl.width];
        const uint8_t* screen_mask_row = &screen_mask[(match_y + ty) * roi_w + match_x];

        for (uint32_t tx = 0; tx < tpl.width; tx += 16) {
            if (tx + 15 < tpl.width) {
                __m128i tpl_chunk = _mm_loadu_si128(reinterpret_cast<const __m128i*>(tpl_mask_row + tx));
                __m128i screen_chunk = _mm_loadu_si128(reinterpret_cast<const __m128i*>(screen_mask_row + tx));
                __m128i comparison = _mm_cmpeq_epi8(tpl_chunk, screen_chunk);
                int mask = _mm_movemask_epi8(comparison);
                if (mask != 0xFFFF) return false;
            } else {
                for (uint32_t tail_tx = tx; tail_tx < tpl.width; ++tail_tx) {
                    if (tpl_mask_row[tail_tx] != screen_mask_row[tail_tx]) return false;
                }
            }
        }
    }
    return true;
}

// --- N-API Functions ---

Napi::Value LoadFontAtlas(const Napi::CallbackInfo& info) {
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

        std::vector<uint8_t> rgba_data(tplData.Data(), tplData.Data() + tplData.Length());

        tpl.mask_data.reserve(tpl.width * tpl.height);
        for (size_t j = 0; j < rgba_data.size(); j += 4) {
            bool is_font = is_magic_color(rgba_data[j], rgba_data[j+1], rgba_data[j+2]);
            tpl.mask_data.push_back(is_font ? 1 : 0);
            if (is_font) {
                uint32_t pixel_index = j / 4;
                uint8_t dx = pixel_index % tpl.width;
                uint8_t dy = pixel_index / tpl.width;
                tpl.font_pixel_offsets.push_back({dx, dy});
            }
        }
        fontAtlas.push_back(tpl);
    }

    const std::vector<std::tuple<uint8_t, uint8_t, uint8_t>> VALID_FONT_COLORS = {
        {240, 240, 0},   {96, 248, 248},  {32, 160, 255},  {247, 95, 95},
        {144, 144, 144}, {223, 223, 223}, {240, 240, 240}, {244, 244, 244},
        {170, 170, 170}, {255, 255, 255}, {192, 192, 192}
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
    if (info.Length() < 2 || !info[0].IsBuffer() || !info[1].IsObject()) {
        Napi::TypeError::New(env, "Invalid arguments").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Buffer<uint8_t> screenBuffer = info[0].As<Napi::Buffer<uint8_t>>();
    Napi::Object roi = info[1].As<Napi::Object>();
    const uint32_t screen_width = *reinterpret_cast<uint32_t*>(screenBuffer.Data());
    const uint8_t* screen_data = screenBuffer.Data() + 8;
    const uint32_t roi_x = roi.Get("x").As<Napi::Number>().Uint32Value();
    const uint32_t roi_y = roi.Get("y").As<Napi::Number>().Uint32Value();
    const uint32_t roi_w = roi.Get("width").As<Napi::Number>().Uint32Value();
    const uint32_t roi_h = roi.Get("height").As<Napi::Number>().Uint32Value();

    std::vector<uint8_t> screen_mask(roi_w * roi_h);
    for (uint32_t y = 0; y < roi_h; ++y) {
        for (uint32_t x = 0; x < roi_w; ++x) {
            const size_t screen_idx = ((roi_y + y) * screen_width + (roi_x + x)) * 4;
            screen_mask[y * roi_w + x] = is_valid_font_color_fast(screen_data[screen_idx + 2], screen_data[screen_idx + 1], screen_data[screen_idx + 0]) ? 1 : 0;
        }
    }

    std::vector<FoundChar> final_chars;
    std::vector<bool> consumed(roi_w * roi_h, false);

    for (uint32_t y = 0; y < roi_h; ++y) {
        for (uint32_t x = 0; x < roi_w; ++x) {
            if (consumed[y * roi_w + x] || screen_mask[y * roi_w + x] == 0) {
                continue;
            }

            std::vector<FoundChar> candidates;
            // **NEW HYPER-OPTIMIZED SEARCH**
            for (const auto& tpl : fontAtlas) {
                for (const auto& offset : tpl.font_pixel_offsets) {
                    int potential_cx = x - offset.first;
                    int potential_cy = y - offset.second;

                    if (potential_cx < 0 || potential_cy < 0) continue;
                    if (static_cast<uint32_t>(potential_cx) + tpl.width > roi_w || static_cast<uint32_t>(potential_cy) + tpl.height > roi_h) continue;

                    if (PerfectMatchTest_SIMD(screen_mask.data(), roi_w, potential_cx, potential_cy, tpl)) {
                        candidates.push_back({tpl.character, (uint32_t)(roi_x + potential_cx), (uint32_t)(roi_y + potential_cy), tpl.width, tpl.height, tpl.offset});
                    }
                }
            }

            if (!candidates.empty()) {
                auto best_it = std::max_element(candidates.begin(), candidates.end(),
                    [](const FoundChar& a, const FoundChar& b) {
                        return (a.width * a.height) < (b.width * b.height);
                    });

                FoundChar best_match = *best_it;

                uint32_t local_x_start = best_match.x - roi_x;
                uint32_t local_y_start = best_match.y - roi_y;

                // Check if this character has already been consumed by a larger one
                if (consumed[local_y_start * roi_w + local_x_start]) {
                    continue;
                }

                final_chars.push_back(best_match);

                for (uint32_t my = 0; my < best_match.height; ++my) {
                    for (uint32_t mx = 0; mx < best_match.width; ++mx) {
                        consumed[(local_y_start + my) * roi_w + (local_x_start + mx)] = true;
                    }
                }
            }
        }
    }

    // STAGE 2: Assemble the found characters into clean lines (unchanged).
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
            if (!added) {
                lines_map[line_top_y].push_back(character);
            }
        }

        const int32_t SPACE_THRESHOLD = 4;
        bool first_line_written = true;
        for (auto& pair : lines_map) {
            auto& line = pair.second;
            if (line.empty()) continue;

            std::sort(line.begin(), line.end(), [](const FoundChar& a, const FoundChar& b) { return a.x < b.x; });

            std::string raw_line_str;
            raw_line_str += line[0].character;
            for (size_t j = 1; j < line.size(); ++j) {
                const auto& prev = line[j-1];
                const auto& curr = line[j];
                int32_t gap = curr.x - (prev.x + prev.width);
                if (gap >= SPACE_THRESHOLD) {
                    raw_line_str += ' ';
                }
                raw_line_str += curr.character;
            }

            std::stringstream ss(raw_line_str);
            std::string word;
            std::string clean_line_str;
            bool first_word = true;
            while (ss >> word) {
                if (!word.empty() && isalnum(static_cast<unsigned char>(word[0]))) {
                    if (!first_word) {
                        clean_line_str += ' ';
                    }
                    clean_line_str += word;
                    first_word = false;
                }
            }

            if (!clean_line_str.empty()) {
                if (!first_line_written) {
                    final_result += "\n";
                }
                final_result += clean_line_str;
                first_line_written = false;
            }
        }
    }

    if (ENABLE_BENCHMARKING) {
        auto end_time = std::chrono::high_resolution_clock::now();
        auto duration = std::chrono::duration_cast<std::chrono::microseconds>(end_time - start_time);
        std::cout << "[OCR BENCHMARK w/HYPER-OPT] Chars: " << final_chars.size()
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