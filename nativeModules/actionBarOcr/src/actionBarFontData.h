#ifndef ACTION_BAR_FONT_DATA_H
#define ACTION_BAR_FONT_DATA_H

#include <cstdint>
#include <cstddef>
#include <unordered_map>
#include <array>
#include <vector>

struct Pixel {
    uint8_t x, y, r, g, b;
};

// Color key for lookup
using ColorKey = std::array<uint8_t, 3>;

// Candidate structure for color lookup
struct CandidateInfo {
    int digit;
    size_t pixel_index;
    uint8_t rel_x, rel_y;  // Relative position in template
};

// Hash for array key
struct HashForArray {
  std::size_t operator()(const ColorKey& key) const {
    std::size_t hash = 0;
    for (auto byte : key) {
      hash = hash * 31 + byte;
    }
    return hash;
  }
};

// Digit 0
extern const Pixel digit0_pixels[];
extern const size_t digit0_pixel_count;

// Digit 1
extern const Pixel digit1_pixels[];
extern const size_t digit1_pixel_count;

// Digit 2
extern const Pixel digit2_pixels[];
extern const size_t digit2_pixel_count;

// Digit 3
extern const Pixel digit3_pixels[];
extern const size_t digit3_pixel_count;

// Digit 4
extern const Pixel digit4_pixels[];
extern const size_t digit4_pixel_count;

// Digit 5
extern const Pixel digit5_pixels[];
extern const size_t digit5_pixel_count;

// Digit 6
extern const Pixel digit6_pixels[];
extern const size_t digit6_pixel_count;

// Digit 7
extern const Pixel digit7_pixels[];
extern const size_t digit7_pixel_count;

// Digit 8
extern const Pixel digit8_pixels[];
extern const size_t digit8_pixel_count;

// Digit 9
extern const Pixel digit9_pixels[];
extern const size_t digit9_pixel_count;


// Precomputed color to candidate lookup
extern const std::unordered_map<ColorKey, std::vector<CandidateInfo>, HashForArray> colorCandidates;

#endif // ACTION_BAR_FONT_DATA_H
