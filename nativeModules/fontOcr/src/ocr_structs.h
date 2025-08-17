#pragma once

#include <vector>
#include <string>
#include <cstdint>
#include <utility>

// A clean struct for coordinates, with a comparison operator for use in maps.
struct Point {
    uint8_t first;  // x
    uint8_t second; // y

    bool operator<(const Point& other) const {
        if (first != other.first) {
            return first < other.first;
        }
        return second < other.second;
    }
};

// Template for a single character.
struct CharTemplate {
    char character;
    uint32_t width;
    uint32_t height;
    uint32_t offset;
    std::vector<Point> font_pixel_offsets;
    std::vector<Point> bg_pixel_offsets;
};

// Represents a character found on screen by recognizeText.
struct FoundChar {
    char character;
    uint32_t x;
    uint32_t y;
    uint32_t width;
    uint32_t height;
    uint32_t offset;
    uint8_t r, g, b;
    FoundChar(char c, uint32_t _x, uint32_t _y, uint32_t w, uint32_t h, uint32_t o, uint8_t _r, uint8_t _g, uint8_t _b)
        : character(c), x(_x), y(_y), width(w), height(h), offset(o), r(_r), g(_g), b(_b) {}
};