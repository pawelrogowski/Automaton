# Font Atlas for Real-Time OCR

This directory contains the font atlas used for high-performance, template-based text recognition. Each file represents a single character template. Adhering to the format described below is critical for the C++ matching module to function correctly.

## 1. Purpose

This font atlas is designed to be **color and border agnostic**. It allows the C++ recognition module to read text from the game screen regardless of its color (white, blue, yellow, etc.) or whether it has a black border.

The recognition is based on matching the **shape** of the characters, not their specific colors.

## 2. File Format

- **File Type:** All templates **must** be saved as **PNG (`.png`)** files to ensure lossless quality and support for transparency.
- **Filename:** The filename **must** be the character it represents. For special characters, use descriptive names.
  - **Examples:** `A.png`, `b.png`, `0.png`, `percent.png`, `comma.png`, `space.png`.
- **Transparency:** The background of each character **must** be fully transparent (Alpha = 0). The template should only contain the pixels that make up the character's shape.

## 3. Character Template Rules

These rules are mandatory for every character template in the atlas.

### Rule 1: No Borders

All black borders and their associated anti-aliasing pixels must be completely removed. The template should represent the pure, "borderless" shape of the character.

### Rule 2: Magic Fill Color

The entire shape of the character (its "fill") **must** be colored with a single, consistent "magic color":

- **Color:** Pure Magenta
- **RGB:** `(255, 0, 255)`
- **Hex:** `#FF00FF`

This magic color acts as a mask, telling the recognition algorithm which pixels to check on the screen.

### Rule 3: Tight Bounding Box

Each PNG file should be cropped to the tightest possible bounding box around the character's shape. There should be no extra transparent padding. This ensures that character width and spacing are calculated correctly during recognition.

## 4. C++ Implementation Logic

The C++ module that consumes this font atlas should implement the following matching logic for each pixel comparison:

1.  Load a template from the atlas (e.g., `S.png`).
2.  Iterate through each pixel of the template.
3.  For each template pixel, check its color:
    - **If the template pixel is TRANSPARENT:**
      - **Action:** Ignore this pixel completely. It is not part of the character's shape.

    - **If the template pixel is the MAGIC COLOR (`255, 0, 255`):**
      - **Action:** This pixel represents the character's body. Check the corresponding pixel on the game screen.
      - **Condition:** The screen pixel **must not be black** (or very dark). A brightness threshold is recommended. For example, if `(R+G+B)/3 > 50`, it is considered a match. The exact color of the screen pixel (white, blue, yellow) does not matter.

A character is considered a "match" only if all of its magic color pixels correspond to non-black pixels on the screen.

## 5. How to Add New Characters

1.  Take a high-quality PNG screenshot from the game.
2.  Open the screenshot in a graphics editor (e.g., GIMP, Photoshop).
3.  Carefully crop the new character to its tightest bounding box.
4.  Remove the background and any black borders.
5.  Fill the remaining character shape with the magic color: `RGB(255, 0, 255)`.
6.  Export the image as a PNG file, named after the character (e.g., `question_mark.png`).
7.  Ensure all export settings are set for lossless quality with no metadata (see GIMP export guide).
8.  Place the new file in this directory.
