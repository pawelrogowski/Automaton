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
#include <immintrin.h> // Required for AVX2 SIMD intrinsics

// **THE FIX: Include the new headers in the correct order.**
#include "ocr_structs.h"
#include "font_atlas_data.h"

// --- Configuration ---
const bool ENABLE_BENCHMARKING = true;

// --- Global State ---
static std::vector<CharTemplate> fontAtlas;

// --- Helper Functions ---
inline bool is_valid_font_color(const uint8_t r, const uint8_t g, const uint8_t b, const std::vector<std::tuple<uint8_t, uint8_t, uint8_t>>& valid_colors) {
    for (const auto& color : valid_colors) {
        if (std::get<0>(color) == r && std::get<1>(color) == g && std::get<2>(color) == b) {
            return true;
        }
    }
    return false;
}

bool FinalMatchTest(const uint8_t* screen_data, uint32_t screen_width, uint32_t match_x, uint32_t match_y, const CharTemplate& tpl, uint8_t ref_r, uint8_t ref_g, uint8_t ref_b, const std::vector<std::tuple<uint8_t, uint8_t, uint8_t>>& valid_colors) {
    for (const auto& offset : tpl.font_pixel_offsets) {
        const size_t idx = ((match_y + offset.second) * screen_width + (match_x + offset.first)) * 4;
        if (screen_data[idx + 2] != ref_r || screen_data[idx + 1] != ref_g || screen_data[idx + 0] != ref_b) return false;
    }
    for (const auto& offset : tpl.bg_pixel_offsets) {
        const size_t idx = ((match_y + offset.second) * screen_width + (match_x + offset.first)) * 4;
        if (is_valid_font_color(screen_data[idx + 2], screen_data[idx + 1], screen_data[idx + 0], valid_colors)) return false;
    }
    return true;
}

// --- N-API Functions ---

Napi::Value RecognizeText(const Napi::CallbackInfo& info) {
    auto start_time = std::chrono::high_resolution_clock::now();
    Napi::Env env = info.Env();

    if (info.Length() < 3 || !info[0].IsBuffer() || !info[1].IsObject() || !info[2].IsArray()) {
        Napi::TypeError::New(env, "Usage: recognizeText(screenBuffer, roi, validColors)").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Buffer<uint8_t> screenBuffer = info[0].As<Napi::Buffer<uint8_t>>();
    Napi::Object roi = info[1].As<Napi::Object>();
    Napi::Array jsColors = info[2].As<Napi::Array>();

    const uint32_t screen_width = *reinterpret_cast<uint32_t*>(screenBuffer.Data());
    const uint8_t* screen_data = screenBuffer.Data() + 8;
    const uint32_t roi_x = roi.Get("x").As<Napi::Number>().Uint32Value();
    const uint32_t roi_y = roi.Get("y").As<Napi::Number>().Uint32Value();
    const uint32_t roi_w = roi.Get("width").As<Napi::Number>().Uint32Value();
    const uint32_t roi_h = roi.Get("height").As<Napi::Number>().Uint32Value();

    std::vector<std::tuple<uint8_t, uint8_t, uint8_t>> valid_colors;
    valid_colors.reserve(jsColors.Length());
    for (uint32_t i = 0; i < jsColors.Length(); ++i) {
        Napi::Array colorTuple = jsColors.Get(i).As<Napi::Array>();
        valid_colors.emplace_back(
            colorTuple.Get((uint32_t)0).As<Napi::Number>().Uint32Value(),
            colorTuple.Get((uint32_t)1).As<Napi::Number>().Uint32Value(),
            colorTuple.Get((uint32_t)2).As<Napi::Number>().Uint32Value()
        );
    }

    std::vector<bool> consumed(roi_w * roi_h, false);
    std::vector<FoundChar> final_chars;
    std::map<uint32_t, std::vector<FoundChar>> lines_map;

    for (uint32_t y = 0; y < roi_h; ++y) {
        for (uint32_t x = 0; x < roi_w; ++x) {
            if (consumed[y * roi_w + x]) continue;

            const size_t trigger_idx = ((roi_y + y) * screen_width + (roi_x + x)) * 4;
            const uint8_t trigger_r = screen_data[trigger_idx + 2];
            const uint8_t trigger_g = screen_data[trigger_idx + 1];
            const uint8_t trigger_b = screen_data[trigger_idx + 0];

            if (!is_valid_font_color(trigger_r, trigger_g, trigger_b, valid_colors)) continue;

            std::vector<FoundChar> candidates;
            for (const auto& tpl : fontAtlas) {
                for (const auto& offset : tpl.font_pixel_offsets) {
                    int potential_cx = x - offset.first;
                    int potential_cy = y - offset.second;
                    if (potential_cx < 0 || potential_cy < 0) continue;
                    if (static_cast<uint32_t>(potential_cx) + tpl.width > roi_w || static_cast<uint32_t>(potential_cy) + tpl.height > roi_h) continue;

                    if (FinalMatchTest(screen_data, screen_width, roi_x + potential_cx, roi_y + potential_cy, tpl, trigger_r, trigger_g, trigger_b, valid_colors)) {
                        candidates.emplace_back(tpl.character, (uint32_t)(roi_x + potential_cx), (uint32_t)(roi_y + potential_cy), tpl.width, tpl.height, tpl.offset, trigger_r, trigger_g, trigger_b);
                    }
                }
            }
            if (!candidates.empty()) {
                auto best_it = std::max_element(candidates.begin(), candidates.end(), [](const FoundChar& a, const FoundChar& b) { return (a.width * a.height) < (b.width * b.height); });
                FoundChar best_match = *best_it;
                uint32_t local_x_start = best_match.x - roi_x;
                uint32_t local_y_start = best_match.y - roi_y;
                if (consumed[local_y_start * roi_w + local_x_start]) continue;
                final_chars.push_back(best_match);
                for (uint32_t my = 0; my < best_match.height; ++my) for (uint32_t mx = 0; mx < best_match.width; ++mx) consumed[(local_y_start + my) * roi_w + (local_x_start + mx)] = true;
            }
        }
    }

    std::string final_result = "";
    if (!final_chars.empty()) {
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
            if (!added) lines_map[line_top_y].push_back(character);
        }
        const int32_t SPACE_THRESHOLD = 4;
        bool first_line_written = true;
        for (auto& pair : lines_map) {
            auto& line = pair.second;
            if (line.empty()) continue;
            std::sort(line.begin(), line.end(), [](const FoundChar& a, const FoundChar& b) { return a.x < b.x; });

            std::string raw_line_str;
            uint8_t word_r = 0, word_g = 0, word_b = 0;
            bool in_word = false;

            for (size_t j = 0; j < line.size(); ++j) {
                const auto& curr = line[j];
                if (j == 0) {
                    in_word = true;
                    word_r = curr.r; word_g = curr.g; word_b = curr.b;
                    raw_line_str += curr.character;
                } else {
                    const auto& prev = line[j-1];
                    int32_t gap = curr.x - (prev.x + prev.width);
                    if (gap >= SPACE_THRESHOLD) {
                        in_word = true;
                        word_r = curr.r; word_g = curr.g; word_b = curr.b;
                        raw_line_str += ' ';
                        raw_line_str += curr.character;
                    } else {
                        if (in_word && curr.r == word_r && curr.g == word_g && curr.b == word_b) {
                            raw_line_str += curr.character;
                        } else {
                            in_word = false;
                        }
                    }
                }
            }

            std::stringstream ss(raw_line_str);
            std::string word, clean_line_str;
            bool first_word = true;
            while (ss >> word) {
                if (!word.empty() && isalnum(static_cast<unsigned char>(word[0]))) {
                    if (!first_word) clean_line_str += ' ';
                    clean_line_str += word;
                    first_word = false;
                }
            }
            if (!clean_line_str.empty()) {
                if (!first_line_written) final_result += "\n";
                final_result += clean_line_str;
                first_line_written = false;
            }
        }
    }

    if (ENABLE_BENCHMARKING) {
        auto end_time = std::chrono::high_resolution_clock::now();
        auto duration = std::chrono::duration_cast<std::chrono::microseconds>(end_time - start_time);
        std::cout << "[OCR BENCHMARK w/HARDCODED ATLAS] Chars: " << final_chars.size() << " | Time: " << duration.count() << " us" << std::endl;
    }
    return Napi::String::New(env, final_result);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    HardcodedInitializeFontAtlas(fontAtlas);
    exports.Set("recognizeText", Napi::Function::New(env, RecognizeText));
    return exports;
}

NODE_API_MODULE(fontocr, Init)