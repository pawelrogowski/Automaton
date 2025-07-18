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
#include <immintrin.h>

#include "ocr_structs.h"
#include "font_atlas_data.h"

// --- Configuration ---
const bool ENABLE_BENCHMARKING = false;

// --- Global State ---
static std::vector<CharTemplate> fontAtlas;

// --- CHANGE: Updated struct to hold click coordinates and color ---
struct TextContext {
    std::string text;
    uint32_t x;
    uint32_t y;
    uint32_t clickX;
    uint32_t clickY;
    uint8_t colorR;
    uint8_t colorG;
    uint8_t colorB;
};

// --- Helper Functions (Unchanged) ---
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

    std::vector<__m256i> avx_valid_colors;
    for (const auto& color : valid_colors) {
        uint32_t b = std::get<2>(color);
        uint32_t g = std::get<1>(color);
        uint32_t r = std::get<0>(color);
        uint32_t bgra_val = (0xFF << 24) | (r << 16) | (g << 8) | b;
        avx_valid_colors.push_back(_mm256_set1_epi32(bgra_val));
    }

    std::vector<bool> consumed(roi_w * roi_h, false);
    std::vector<FoundChar> final_chars;

    for (uint32_t y = 0; y < roi_h; ++y) {
        const uint8_t* row_ptr = screen_data + ((roi_y + y) * screen_width + roi_x) * 4;

        for (uint32_t x = 0; x < roi_w; ) {
            if (!avx_valid_colors.empty() && x + 8 <= roi_w) {
                __m256i screen_chunk = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(row_ptr + x * 4));
                __m256i combined_mask_vec = _mm256_setzero_si256();

                for (const auto& color_vec : avx_valid_colors) {
                    __m256i cmp_result = _mm256_cmpeq_epi32(screen_chunk, color_vec);
                    combined_mask_vec = _mm256_or_si256(combined_mask_vec, cmp_result);
                }

                int found_mask = _mm256_movemask_ps(_mm256_castsi256_ps(combined_mask_vec));

                if (found_mask != 0) {
                    for (int j = 0; j < 8; ++j) {
                        if ((found_mask >> j) & 1) {
                            uint32_t current_x = x + j;
                            if (consumed[y * roi_w + current_x]) continue;

                            const size_t trigger_idx = ((roi_y + y) * screen_width + (roi_x + current_x)) * 4;
                            const uint8_t trigger_r = screen_data[trigger_idx + 2];
                            const uint8_t trigger_g = screen_data[trigger_idx + 1];
                            const uint8_t trigger_b = screen_data[trigger_idx + 0];

                            std::vector<FoundChar> candidates;
                            for (const auto& tpl : fontAtlas) {
                                for (const auto& offset : tpl.font_pixel_offsets) {
                                    int potential_cx = current_x - offset.first;
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
                }
                x += 8;
                continue;
            }

            if (consumed[y * roi_w + x]) {
                x++;
                continue;
            }

            const size_t trigger_idx = ((roi_y + y) * screen_width + (roi_x + x)) * 4;
            const uint8_t trigger_r = screen_data[trigger_idx + 2];
            const uint8_t trigger_g = screen_data[trigger_idx + 1];
            const uint8_t trigger_b = screen_data[trigger_idx + 0];

            if (!is_valid_font_color(trigger_r, trigger_g, trigger_b, valid_colors)) {
                x++;
                continue;
            }

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
                if (consumed[local_y_start * roi_w + local_x_start]) {
                    x++;
                    continue;
                }
                final_chars.push_back(best_match);
                for (uint32_t my = 0; my < best_match.height; ++my) for (uint32_t mx = 0; mx < best_match.width; ++mx) consumed[(local_y_start + my) * roi_w + (local_x_start + mx)] = true;
            }
            x++;
        }
    }

    std::vector<TextContext> final_contexts;
    if (!final_chars.empty()) {
        std::sort(final_chars.begin(), final_chars.end(), [](const FoundChar& a, const FoundChar& b) {
            uint32_t a_line_y = a.y - a.offset;
            uint32_t b_line_y = b.y - b.offset;
            if (a_line_y != b_line_y) {
                return a_line_y < b_line_y;
            }
            return a.x < b.x;
        });

        const int32_t LINE_Y_TOLERANCE = 2;
        const int32_t SPACE_THRESHOLD = 4;
        const int32_t CONTEXT_GAP_THRESHOLD = 12;

        TextContext current_context;
        const FoundChar* start_char_of_context = &final_chars.front();

        for (size_t i = 1; i < final_chars.size(); ++i) {
            const auto& prev = final_chars[i-1];
            const auto& curr = final_chars[i];

            uint32_t prev_line_y = prev.y - prev.offset;
            uint32_t curr_line_y = curr.y - curr.offset;

            int32_t y_gap = std::abs(static_cast<int>(curr_line_y) - static_cast<int>(prev_line_y));
            int32_t x_gap = curr.x - (prev.x + prev.width);

            if (y_gap > LINE_Y_TOLERANCE || x_gap >= CONTEXT_GAP_THRESHOLD) {
                // --- CHANGE: Finish the previous context and calculate its click point ---
                current_context.text = ""; // Will be rebuilt below
                uint32_t context_right = 0;
                for (const FoundChar* ch = start_char_of_context; ch <= &prev; ++ch) {
                    if (ch > start_char_of_context) {
                        int32_t inner_gap = ch->x - ((ch-1)->x + (ch-1)->width);
                        if (inner_gap >= SPACE_THRESHOLD) current_context.text += ' ';
                    }
                    current_context.text += ch->character;
                    context_right = ch->x + ch->width;
                }

                current_context.x = start_char_of_context->x;
                current_context.y = start_char_of_context->y - start_char_of_context->offset;
                current_context.clickX = current_context.x + (context_right - current_context.x) / 2;
                current_context.clickY = current_context.y + start_char_of_context->height / 2;
                current_context.colorR = start_char_of_context->r;
                current_context.colorG = start_char_of_context->g;
                current_context.colorB = start_char_of_context->b;
                final_contexts.push_back(current_context);

                // Start a new context
                start_char_of_context = &curr;
            }
        }

        // --- CHANGE: Process the very last context after the loop finishes ---
        current_context.text = "";
        uint32_t context_right = 0;
        for (const FoundChar* ch = start_char_of_context; ch <= &final_chars.back(); ++ch) {
            if (ch > start_char_of_context) {
                int32_t inner_gap = ch->x - ((ch-1)->x + (ch-1)->width);
                if (inner_gap >= SPACE_THRESHOLD) current_context.text += ' ';
            }
            current_context.text += ch->character;
            context_right = ch->x + ch->width;
        }
        current_context.x = start_char_of_context->x;
        current_context.y = start_char_of_context->y - start_char_of_context->offset;
        current_context.clickX = current_context.x + (context_right - current_context.x) / 2;
        current_context.clickY = current_context.y + start_char_of_context->height / 2;
        current_context.colorR = start_char_of_context->r;
        current_context.colorG = start_char_of_context->g;
        current_context.colorB = start_char_of_context->b;
        final_contexts.push_back(current_context);
    }

    if (ENABLE_BENCHMARKING) {
        auto end_time = std::chrono::high_resolution_clock::now();
        auto duration = std::chrono::duration_cast<std::chrono::microseconds>(end_time - start_time);
        std::cout << "[OCR BENCHMARK w/SIMD] Contexts: " << final_contexts.size() << " | Time: " << duration.count() << " us" << std::endl;
    }

    Napi::Array resultArray = Napi::Array::New(env, final_contexts.size());
    for (size_t i = 0; i < final_contexts.size(); ++i) {
        const auto& context = final_contexts[i];
        Napi::Object contextObj = Napi::Object::New(env);
        contextObj.Set("x", Napi::Number::New(env, context.x));
        contextObj.Set("y", Napi::Number::New(env, context.y));
        contextObj.Set("text", Napi::String::New(env, context.text));

        // --- CHANGE: Add the 'click' object to the output ---
        Napi::Object clickObj = Napi::Object::New(env);
        clickObj.Set("x", Napi::Number::New(env, context.clickX));
        clickObj.Set("y", Napi::Number::New(env, context.clickY));
        contextObj.Set("click", clickObj);

        // --- CHANGE: Add color information ---
        Napi::Object colorObj = Napi::Object::New(env);
        colorObj.Set("r", Napi::Number::New(env, context.colorR));
        colorObj.Set("g", Napi::Number::New(env, context.colorG));
        colorObj.Set("b", Napi::Number::New(env, context.colorB));
        contextObj.Set("color", colorObj);

        resultArray.Set(i, contextObj);
    }

    return resultArray;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    HardcodedInitializeFontAtlas(fontAtlas);
    exports.Set("recognizeText", Napi::Function::New(env, RecognizeText));
    return exports;
}

NODE_API_MODULE(fontocr, Init)