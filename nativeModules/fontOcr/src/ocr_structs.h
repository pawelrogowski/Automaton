#pragma once // Prevents the file from being included multiple times

#include <vector>
#include <string>
#include <cstdint>
#include <utility>

// This file is the single source of truth for our data structures.

struct CharTemplate {
    char character;
    uint32_t width;
    uint32_t height;
    uint32_t offset;
    std::vector<std::pair<uint8_t, uint8_t>> font_pixel_offsets;
    std::vector<std::pair<uint8_t, uint8_t>> bg_pixel_offsets;
};

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