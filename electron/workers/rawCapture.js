import { parentPort, workerData, isMainThread } from 'worker_threads';
import { createRequire } from 'module';
import regionColorSequences from '../constants/regionColorSequeces.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ info: true, error: true, warn: true });

import fs from 'fs/promises';
import fsSync from 'fs'; // For createWriteStream
import path from 'path';
import { PNG } from 'pngjs';
// Import the new minimap matcher utility
import { findMatchingMinimapTilesBruteForce } from '../utils/minimapMatcher.js';

// Load X11Capture module
const require = createRequire(import.meta.url);
const { X11Capture } = require(workerData?.x11capturePath);
const { findSequencesNative } = require(workerData?.findSequencesPath);

// State
let state = null;
let captureInstance = null;
let minimapRegion = null;
let consecutiveFrameFailures = 0;
let captureStartTime = null;
let hasSavedCapture = false;
const MAX_CONSECUTIVE_FRAME_FAILURES = 10;
const GET_FRAME_RETRY_DELAY = 50;
const GET_FRAME_MAX_RETRIES = 5;
const FRAME_RETRY_DELAY = 100;
const CAPTURE_DURATION = 5000; // 5 seconds in milliseconds

// Initialize capture
async function initializeCapture() {
  if (!state?.global?.windowId || !state?.global?.refreshRate) {
    log('error', '[RawCapture] Cannot initialize: missing windowId or refreshRate');
    return false;
  }

  try {
    log('info', '[RawCapture] Starting initialization...');

    // Create new instance if needed\n    if (!captureInstance) {
      captureInstance = new X11Capture();
    }

    const windowId = state.global.windowId;
    const targetFps = state.global.refreshRate;

    log('info', `[RawCapture] Starting continuous capture for window ${windowId} at ${targetFps} FPS...`);
    captureInstance.startContinuousCapture(windowId, targetFps);
    await new Promise((resolve) => setTimeout(resolve, 100)); // Increased delay

    // Get initial frame with retries\n    let frame = null;\n    let retries = 0;\n    while (!frame?.data && retries < GET_FRAME_MAX_RETRIES) {\n      frame = captureInstance.getLatestFrame();\n      if (!frame?.data) {\n        retries++;\n        log('warn', `[RawCapture] Initial frame not ready, retry ${retries}/${GET_FRAME_MAX_RETRIES}...`);\n        await new Promise((resolve) => setTimeout(resolve, GET_FRAME_RETRY_DELAY * (retries + 1)));\n      }\n    }\n
    if (!frame?.data) {
      throw new Error(`[RawCapture] Failed to get initial frame after ${GET_FRAME_MAX_RETRIES} retries`);
    }

    log('info', `[RawCapture] Got initial frame: ${frame.width}x${frame.height}`);

    // Find minimap location
    log('info', '[RawCapture] Searching for minimap...');
    const result = findSequencesNative(frame.data, { minimapFull: regionColorSequences.minimapFull }, null, 'first');
    if (!result?.minimapFull) {
      throw new Error('[RawCapture] Failed to find minimap sequence');
    }

    // Create minimap region with offset
    const { x, y } = result.minimapFull;
    const offset = regionColorSequences.minimapFull.offset;
    minimapRegion = {
      x: x,
      y: y,
      width: 106,
      height: 109,
    };

    log('info', `[RawCapture] Found minimap at: x=${minimapRegion.x}, y=${minimapRegion.y}`);
    consecutiveFrameFailures = 0;
    return true;
  } catch (error) {
    log('error', '[RawCapture] Failed to initialize:', error);
    await cleanupCapture();
    return false;
  }
}

async function cleanupCapture() {
  if (captureInstance) {
    try {
      captureInstance.stopContinuousCapture();
    } catch (e) {
      log('error', '[RawCapture] Error stopping capture:', e);
    }
  }
  captureInstance = null;
  minimapRegion = null;
  consecutiveFrameFailures = 0;
}


// Extract minimap data from frame\nfunction extractMinimapData(frame) {\n  if (!frame?.data || !minimapRegion) return null;\n\n  const bytesPerPixel = 3;\n  const headerSize = 8;\n\n  // Calculate total frame size in bytes\n  const frameSize = frame.width * frame.height * bytesPerPixel;\n\n  // Calculate minimap region bounds\n  const startIndex = (minimapRegion.y * frame.width + minimapRegion.x) * bytesPerPixel + headerSize;\n  const minimapSize = minimapRegion.width * minimapRegion.height * bytesPerPixel;\n  const endIndex = startIndex + minimapSize;\n\n  // Debug logging\n  // log('debug', `[RawCapture] Frame dimensions: ${frame.width}x${frame.height}, size: ${frameSize} bytes`);\n  // log('debug', `[RawCapture] Minimap region: x=${minimapRegion.x}, y=${minimapRegion.y}, size: ${minimapSize} bytes`);\n  // log('debug', `[RawCapture] Data bounds: start=${startIndex}, end=${endIndex}, total=${frame.data.length}`);\n\n  // Log first few pixels of the frame for debugging\n  // log('debug', '[RawCapture] First few pixels of frame:');\n  // for (let i = headerSize; i < headerSize + 30; i += 3) {\n  //   log('debug', `Pixel at ${i}: R=${frame.data[i]}, G=${frame.data[i + 1]}, B=${frame.data[i + 2]}`);\n  // }\n\n  // Validate bounds\n  if (startIndex < headerSize) {\n    log('error', '[RawCapture] Start index before header:', startIndex, 'headerSize:', headerSize);\n    return null;\n  }\n\n  if (endIndex > frame.data.length) {\n    log('error', '[RawCapture] End index exceeds frame data:', endIndex, 'frame data length:', frame.data.length);\n    return null;\n  }\n\n  if (startIndex >= endIndex) {\n    log('error', '[RawCapture] Invalid region: start index >= end index');\n    return null;\n  }\n\n  try {\n    const minimapData = frame.data.slice(startIndex, endIndex);\n\n    // Log first few pixels of the minimap for debugging\n    // log('debug', '[RawCapture] First few pixels of minimap:');\n    // for (let i = 0; i < 30; i += 3) {\n    //   log('debug', `Minimap pixel at ${i}: R=${minimapData[i]}, G=${minimapData[i + 1]}, B=${minimapData[i + 2]}`);\n    // }\n\n    return minimapData;\n  } catch (error) {\n    log('error', '[RawCapture] Error extracting minimap data:', error);\n    return null;\n  }\n}\n
// Save minimap data to file
async function saveMinimapData(minimapData) {
  if (!minimapData) return;

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `minimap_capture_${timestamp}.bmp`;
    const filepath = path.join(process.cwd(), filename);

    // Convert minimapData from RGB to BGR for BMP format
    const bgrData = Buffer.alloc(minimapData.length);
    for (let i = 0; i < minimapData.length; i += 3) {
      bgrData[i] = minimapData[i + 2]; // B
      bgrData[i + 1] = minimapData[i + 1]; // G
      bgrData[i + 2] = minimapData[i]; // R
    }

    // Calculate row padding (BMP rows must be multiple of 4 bytes)
    const bytesPerRow = 106 * 3; // width * bytes per pixel
    const paddingPerRow = (4 - (bytesPerRow % 4)) % 4; // padding to make row length multiple of 4
    const paddedRowLength = bytesPerRow + paddingPerRow;

    // Create padded data buffer
    const paddedData = Buffer.alloc(paddedRowLength * 109); // padded row length * height

    // Copy data row by row with padding
    for (let y = 0; y < 109; y++) {
      const srcOffset = y * bytesPerRow;
      const destOffset = y * paddedRowLength;
      bgrData.copy(paddedData, destOffset, srcOffset, srcOffset + bytesPerRow);
    }

    // BMP header (54 bytes)
    const header = Buffer.alloc(54);

    // BMP file header (14 bytes)
    header.write('BM', 0); // Signature
    header.writeUInt32LE(54 + paddedData.length, 2); // File size
    header.writeUInt32LE(54, 10); // Pixel data offset

    // BMP info header (40 bytes)
    header.writeUInt32LE(40, 14); // Info header size
    header.writeInt32LE(106, 18); // Width
    header.writeInt32LE(-109, 22); // Height (negative for top-down)
    header.writeUInt16LE(1, 26); // Planes
    header.writeUInt16LE(24, 28); // Bits per pixel
    header.writeUInt32LE(0, 30); // Compression
    header.writeUInt32LE(paddedData.length, 34); // Image size

    // Log the first few pixels before saving
    console.log('[RawCapture] First few pixels before saving:');
    for (let i = 0; i < 30; i += 3) {
      console.log(`Save pixel at ${i}: R=${minimapData[i]}, G=${minimapData[i + 1]}, B=${minimapData[i + 2]}`);
    }

    // Combine header and padded data
    const fullData = Buffer.concat([header, paddedData]);

    await fs.writeFile(filepath, fullData);
    console.log(`[RawCapture] Saved minimap data to: ${filepath}`);
    hasSavedCapture = true;
  } catch (error) {
    console.error('[RawCapture] Failed to save minimap data:', error);
  }
}

// Save full frame data in multiple formats
async function saveFullFrame(frame) {
  if (!frame?.data) return;
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const width = frame.width;
    const height = frame.height;
    const bytesPerPixel = 3;
    const headerSize = 8;
    const rgbData = frame.data.slice(headerSize); // Remove header
    const bmpPath = path.join(process.cwd(), `frame_${timestamp}.bmp`);
    const pngPath = path.join(process.cwd(), `frame_${timestamp}.png`);

    // Save BMP (BGR, with row padding)
    const bytesPerRow = width * bytesPerPixel;
    const paddingPerRow = (4 - (bytesPerRow % 4)) % 4;
    const paddedRowLength = bytesPerRow + paddingPerRow;
    const paddedData = Buffer.alloc(paddedRowLength * height);

    // Convert to BGR
    const bgrData = Buffer.alloc(rgbData.length);
    for (let i = 0; i < rgbData.length; i += 3) {
      bgrData[i] = rgbData[i + 2]; // B
      bgrData[i + 1] = rgbData[i + 1]; // G
      bgrData[i + 2] = rgbData[i]; // R
    }

    for (let y = 0; y < height; y++) {
      const srcOffset = y * bytesPerRow;
      const destOffset = y * paddedRowLength;
      bgrData.copy(paddedData, destOffset, srcOffset, srcOffset + bytesPerRow);
    }
    const bmpHeader = Buffer.alloc(54);
    bmpHeader.write('BM', 0);
    bmpHeader.writeUInt32LE(54 + paddedData.length, 2);
    bmpHeader.writeUInt32LE(54, 10);
    bmpHeader.writeUInt32LE(40, 14);
    bmpHeader.writeInt32LE(width, 18);
    bmpHeader.writeInt32LE(-height, 22); // top-down
    bmpHeader.writeUInt16LE(1, 26);
    bmpHeader.writeUInt16LE(24, 28);
    bmpHeader.writeUInt32LE(0, 30);
    bmpHeader.writeUInt32LE(paddedData.length, 34);
    const bmpFull = Buffer.concat([bmpHeader, paddedData]);
    await fs.writeFile(bmpPath, bmpFull);
    console.log(`[RawCapture] Saved BMP to: ${bmpPath}`);

    // Save PNG (using pngjs, RGB)
    const png = new PNG({ width, height });
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = (y * width + x) * 3;
        const dstIdx = (y * width + x) * 4;
        png.data[dstIdx] = rgbData[srcIdx]; // R
        png.data[dstIdx + 1] = rgbData[srcIdx + 1]; // G
        png.data[dstIdx + 2] = rgbData[srcIdx + 2]; // B
        png.data[dstIdx + 3] = 255; // Alpha
      }
    }
    await new Promise((resolve, reject) => {
      png.pack().pipe(fsSync.createWriteStream(pngPath)).on('finish', resolve).on('error', reject);
    });
    console.log(`[RawCapture] Saved PNG to: ${pngPath}`);
  } catch (error) {
    console.error('[RawCapture] Failed to save full frame:', error);
  }
}

// Save full frame as BMP, overwriting frame.bmp each time
async function saveFullFrameBMP(frame) {
  if (!frame?.data) return;
  try {
    const width = frame.width;
    const height = frame.height;
    const bytesPerPixel = 3;
    const headerSize = 8;
    const rgbData = frame.data.slice(headerSize); // Remove header
    const bmpPath = path.join(process.cwd(), 'frame.bmp');

    // Convert to BGR
    const bgrData = Buffer.alloc(rgbData.length);
    for (let i = 0; i < rgbData.length; i += 3) {
      bgrData[i] = rgbData[i + 2]; // B
      bgrData[i + 1] = rgbData[i + 1]; // G
      bgrData[i + 2] = rgbData[i]; // R
    }

    // Row padding
    const bytesPerRow = width * bytesPerPixel;
    const paddingPerRow = (4 - (bytesPerRow % 4)) % 4;
    const paddedRowLength = bytesPerRow + paddingPerRow;
    const paddedData = Buffer.alloc(paddedRowLength * height);
    for (let y = 0; y < height; y++) {
      const srcOffset = y * bytesPerRow;
      const destOffset = y * paddedRowLength;
      bgrData.copy(paddedData, destOffset, srcOffset, srcOffset + bytesPerRow);
    }

    // BMP header
    const bmpHeader = Buffer.alloc(54);
    bmpHeader.write('BM', 0);
    bmpHeader.writeUInt32LE(54 + paddedData.length, 2);
    bmpHeader.writeUInt32LE(54, 10);
    bmpHeader.writeUInt32LE(40, 14);
    bmpHeader.writeInt32LE(width, 18);
    bmpHeader.writeInt32LE(-height, 22); // top-down
    bmpHeader.writeUInt16LE(1, 26);
    bmpHeader.writeUInt16LE(24, 28);
    bmpHeader.writeUInt32LE(0, 30);
    bmpHeader.writeUInt32LE(paddedData.length, 34);
    const bmpFull = Buffer.concat([bmpHeader, paddedData]);
    await fs.writeFile(bmpPath, bmpFull);
    console.log(`[RawCapture] Saved full frame BMP to: ${bmpPath}`);
  } catch (error) {
    console.error('[RawCapture] Failed to save full frame BMP:', error);
  }
}

// Main loop
async function start() {
  if (isMainThread) {
    console.error('[RawCapture] Must be run as worker thread');
    process.exit(1);
  }

  while (true) {
    try {
      if (!captureInstance && !(await initializeCapture())) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      const frame = captureInstance.getLatestFrame();
      if (!frame?.data) {
        consecutiveFrameFailures++;
        console.warn(`[RawCapture] Frame capture failed. Consecutive failures: ${consecutiveFrameFailures}`);
        if (consecutiveFrameFailures >= MAX_CONSECUTIVE_FRAME_FAILURES) {
          console.error('[RawCapture] Too many consecutive failures, reinitializing capture...');
          await cleanupCapture();
          continue;
        }
        await new Promise((resolve) => setTimeout(resolve, FRAME_RETRY_DELAY));
        continue;
      }
      consecutiveFrameFailures = 0;

      // Extract minimap data
      const minimapData = extractMinimapData(frame);

      if (minimapData) {
        console.log('[RawCapture] Minimap data extracted, starting brute-force matching...');
        // Find matching minimap tiles using brute-force
        // Note: Brute-force can be computationally expensive and might take a long time
        const matchingTiles = await findMatchingMinimapTilesBruteForce(minimapData);

        if (matchingTiles.length > 0) {
          console.log('[RawCapture] Found matching tiles:', matchingTiles);
          // Optionally, send the match results back to the main thread
          parentPort.postMessage({ type: 'minimapMatches', matches: matchingTiles });
        } else {
          console.log('[RawCapture] No matching tiles found above threshold in the defined search range.');
        }
      } else {
        console.warn('[RawCapture] Failed to extract minimap data.');
      }

      // Optional: Save full frame BMP for debugging if needed
      // await saveFullFrameBMP(frame);

      // Calculate delay based on target FPS
      const targetFrameTime = 1000 / (state?.global?.refreshRate || 20);
      await new Promise((resolve) => setTimeout(resolve, targetFrameTime));
    } catch (error) {
      console.error('[RawCapture] Error in main loop:', error);
      await cleanupCapture();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// Handle messages from main thread
parentPort.on('message', (message) => {
  if (message.command === 'forceReinitialize') {
    cleanupCapture();
    return;
  }

  // Update state with the received message
  state = message;
  if (captureInstance && state?.global?.refreshRate) {
    try {
      captureInstance.setTargetFPS(state.global.refreshRate);
    } catch (e) {
      console.error('[RawCapture] Error updating FPS:', e);
    }
  }
});

// Cleanup on close
parentPort.on('close', async () => {
  await cleanupCapture();
  process.exit(0);
});

start().catch((error) => {
  console.error('[RawCapture] Fatal error:', error);
  process.exit(1);
});
