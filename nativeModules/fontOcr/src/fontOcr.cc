// fontOcr.cc — AVX2-accelerated color prescan + trigger-map matching (BGRA input).
// - Keeps your working findText path
// - Fixes recognizeText by reverting to trigger-map logic but accelerates the hot-pixel scan with AVX2
// - Uses packed 32-bit loads and avoids per-pixel tuple loops for color checks

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
#include <unordered_set>
#include <set>
#include <immintrin.h>

#include "ocr_structs.h"
#include "font_atlas_data.h"

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

// --- Structs from your code ---
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

// Forward decls
Napi::Value RecognizeText(const Napi::CallbackInfo& info);
Napi::Value FindText(const Napi::CallbackInfo& info);

// =====================================================================================
// AVX2-accelerated RecognizeText implementation (fixes earlier non-working version)
// - AVX2 prescan to locate candidate pixels with any valid font color
// - Trigger-map verification against templates using fast packed 32-bit compares
// =====================================================================================

static std::vector<FoundChar> RecognizeText_PrescanAVX2(
    const uint8_t* __restrict screen_data, uint32_t screen_width, uint32_t screen_height,
    uint32_t roi_x, uint32_t roi_y, uint32_t roi_w, uint32_t roi_h,
    const std::vector<std::tuple<uint8_t,uint8_t,uint8_t>>& valid_colors,
    const std::string& allowed_chars)
{
    // Build quick filter for allowed chars
    auto allowed = [&](char c)->bool {
        return allowed_chars.empty() || (allowed_chars.find(c) != std::string::npos);
    };

    // Build packed valid color set + AVX constants
    ColorSet colorSet;
    colorSet.build(valid_colors);

    std::vector<FoundChar> final_chars;
    if (roi_w == 0 || roi_h == 0 || colorSet.v.empty()) return final_chars;

    // We keep a "consumed" mask to avoid re-detecting pixels within an accepted glyph region.
    std::vector<uint8_t> consumed(roi_w * roi_h, 0);

    const size_t strideBytes = (size_t)screen_width * 4u;

    // Scan each row in ROI: AVX2 compare 8 pixels (8 * 4 bytes = 32B) per load
    for (uint32_t dy = 0; dy < roi_h; ++dy) {
        const uint32_t y = roi_y + dy;
        const uint8_t* rowPtr = screen_data + (size_t)y * strideBytes + (size_t)roi_x * 4u;

        uint32_t dx = 0;

        // Vector body (process 8 pixels at a time)
        for (; dx + 8 <= roi_w; dx += 8) {
            __m256i chunk = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(rowPtr + (size_t)dx * 4u));

            // Compare against all valid colors, OR masks together
            __m256i acc = _mm256_setzero_si256();
            for (const __m256i& colVec : colorSet.v) {
                __m256i m = _mm256_cmpeq_epi32(chunk, colVec);
                acc = _mm256_or_si256(acc, m);
            }

            int bitmask = _mm256_movemask_ps(_mm256_castsi256_ps(acc)); // one bit per 32-bit lane
            while (bitmask) {
                int lane = __builtin_ctz((unsigned)bitmask);
                bitmask &= bitmask - 1;

                uint32_t x = roi_x + dx + (uint32_t)lane;
                uint32_t local_x = dx + (uint32_t)lane;
                if (consumed[dy * roi_w + local_x]) continue;

                // Reference color for this hot pixel (we use it for foreground equality)
                uint32_t refPacked = *reinterpret_cast<const uint32_t*>(
                    screen_data + (size_t)y * strideBytes + (size_t)x * 4u);

                // Try all trigger offsets; compute potential top-left and test templates
                std::vector<FoundChar> candidates;
                for (const auto& kv : triggerMap) {
                    const Point& off = kv.first;
                    int potential_cx = int(local_x) - off.first;
                    int potential_cy = int(dy) - off.second;
                    if (potential_cx < 0 || potential_cy < 0) continue;

                    // Bounds check inside ROI (glyph must fully fit)
                    for (const CharTemplate* tplPtr : kv.second) {
                        const CharTemplate& tpl = *tplPtr;
                        if (!allowed(tpl.character)) continue;

                        if ((uint32_t)potential_cx + tpl.width  > roi_w) continue;
                        if ((uint32_t)potential_cy + tpl.height > roi_h) continue;

                        // Absolute coords of top-left (match origin)
                        uint32_t mx = roi_x + (uint32_t)potential_cx;
                        uint32_t my = roi_y + (uint32_t)potential_cy;

                        if (FinalMatchTestFast(screen_data, screen_width, mx, my, tpl, refPacked, colorSet)) {
                            candidates.emplace_back(tpl.character,
                                                    (uint32_t)mx, (uint32_t)my,
                                                    tpl.width, tpl.height, tpl.offset,
                                                    (uint8_t)((refPacked >> 16) & 0xFF),
                                                    (uint8_t)((refPacked >> 8) & 0xFF),
                                                    (uint8_t)(refPacked & 0xFF));
                        }
                    }
                }

                if (!candidates.empty()) {
                    // Prefer the largest area (as in your original)
                    auto best_it = std::max_element(
                        candidates.begin(), candidates.end(),
                        [](const FoundChar& a, const FoundChar& b) {
                            return (a.width * a.height) < (b.width * b.height);
                        }
                    );
                    const FoundChar& best = *best_it;
                    final_chars.push_back(best);

                    // Mark consumed region in local ROI space
                    uint32_t lx = best.x - roi_x, ly = best.y - roi_y;
                    for (uint32_t yy = 0; yy < best.height; ++yy) {
                        uint32_t base = (ly + yy) * roi_w + lx;
                        for (uint32_t xx = 0; xx < best.width; ++xx) {
                            consumed[base + xx] = 1;
                        }
                    }
                }
            }
        }

        // Tail scalar loop
        for (; dx < roi_w; ++dx) {
            if (consumed[dy * roi_w + dx]) continue;

            const uint8_t* pixPtr = rowPtr + (size_t)dx * 4u;
            uint32_t packed = *reinterpret_cast<const uint32_t*>(pixPtr);
            if (!colorSet.has(packed)) continue;

            uint32_t x = roi_x + dx;
            uint32_t refPacked = packed;

            std::vector<FoundChar> candidates;
            for (const auto& kv : triggerMap) {
                const Point& off = kv.first;
                int potential_cx = int(dx) - off.first;
                int potential_cy = int(dy) - off.second;
                if (potential_cx < 0 || potential_cy < 0) continue;

                for (const CharTemplate* tplPtr : kv.second) {
                    const CharTemplate& tpl = *tplPtr;
                    if (!allowed(tpl.character)) continue;
                    if ((uint32_t)potential_cx + tpl.width  > roi_w) continue;
                    if ((uint32_t)potential_cy + tpl.height > roi_h) continue;

                    uint32_t mx = roi_x + (uint32_t)potential_cx;
                    uint32_t my = roi_y + (uint32_t)potential_cy;

                    if (FinalMatchTestFast(screen_data, screen_width, mx, my, tpl, refPacked, colorSet)) {
                        candidates.emplace_back(tpl.character,
                                                (uint32_t)mx, (uint32_t)my,
                                                tpl.width, tpl.height, tpl.offset,
                                                (uint8_t)((refPacked >> 16) & 0xFF),
                                                (uint8_t)((refPacked >> 8) & 0xFF),
                                                (uint8_t)(refPacked & 0xFF));
                    }
                }
            }

            if (!candidates.empty()) {
                const FoundChar& best = *std::max_element(
                    candidates.begin(), candidates.end(),
                    [](const FoundChar& a, const FoundChar& b) {
                        return (a.width * a.height) < (b.width * b.height);
                    }
                );
                final_chars.push_back(best);
                uint32_t lx = best.x - roi_x, ly = best.y - roi_y;
                for (uint32_t yy = 0; yy < best.height; ++yy) {
                    uint32_t base = (ly + yy) * roi_w + lx;
                    for (uint32_t xx = 0; xx < best.width; ++xx) {
                        consumed[base + xx] = 1;
                    }
                }
            }
        }
    }

    return final_chars;
}

// --- Public NAPI: RecognizeText ---
Napi::Value RecognizeText(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 4 || !info[0].IsBuffer() || !info[1].IsObject() || !info[2].IsArray() || !info[3].IsString()) {
        Napi::TypeError::New(env, "Usage: recognizeText(screenBuffer, roi, validColors, allowedChars)").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Buffer<uint8_t> screenBuffer = info[0].As<Napi::Buffer<uint8_t>>();
    Napi::Object roi = info[1].As<Napi::Object>();
    Napi::Array jsColors = info[2].As<Napi::Array>();
    std::string allowed_chars = info[3].As<Napi::String>().Utf8Value();

    if (screenBuffer.Length() < 8) {
        Napi::TypeError::New(env, "screenBuffer too small").ThrowAsJavaScriptException();
        return env.Null();
    }

    const uint32_t screen_width  = *reinterpret_cast<uint32_t*>(screenBuffer.Data());
    const uint32_t screen_height = *reinterpret_cast<uint32_t*>(screenBuffer.Data() + 4);
    const uint8_t* screen_data   = screenBuffer.Data() + 8;

    const uint32_t roi_x = roi.Get("x").As<Napi::Number>().Uint32Value();
    const uint32_t roi_y = roi.Get("y").As<Napi::Number>().Uint32Value();
    const uint32_t roi_w = roi.Get("width").As<Napi::Number>().Uint32Value();
    const uint32_t roi_h = roi.Get("height").As<Napi::Number>().Uint32Value();

    // Validate ROI against screen dimensions
    if (roi_x >= screen_width || roi_y >= screen_height) {
        return Napi::Array::New(env, 0);
    }
    uint32_t safe_w = std::min(roi_w, screen_width  - roi_x);
    uint32_t safe_h = std::min(roi_h, screen_height - roi_y);

    std::vector<std::tuple<uint8_t,uint8_t,uint8_t>> valid_colors;
    valid_colors.reserve(jsColors.Length());
    for (uint32_t i = 0; i < jsColors.Length(); ++i) {
        Napi::Array t = jsColors.Get(i).As<Napi::Array>();
        uint8_t r = (uint8_t)t.Get(0u).As<Napi::Number>().Uint32Value();
        uint8_t g = (uint8_t)t.Get(1u).As<Napi::Number>().Uint32Value();
        uint8_t b = (uint8_t)t.Get(2u).As<Napi::Number>().Uint32Value();
        valid_colors.emplace_back(r,g,b);
    }

    std::vector<FoundChar> final_chars = RecognizeText_PrescanAVX2(
        screen_data, screen_width, screen_height,
        roi_x, roi_y, safe_w, safe_h,
        valid_colors, allowed_chars
    );

    // --- Group into contexts (unchanged logic, minor tidying) ---
    std::vector<TextContext> final_contexts;
    if (!final_chars.empty()) {
        std::sort(final_chars.begin(), final_chars.end(), [](const FoundChar& a, const FoundChar& b) {
            uint32_t a_line_y = a.y - a.offset;
            uint32_t b_line_y = b.y - b.offset;
            if (std::abs(int(a_line_y) - int(b_line_y)) > 2) return a_line_y < b_line_y;
            return a.x < b.x;
        });

        const int32_t LINE_Y_TOLERANCE    = 1;
        const int32_t SPACE_THRESHOLD     = 6;
        const int32_t CONTEXT_GAP_THRESH  = 15;

        TextContext cur{};
        const FoundChar* start_char = &final_chars.front();

        auto flush_context = [&](const FoundChar* from, const FoundChar* to) {
            TextContext ctx{};
            std::string s; s.reserve((to - from + 1) + 8);
            uint32_t right = 0, max_h = 0;

            for (const FoundChar* ch = from; ch <= to; ++ch) {
                if (ch > from) {
                    int gap = int(ch->x) - int((ch-1)->x + (ch-1)->width);
                    if (gap >= SPACE_THRESHOLD) s.push_back(' ');
                }
                s.push_back(ch->character);
                right = ch->x + ch->width;
                if (ch->height > max_h) max_h = ch->height;
            }
            ctx.text   = std::move(s);
            ctx.x      = from->x;
            ctx.y      = from->y - from->offset;
            ctx.clickX = ctx.x + (right - ctx.x) / 2;
            ctx.clickY = ctx.y + max_h / 2;
            ctx.colorR = start_char->r; ctx.colorG = start_char->g; ctx.colorB = start_char->b;

            return ctx;
        };

        for (size_t i = 1; i < final_chars.size(); ++i) {
            const auto& prev = final_chars[i-1];
            const auto& curr = final_chars[i];
            uint32_t prev_line_y = prev.y - prev.offset;
            uint32_t curr_line_y = curr.y - curr.offset;
            int32_t y_gap = std::abs(int(curr_line_y) - int(prev_line_y));
            int32_t x_gap = int(curr.x) - int(prev.x + prev.width);

            if (y_gap > LINE_Y_TOLERANCE || x_gap >= CONTEXT_GAP_THRESH) {
                final_contexts.push_back(flush_context(start_char, &prev));
                start_char = &curr;
            }
        }
        final_contexts.push_back(flush_context(start_char, &final_chars.back()));
    }

    Napi::Array resultArray = Napi::Array::New(env, final_contexts.size());
    for (size_t i = 0; i < final_contexts.size(); ++i) {
        const auto& c = final_contexts[i];
        Napi::Object ctx = Napi::Object::New(env);
        ctx.Set("x", Napi::Number::New(env, c.x));
        ctx.Set("y", Napi::Number::New(env, c.y));
        ctx.Set("text", Napi::String::New(env, c.text));

        Napi::Object click = Napi::Object::New(env);
        click.Set("x", Napi::Number::New(env, c.clickX));
        click.Set("y", Napi::Number::New(env, c.clickY));
        ctx.Set("click", click);

        Napi::Object color = Napi::Object::New(env);
        color.Set("r", Napi::Number::New(env, c.colorR));
        color.Set("g", Napi::Number::New(env, c.colorG));
        color.Set("b", Napi::Number::New(env, c.colorB));
        ctx.Set("color", color);

        resultArray.Set(i, ctx);
    }
    return resultArray;
}

// =====================================================================================
// Existing findText path (kept from your working version; tiny cleanups only)
// =====================================================================================

struct FoundWord {
    std::string text;
    uint32_t x;
    uint32_t y;
    uint8_t r, g, b;
};

static inline bool FinalMatchTest_Tuple(
    const uint8_t* screen_data, uint32_t screen_width,
    uint32_t match_x, uint32_t match_y,
    const CharTemplate& tpl,
    uint8_t ref_r, uint8_t ref_g, uint8_t ref_b,
    const std::vector<std::tuple<uint8_t,uint8_t,uint8_t>>& valid_colors)
{
    for (const auto& offset : tpl.font_pixel_offsets) {
        const size_t idx = ((match_y + offset.second) * screen_width + (match_x + offset.first)) * 4u;
        if (screen_data[idx + 2] != ref_r || screen_data[idx + 1] != ref_g || screen_data[idx + 0] != ref_b) return false;
    }
    for (const auto& offset : tpl.bg_pixel_offsets) {
        const size_t idx = ((match_y + offset.second) * screen_width + (match_x + offset.first)) * 4u;
        if (is_valid_font_color_tuple(screen_data[idx + 2], screen_data[idx + 1], screen_data[idx + 0], valid_colors)) return false;
    }
    return true;
}

bool MatchWord_Dynamic(const std::string& word,
                       uint32_t first_char_x, uint32_t first_char_y,
                       const uint8_t* screen_data, uint32_t screen_width,
                       uint8_t r, uint8_t g, uint8_t b,
                       const std::vector<std::tuple<uint8_t, uint8_t, uint8_t>>& valid_colors)
{
    const CharTemplate* prev_tpl = charToTemplateMap.at(word[0]);

    if (!FinalMatchTest_Tuple(screen_data, screen_width, first_char_x, first_char_y, *prev_tpl, r, g, b, valid_colors)) {
        return false;
    }

    uint32_t baseline_y = first_char_y - prev_tpl->offset;
    uint32_t current_x_base = first_char_x + prev_tpl->width;
    const int SPACE_WIDTH = 4;
    const int MAX_CHAR_GAP = 3;

    for (size_t i = 1; i < word.length(); ++i) {
        char c = word[i];
        if (c == ' ') { current_x_base += SPACE_WIDTH; prev_tpl = nullptr; continue; }

        auto it = charToTemplateMap.find(c);
        if (it == charToTemplateMap.end()) return false;
        const CharTemplate* tpl = it->second;

        uint32_t char_y = baseline_y + tpl->offset;
        bool found_next_char = false;

        for (int gap = 0; gap <= MAX_CHAR_GAP; ++gap) {
            uint32_t next_char_x = current_x_base + gap;
            if (FinalMatchTest_Tuple(screen_data, screen_width, next_char_x, char_y, *tpl, r, g, b, valid_colors)) {
                current_x_base = next_char_x + tpl->width;
                found_next_char = true;
                break;
            }
        }
        if (!found_next_char) return false;
    }
    return true;
}

Napi::Value FindText(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 4 || !info[0].IsBuffer() || !info[1].IsObject() || !info[2].IsArray() || !info[3].IsArray()) {
        Napi::TypeError::New(env, "Usage: findText(screenBuffer, roi, validColors, wordsToFind)").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Buffer<uint8_t> screenBuffer = info[0].As<Napi::Buffer<uint8_t>>();
    Napi::Object roi = info[1].As<Napi::Object>();
    Napi::Array jsColors = info[2].As<Napi::Array>();
    Napi::Array jsWords = info[3].As<Napi::Array>();

    const uint32_t screen_width = *reinterpret_cast<uint32_t*>(screenBuffer.Data());
    const uint8_t* screen_data = screenBuffer.Data() + 8;
    const uint32_t roi_x = roi.Get("x").As<Napi::Number>().Uint32Value();
    const uint32_t roi_y = roi.Get("y").As<Napi::Number>().Uint32Value();
    const uint32_t roi_w = roi.Get("width").As<Napi::Number>().Uint32Value();
    const uint32_t roi_h = roi.Get("height").As<Napi::Number>().Uint32Value();

    std::vector<std::tuple<uint8_t,uint8_t,uint8_t>> valid_colors;
    valid_colors.reserve(jsColors.Length());
    for (uint32_t i = 0; i < jsColors.Length(); ++i) {
        Napi::Array t = jsColors.Get(i).As<Napi::Array>();
        valid_colors.emplace_back(
            (uint8_t)t.Get(0u).As<Napi::Number>().Uint32Value(),
            (uint8_t)t.Get(1u).As<Napi::Number>().Uint32Value(),
            (uint8_t)t.Get(2u).As<Napi::Number>().Uint32Value()
        );
    }

    std::vector<std::string> words_to_find;
    words_to_find.reserve(jsWords.Length());
    for (uint32_t i = 0; i < jsWords.Length(); ++i) {
        words_to_find.push_back(jsWords.Get(i).As<Napi::String>().Utf8Value());
    }

    // Sort by length desc to bias toward longer matches first
    std::sort(words_to_find.begin(), words_to_find.end(),
              [](const std::string& a, const std::string& b){ return a.length() > b.length(); });

    std::vector<__m256i> avx_valid_colors;
    avx_valid_colors.reserve(valid_colors.size());
    for (const auto& c : valid_colors) {
        avx_valid_colors.push_back(_mm256_set1_epi32((int)PackBGRA(std::get<0>(c), std::get<1>(c), std::get<2>(c))));
    }

    std::vector<FoundWord> final_words;
    std::map<std::pair<uint32_t,uint32_t>, bool> found_coords;

    const uint32_t CELL_SIZE = 16;
    std::set<std::pair<uint32_t,uint32_t>> hot_cells;

    // Pass 1: AVX2 prescan to mark hot cells
    for (uint32_t y = 0; y < roi_h; ++y) {
        const uint8_t* row_ptr = screen_data + ((roi_y + y) * screen_width + roi_x) * 4u;
        for (uint32_t x = 0; x + 8 <= roi_w; x += 8) {
            __m256i chunk = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(row_ptr + (size_t)x * 4u));
            __m256i acc = _mm256_setzero_si256();
            for (const auto& col : avx_valid_colors)
                acc = _mm256_or_si256(acc, _mm256_cmpeq_epi32(chunk, col));
            if (_mm256_testz_si256(acc, acc) == 0) {
                hot_cells.insert({x / CELL_SIZE, y / CELL_SIZE});
            }
        }
    }

    // Pass 2: targeted scan of hot cells (scalar verification for words)
    for (const auto& cell : hot_cells) {
        uint32_t sx = cell.first * CELL_SIZE;
        uint32_t sy = cell.second * CELL_SIZE;
        uint32_t ex = std::min(sx + CELL_SIZE, roi_w);
        uint32_t ey = std::min(sy + CELL_SIZE, roi_h);

        for (uint32_t y = sy; y < ey; ++y) {
            for (uint32_t x = sx; x < ex; ++x) {
                const size_t idx = ((roi_y + y) * screen_width + (roi_x + x)) * 4u;
                uint8_t b = screen_data[idx + 0];
                uint8_t g = screen_data[idx + 1];
                uint8_t r = screen_data[idx + 2];
                if (!is_valid_font_color_tuple(r,g,b, valid_colors)) continue;

                for (const auto& word : words_to_find) {
                    if (word.empty()) continue;
                    const CharTemplate* first_tpl = charToTemplateMap.at(word[0]);
                    for (const auto& off : first_tpl->font_pixel_offsets) {
                        int pcx = int(x) - off.first;
                        int pcy = int(y) - off.second;
                        if (pcx < 0 || pcy < 0) continue;

                        uint32_t wx = roi_x + (uint32_t)pcx;
                        uint32_t wy = roi_y + (uint32_t)pcy;
                        if (found_coords.count({wx, wy})) continue;

                        if (MatchWord_Dynamic(word, wx, wy, screen_data, screen_width, r, g, b, valid_colors)) {
                            uint32_t baseline_y = wy - first_tpl->offset;
                            final_words.push_back({word, wx, baseline_y, r, g, b});
                            found_coords[{wx, wy}] = true;
                        }
                    }
                }
            }
        }
    }

    Napi::Array resultArray = Napi::Array::New(env, final_words.size());
    for (size_t i = 0; i < final_words.size(); ++i) {
        const auto& w = final_words[i];
        Napi::Object o = Napi::Object::New(env);
        o.Set("text", Napi::String::New(env, w.text));
        o.Set("x", Napi::Number::New(env, w.x));
        o.Set("y", Napi::Number::New(env, w.y));
        Napi::Object color = Napi::Object::New(env);
        color.Set("r", Napi::Number::New(env, w.r));
        color.Set("g", Napi::Number::New(env, w.g));
        color.Set("b", Napi::Number::New(env, w.b));
        o.Set("color", color);
        resultArray.Set(i, o);
    }
    return resultArray;
}

// --- Module Initialization ---
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    HardcodedInitializeFontAtlas(fontAtlas);
    PrecomputeMaps();

    exports.Set("recognizeText", Napi::Function::New(env, RecognizeText));
    exports.Set("findText", Napi::Function::New(env, FindText));
    return exports;
}

NODE_API_MODULE(fontocr, Init)
