import fs from 'fs/promises';
import path from 'path';
import { PNG } from 'pngjs';

// Define the path to the Tibia minimap tiles
const TIBIA_MINIMAP_PATH = path.join(process.env.HOME || process.env.USERPROFILE, '.local', 'share', 'CipSoft GmbH', 'Tibia', 'packages', 'Tibia', 'minimap');
const TILE_SIZE = 256; // Pixels per tile dimension
const MINIMAP_WIDTH = 106; // Width of the captured minimap
const MINIMAP_HEIGHT = 109; // Height of the captured minimap
const MASK_X = 51; // X coordinate of the top-left corner of the mask area in the captured minimap
const MASK_Y = 52; // Y coordinate of the top-left corner of the mask area in the captured minimap
const MASK_SIZE = 6; // Size of the square mask area

// Function to build the mask for the captured minimap
// Returns a 2D array or similar structure where true indicates a masked pixel
function buildMinimapMask() {
  const mask = Array(MINIMAP_HEIGHT).fill(null).map(() => Array(MINIMAP_WIDTH).fill(false));
  for (let y = 0; y < MASK_SIZE; y++) {
    for (let x = 0; x < MASK_SIZE; x++) {
      if (MASK_Y + y < MINIMAP_HEIGHT && MASK_X + x < MINIMAP_WIDTH) {
        mask[MASK_Y + y][MASK_X + x] = true;
      }
    }
  }
  return mask;
}

const minimapMask = buildMinimapMask(); // Pre-calculate the mask

// Function to load a specific minimap tile PNG
// Returns the RGB buffer of the tile
async function loadMinimapTile(x, y, z) {
  const filename = `Minimap_Color_${x}_${y}_${z}.png`;
  const filepath = path.join(TIBIA_MINIMAP_PATH, filename);

  try {
    const data = await fs.readFile(filepath);
    return new Promise((resolve, reject) => {
      const png = new PNG({ filterType: 4 });
      png.parse(data, (err, data) => {
        if (err) {
          console.error(`[MinimapMatcher] Error parsing PNG tile ${filepath}:`, err);
          return reject(err);
        }
        // PNGJS data is RGBA, convert to RGB buffer
        const rgbBuffer = Buffer.alloc(data.width * data.height * 3);
        for (let i = 0; i < data.data.length; i += 4) {
          const rgbIndex = (i / 4) * 3;
          rgbBuffer[rgbIndex] = data.data[i]; // R
          rgbBuffer[rgbIndex + 1] = data.data[i + 1]; // G
          rgbBuffer[rgbIndex + 2] = data.data[i + 2]; // B
        }
        resolve(rgbBuffer);
      });
    });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`[MinimapMatcher] Error loading PNG tile ${filepath}:`, error);
    }
    return null; // Return null if tile does not exist or other error
  }
}

// Function to compare captured minimap buffer with a portion of a tile buffer
// Returns a similarity percentage (0-100)
function compareMinimaps(capturedMinimapBuffer, tileBuffer, tileX, tileY, tileWidth, tileHeight, offsetX, offsetY) {
    // offsetX, offsetY are the coordinates within the tile where the comparison starts

    if (!capturedMinimapBuffer || !tileBuffer) {
        return 0;
    }

    const capturedWidth = MINIMAP_WIDTH;
    const capturedHeight = MINIMAP_HEIGHT;
    const bytesPerPixel = 3;
    let matchingPixels = 0;
    let comparedPixels = 0;

    for (let y = 0; y < capturedHeight; y++) {
        for (let x = 0; x < capturedWidth; x++) {
            // Check if the current pixel in the captured minimap is within the masked area
            if (minimapMask[y][x]) {
                continue; // Skip masked pixels
            }

            // Calculate corresponding coordinates in the tile buffer
            const tileCoordX = offsetX + x;
            const tileCoordY = offsetY + y;

            // Ensure tile coordinates are within the valid bounds of the tile portion being compared
            if (tileCoordX >= tileWidth || tileCoordY >= tileHeight) {
                continue; // This should not happen if offsetX/offsetY and tileWidth/tileHeight are calculated correctly
            }

            const capturedIndex = (y * capturedWidth + x) * bytesPerPixel;
            const tileIndex = (tileCoordY * TILE_SIZE + tileCoordX) * bytesPerPixel;

            // Ensure indices are within buffer bounds
             if (capturedIndex + 2 >= capturedMinimapBuffer.length || tileIndex + 2 >= tileBuffer.length) {
                console.warn("[MinimapMatcher] Index out of bounds during comparison, skipping pixel.");
                continue;
            }

            comparedPixels++;

            // Compare RGB values
            if (capturedMinimapBuffer[capturedIndex] === tileBuffer[tileIndex] &&
                capturedMinimapBuffer[capturedIndex + 1] === tileBuffer[tileIndex + 1] &&
                capturedMinimapBuffer[capturedIndex + 2] === tileBuffer[tileIndex + 2]) {
                matchingPixels++;
            }
        }
    }

    if (comparedPixels === 0) {
        return 0; // Avoid division by zero
    }

    return (matchingPixels / comparedPixels) * 100;
}


// Main function to find the best matching tile(s) for the captured minimap
// This function will need to determine which tile(s) to load and compare against.
// Given the minimap is 106x109 and tiles are 256x256, the captured minimap can be fully contained
// within a single tile, or span across 2x2 (or possibly 1x2 or 2x1) tiles.
// The player is in the center of the captured minimap (approx 53, 54).
// The tile coordinates x, y, z are absolute, with x, y representing the top-left of a 256x256 tile.
// The player's absolute coordinate can be estimated from their position within the minimap
// and the minimap's absolute position on the screen (though we only have minimap's top-left for now).
// We need a way to map the player's estimated absolute coordinates (or just the center of the captured minimap relative to the whole game map)
// to potential tile x, y coordinates to search. This mapping is not explicitly defined, but generally,
// the game map coordinates are large numbers, and the tile coordinates are these numbers divided by 256.
// Let's assume for now we have a rough idea of the player's absolute x, y, z.
// A captured minimap centered at (player_x, player_y) will overlap tiles around (floor(player_x/256), floor(player_y/256)).
// We should compare against the tile containing the center of the minimap and its neighbors (up, down, left, right, and diagonals)
// if the minimap is near the tile boundaries.

// For a first pass, let's assume we have the player's estimated absolute position (playerAbsX, playerAbsY, playerAbsZ).
// The center of the captured minimap corresponds to this player position.
// The top-left of the captured minimap (minimapRegion.x, minimapRegion.y on screen) corresponds to some absolute map coordinate.
// The player is at (minimapRegion.x + 53, minimapRegion.y + 54) on screen.
// Let's consider the simplified case where the player's absolute coordinate directly maps to the center of the minimap capture.
// Player's absolute X corresponds to the minimap pixel at x=53.
// Player's absolute Y corresponds to the minimap pixel at y=54.
// A tile Minimap_Color_X_Y_Z.png covers the absolute coordinate range [X, X+255] in x and [Y, Y+255] in y.
// If the player is at (playerAbsX, playerAbsY), the tile containing the player is Minimap_Color_(floor(playerAbsX/256)*256)_(floor(playerAbsY/256)*256)_playerAbsZ.png.
// The player's position within this tile would be (playerAbsX % 256, playerAbsY % 256).
// The center of the captured minimap (53, 54) corresponds to this position within the tile.
// Therefore, the top-left pixel of the captured minimap (0,0) corresponds to the absolute map coordinate
// (playerAbsX - 53, playerAbsY - 54).
// This top-left coordinate (absMinimapTopLeftX, absMinimapTopLeftY) will fall into a tile.
// The tile containing (absMinimapTopLeftX, absMinimapTopLeftY) is Minimap_Color_(floor(absMinimapTopLeftX/256)*256)_(floor(absMinimapTopLeftY/256)*256)_playerAbsZ.png.
// The offset of the captured minimap's top-left within this tile is (absMinimapTopLeftX % 256, absMinimapTopLeftY % 256).

// To handle cases where the captured minimap spans multiple tiles, we need to calculate
// the absolute coordinates of the four corners of the captured minimap:
// Top-left: (playerAbsX - 53, playerAbsY - 54)
// Top-right: (playerAbsX - 53 + 105, playerAbsY - 54)
// Bottom-left: (playerAbsX - 53, playerAbsY - 54 + 108)
// Bottom-right: (playerAbsX - 53 + 105, playerAbsY - 54 + 108)
// We then find the tile coordinates (base_x, base_y) for each of these four corners by integer division by 256 and multiplication by 256.
// The set of unique (base_x, base_y) pairs gives us the tiles the captured minimap might overlap.
// We need to load these tiles and compare the relevant portion of each loaded tile buffer with the corresponding portion of the captured minimap buffer.

// Let's refine the matching strategy:
// Given the captured minimap buffer and the player's absolute coordinates (playerAbsX, playerAbsY, playerAbsZ):
// 1. Calculate the absolute coordinates of the captured minimap's top-left pixel:
//    absMinimapTopLeftX = playerAbsX - 53
//    absMinimapTopLeftY = playerAbsY - 54
// 2. Determine the potential tile base coordinates that the captured minimap overlaps.
//    This includes the tile containing (absMinimapTopLeftX, absMinimapTopLeftY) and potentially tiles
//    to the right and/or down if the minimap extends into them.
//    baseX = floor(absMinimapTopLeftX / 256) * 256
//    baseY = floor(absMinimapTopLeftY / 256) * 256
//    The minimap might also overlap with tiles:
//    (baseX + 256, baseY) if absMinimapTopLeftX + MINIMAP_WIDTH > baseX + 256
//    (baseX, baseY + 256) if absMinimapTopLeftY + MINIMAP_HEIGHT > baseY + 256
//    (baseX + 256, baseY + 256) if both conditions above are true.
//    So, the candidate tiles are (baseX, baseY, playerAbsZ), and optionally (baseX+256, baseY, playerAbsZ), (baseX, baseY+256, playerAbsZ), (baseX+256, baseY+256, playerAbsZ).
// 3. Load the buffer for each candidate tile.
// 4. For each candidate tile, calculate the offset within the tile that corresponds to the top-left of the captured minimap.
//    offsetX = (absMinimapTopLeftX % 256 + 256) % 256 // Use modulo to handle negative results correctly
//    offsetY = (absMinimapTopLeftY % 256 + 256) % 256
// 5. Determine the portion of the captured minimap that overlaps with the current candidate tile.
//    This depends on the offset. For the main tile (baseX, baseY), the comparison starts at (offsetX, offsetY) within the tile and covers
//    MINIMAP_WIDTH x MINIMAP_HEIGHT pixels. However, for overlapping tiles, the comparison area is smaller.
//    For example, for tile (baseX+256, baseY), the comparison starts at (offsetX - 256, offsetY) within the tile and covers
//    (MINIMAP_WIDTH - offsetX) x MINIMAP_HEIGHT pixels.
// 6. Use the `compareMinimaps` function to compare the relevant portion of the captured minimap buffer with the corresponding portion of the loaded tile buffer, applying the mask to the captured minimap part.
// 7. Keep track of the best match (highest similarity percentage) and the tile coordinates it corresponds to.
// 8. Return the best match percentage and coordinates if it exceeds the 95% threshold.

// This requires knowing the player's absolute coordinates. Since the worker doesn't inherently know this,
// this information would need to be passed to the worker or derived from other game state (which is outside the scope of rawCapture.js).
// For now, let's create a function that takes the captured minimap buffer and the *estimated* absolute coordinates of the player's character
// (or rather, the absolute coordinates of the center of the captured minimap) and the floor level.

export async function matchMinimap(capturedMinimapBuffer, playerAbsX, playerAbsY, playerAbsZ) {
    if (!capturedMinimapBuffer || !playerAbsX || !playerAbsY || playerAbsZ === undefined) {
        console.error("[MinimapMatcher] Invalid input for matching.");
        return null;
    }

    const absMinimapTopLeftX = playerAbsX - 53;
    const absMinimapTopLeftY = playerAbsY - 54;

    const candidateTiles = [];

    // Calculate base tile coordinates for the top-left of the captured minimap
    const baseX = Math.floor(absMinimapTopLeftX / TILE_SIZE) * TILE_SIZE;
    const baseY = Math.floor(absMinimapTopLeftY / TILE_SIZE) * TILE_SIZE;

    // Add the main tile
    candidateTiles.push({ x: baseX, y: baseY, z: playerAbsZ });

    // Check for overlap with adjacent tiles and add them as candidates
    if ((absMinimapTopLeftX % TILE_SIZE + TILE_SIZE) % TILE_SIZE + MINIMAP_WIDTH > TILE_SIZE) {
         // Overlaps right
         candidateTiles.push({ x: baseX + TILE_SIZE, y: baseY, z: playerAbsZ });
    }
    if ((absMinimapTopLeftY % TILE_SIZE + TILE_SIZE) % TILE_SIZE + MINIMAP_HEIGHT > TILE_SIZE) {
         // Overlaps down
         candidateTiles.push({ x: baseX, y: baseY + TILE_SIZE, z: playerAbsZ });
    }
    if ((absMinimapTopLeftX % TILE_SIZE + TILE_SIZE) % TILE_SIZE + MINIMAP_WIDTH > TILE_SIZE &&
        (absMinimapTopLeftY % TILE_SIZE + TILE_SIZE) % TILE_SIZE + MINIMAP_HEIGHT > TILE_SIZE) {
         // Overlaps right-down
         candidateTiles.push({ x: baseX + TILE_SIZE, y: baseY + TILE_SIZE, z: playerAbsZ });
    }

    let bestMatch = { percentage: 0, x: null, y: null, z: null };

    for (const tileInfo of candidateTiles) {
        const tileBuffer = await loadMinimapTile(tileInfo.x, tileInfo.y, tileInfo.z);

        if (!tileBuffer) {
            // Tile file not found, skip this candidate
            continue;
        }

        // Calculate the offset within the current tile where the captured minimap starts
        const offsetX = (absMinimapTopLeftX - tileInfo.x + TILE_SIZE) % TILE_SIZE;
        const offsetY = (absMinimapTopLeftY - tileInfo.y + TILE_SIZE) % TILE_SIZE;

        // The comparison area is MINIMAP_WIDTH x MINIMAP_HEIGHT, starting at (offsetX, offsetY) in the tile buffer
        // and (0,0) in the capturedMinimapBuffer.
        // The compareMinimaps function already handles checking bounds based on the captured minimap size.
        // The important part is that the portion of the tile we compare against should be large enough.
        // Since we are iterating through candidate tiles that overlap the minimap area, the necessary portion
        // of the tile will always be at least partially covered by the MINIMAP_WIDTH x MINIMAP_HEIGHT area
        // starting at (offsetX, offsetY) within the tile coordinates.
        // The `compareMinimaps` function needs to correctly map captured minimap pixels (x, y)
        // to tile buffer pixels (tileX, tileY) based on the current tile's offset (offsetX, offsetY).

        const matchPercentage = compareMinimaps(
            capturedMinimapBuffer,
            tileBuffer,
            TILE_SIZE, // Pass tile width/height for bounds checking within compareMinimaps
            TILE_SIZE,
            offsetX,
            offsetY
        );

        console.log(`[MinimapMatcher] Compared captured minimap with tile ${tileInfo.x},${tileInfo.y},${tileInfo.z}: ${matchPercentage.toFixed(2)}%`);

        if (matchPercentage > bestMatch.percentage) {
            bestMatch = { percentage: matchPercentage, x: tileInfo.x, y: tileInfo.y, z: tileInfo.z };
        }
    }

    const threshold = 95; // Minimum match percentage required
    if (bestMatch.percentage >= threshold) {
        console.log(`[MinimapMatcher] Found best match: Tile ${bestMatch.x},${bestMatch.y},${bestMatch.z} with ${bestMatch.percentage.toFixed(2)}% similarity.`);
        return { x: bestMatch.x, y: bestMatch.y, z: bestMatch.z, similarity: bestMatch.percentage };
    } else {
        console.log(`[MinimapMatcher] No match found above ${threshold}% threshold. Best match was ${bestMatch.percentage.toFixed(2)}% with tile ${bestMatch.x},${bestMatch.y},${bestMatch.z}.`);
        return null;
    }
}