#include <napi.h>
#include <vector>
#include <string>
#include <cstdint>
#include <algorithm>
#include <tuple>
#include <cmath>       // For std::abs
#include <immintrin.h> // For AVX2 SIMD instructions
#include <chrono>      // For high-precision timing
#include <iostream>    // For std::cout
#include <iomanip>     // For std::fixed, std::setprecision

const bool ENABLE_BENCHMARKING = true;

static bool color_lookup[256][256][256] = {false};

struct CharTemplate {
    char character;
    uint32_t width;
    uint32_t height;
    std::vector<uint8_t> rgba_data;
    uint32_t complexity;
};

struct FoundChar {
    char character;
    uint32_t x;
    uint32_t y;
    uint32_t width;
};

static std::vector<CharTemplate> fontAtlas;

// --- Helper Functions ---
inline bool is_magic_color(const uint8_t r, const uint8_t g, const uint8_t b) {
    return r == 255 && g == 0 && b == 255;
}

inline bool is_valid_font_color_fast(const uint8_t r, const uint8_t g, const uint8_t b) {
    return color_lookup[r][g][b];
}

// --- SIMD Template Matching (From the last working version) ---
inline bool DoesTemplateMatch_SIMD(
    const uint8_t* screen_data, const uint32_t screen_width,
    const uint32_t match_x, const uint32_t match_y,
    const CharTemplate& tpl
) {
    uint8_t target_r, target_g, target_b;
    bool target_color_identified = false;

    for (uint32_t ty = 0; ty < tpl.height; ++ty) {
        for (uint32_t tx = 0; tx < tpl.width; ++tx) {
            const size_t tpl_idx = (ty * tpl.width + tx) * 4;
            if (is_magic_color(tpl.rgba_data[tpl_idx], tpl.rgba_data[tpl_idx + 1], tpl.rgba_data[tpl_idx + 2])) {
                const size_t screen_idx = ((match_y + ty) * screen_width + (match_x + tx)) * 4;
                const uint8_t r = screen_data[screen_idx + 2];
                const uint8_t g = screen_data[screen_idx + 1];
                const uint8_t b = screen_data[screen_idx];

                if (!is_valid_font_color_fast(r, g, b)) return false;
                target_r = r; target_g = g; target_b = b;
                target_color_identified = true;
                goto found_target_color;
            }
        }
    }

found_target_color:
    if (!target_color_identified) return false;

    const __m256i target_vector = _mm256_set1_epi32((0xFF << 24) | (target_r << 16) | (target_g << 8) | target_b);
    const __m256i shuffle_mask = _mm256_setr_epi8(
        2, 1, 0, 3, 6, 5, 4, 7, 10, 9, 8, 11, 14, 13, 12, 15,
        2, 1, 0, 3, 6, 5, 4, 7, 10, 9, 8, 11, 14, 13, 12, 15
    );

    for (uint32_t ty = 0; ty < tpl.height; ++ty) {
        const size_t num_pixels_in_row = tpl.width;
        const size_t num_vectors_in_row = num_pixels_in_row / 8;

        for (size_t i = 0; i < num_vectors_in_row; ++i) {
            const size_t offset = i * 8;
            const __m256i tpl_chunk = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(&tpl.rgba_data[(ty * tpl.width + offset) * 4]));
            __m256i screen_chunk = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(&screen_data[((match_y + ty) * screen_width + (match_x + offset)) * 4]));
            screen_chunk = _mm256_shuffle_epi8(screen_chunk, shuffle_mask);
            const __m256i not_magenta_mask = _mm256_cmpeq_epi32(tpl_chunk, _mm256_set1_epi32(0xFFFF00FF));
            const __m256i is_target_mask = _mm256_cmpeq_epi32(screen_chunk, target_vector);
            const int mask = _mm256_movemask_ps(_mm256_castsi256_ps(_mm256_andnot_si256(is_target_mask, not_magenta_mask)));
            if (mask != 0) return false;
        }

        for (size_t tx = num_vectors_in_row * 8; tx < num_pixels_in_row; ++tx) {
            const size_t tpl_idx = (ty * tpl.width + tx) * 4;
            if (is_magic_color(tpl.rgba_data[tpl_idx], tpl.rgba_data[tpl_idx + 1], tpl.rgba_data[tpl_idx + 2])) {
                const size_t screen_idx = ((match_y + ty) * screen_width + (match_x + tx)) * 4;
                if (screen_data[screen_idx + 2] != target_r || screen_data[screen_idx + 1] != target_g || screen_data[screen_idx] != target_b) {
                    return false;
                }
            }
        }
    }
    return true;
}

// --- N-API Function Definitions ---
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
        tpl.rgba_data.assign(tplData.Data(), tplData.Data() + tplData.Length());

        tpl.complexity = 0;
        for (size_t j = 0; j < tpl.rgba_data.size(); j += 4) {
            if (is_magic_color(tpl.rgba_data[j], tpl.rgba_data[j + 1], tpl.rgba_data[j + 2])) {
                tpl.complexity++;
            }
        }
        fontAtlas.push_back(tpl);
    }

    std::sort(fontAtlas.begin(), fontAtlas.end(), [](const CharTemplate& a, const CharTemplate& b) {
        if (a.complexity != b.complexity) return a.complexity > b.complexity;
        if (a.width != b.width) return a.width > b.width;
        return a.character < b.character;
    });

    const std::vector<std::tuple<uint8_t, uint8_t, uint8_t>> VALID_FONT_COLORS = {
        {240, 240, 0},   {96, 248, 248},  {32, 160, 255},  {247, 95, 95},
        {144, 144, 144}, {223, 223, 223}, {240, 240, 240}, {244, 244, 244},
        {170, 170, 170}, {255,255,255}
    };
    memset(color_lookup, 0, sizeof(color_lookup));
    for (const auto& color : VALID_FONT_COLORS) {
        color_lookup[std::get<0>(color)][std::get<1>(color)][std::get<2>(color)] = true;
    }

    return env.Undefined();
}

Napi::Value RecognizeText(const Napi::CallbackInfo& info) {
    std::chrono::time_point<std::chrono::high_resolution_clock> start_time;
    if (ENABLE_BENCHMARKING) {
        start_time = std::chrono::high_resolution_clock::now();
    }

    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsBuffer() || !info[1].IsObject()) {
        Napi::TypeError::New(env, "Expected (Buffer, ROI_Object)").ThrowAsJavaScriptException();
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

    static thread_local std::vector<FoundChar> found_chars_cache;
    static thread_local std::vector<uint8_t> visited_cache; // FIX: Use uint8_t instead of bool
    static thread_local std::vector<std::vector<FoundChar>> lines_cache;

    found_chars_cache.clear();
    lines_cache.clear();
    visited_cache.assign(roi_w * roi_h, 0); // Use 0 for false

    std::vector<FoundChar>& found_chars = found_chars_cache;
    std::vector<uint8_t>& visited = visited_cache;
    std::vector<std::vector<FoundChar>>& lines = lines_cache;

    // PHASE 1: Find all characters in the ROI.
    for (uint32_t y = 0; y < roi_h; ++y) {
        // OPTIMIZATION: Use a pointer for the visited map row to avoid multiplication
        uint8_t* visited_row_ptr = &visited[y * roi_w];
        for (uint32_t x = 0; x < roi_w; ++x) {
            if (visited_row_ptr[x]) continue;

            for (const auto& tpl : fontAtlas) {
                uint32_t current_x = roi_x + x;
                uint32_t current_y = roi_y + y;

                if (current_x + tpl.width > roi_x + roi_w || current_y + tpl.height > roi_y + roi_h) continue;

                if (DoesTemplateMatch_SIMD(screen_data, screen_width, current_x, current_y, tpl)) {
                    found_chars.push_back({tpl.character, current_x, current_y, tpl.width});

                    for (uint32_t ty = 0; ty < tpl.height; ++ty) {
                        for (uint32_t tx = 0; tx < tpl.width; ++tx) {
                            if ((y + ty) < roi_h && (x + tx) < roi_w) {
                                visited[(y + ty) * roi_w + (x + tx)] = 1; // Use 1 for true
                            }
                        }
                    }
                    // OPTIMIZATION: Jump the scanner past the character we just found
                    x += tpl.width - 1;
                    break;
                }
            }
        }
    }

    std::string final_result = "";
    if (!found_chars.empty()) {
        std::sort(found_chars.begin(), found_chars.end(), [](const FoundChar& a, const FoundChar& b) {
            if (a.y != b.y) return a.y < b.y;
            return a.x < b.x;
        });

        lines.push_back({found_chars[0]});
        const uint32_t LINE_TOLERANCE = 8;
        for (size_t i = 1; i < found_chars.size(); ++i) {
            long long y_sum = 0;
            for(const auto& c : lines.back()) { y_sum += c.y; }
            const uint32_t y_avg = y_sum / lines.back().size();
            if (std::abs((int)found_chars[i].y - (int)y_avg) <= LINE_TOLERANCE) {
                lines.back().push_back(found_chars[i]);
            } else {
                lines.push_back({found_chars[i]});
            }
        }

        const uint32_t SPACE_THRESHOLD = 3;
        for (size_t i = 0; i < lines.size(); ++i) {
            auto& line = lines[i];
            std::sort(line.begin(), line.end(), [](const FoundChar& a, const FoundChar& b) { return a.x < b.x; });
            if (i > 0) final_result += "\n";
            if (!line.empty()) {
                final_result += line[0].character;
                for (size_t j = 1; j < line.size(); ++j) {
                    const auto& prev = line[j-1];
                    const auto& curr = line[j];
                    if ((curr.x - (prev.x + prev.width)) > SPACE_THRESHOLD) {
                        final_result += ' ';
                    }
                    final_result += curr.character;
                }
            }
        }
    }

    if (ENABLE_BENCHMARKING) {
        auto end_time = std::chrono::high_resolution_clock::now();
        auto duration = std::chrono::duration_cast<std::chrono::microseconds>(end_time - start_time);
        const uint64_t total_pixels = (uint64_t)roi_w * roi_h;
        double megapixels_per_second = (duration.count() > 0) ? ((double)total_pixels / duration.count()) : 0.0;
        std::cout << "[OCR BENCHMARK] ROI: " << roi_w << "x" << roi_h << " (" << total_pixels << " px) | Time: "
                  << duration.count() << " us | Speed: " << std::fixed << std::setprecision(2)
                  << megapixels_per_second << " MP/s | Chars: " << found_chars.size() << std::endl;
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