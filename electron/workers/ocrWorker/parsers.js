/**
 * @file parsers.js
 * @summary Modular parsers for OCR text processing
 * @description This file contains specialized parsers for different UI regions
 * that process OCR text data and convert it into structured formats for the UI state.
 */

/**
 * Parser for skills widget region
 * Processes OCR data from the skills widget and extracts skill information
 * @param {Array} ocrData - Array of OCR text objects with x, y, text properties
 * @returns {Array} Array of skill objects with text and position data
 */
export function parseSkillsWidget(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0) {
    return [];
  }

  // Filter valid items - the OCR library already returns structured data
  return ocrData.filter(
    (item) => item && typeof item === 'object' && item.text && item.text.trim(),
  );
}

/**
 * Parser for chatbox regions (main and secondary)
 * Processes OCR data from chat areas and structures it for UI consumption
 * @param {Array} ocrData - Array of OCR text objects from recognizeText
 * @returns {Array} Array of chat message objects
 */
export function parseChatbox(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0) {
    return [];
  }

  // The OCR library already returns structured data, just filter valid items
  return ocrData.filter((item) => item && typeof item === 'object');
}

/**
 * Parser for chat data (main and secondary chat boxes)
 * Processes OCR data from chat messages
 * @param {Array} ocrData - Array of OCR text objects from recognizeText
 * @returns {Array} Array of parsed chat messages
 */
export function parseChatData(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0) {
    return [];
  }

  // The OCR library already returns structured data, just filter valid items
  return ocrData.filter((item) => item && typeof item === 'object');
}

/**
 * Parser for chat box tab row
 * Processes OCR data from chat tabs to identify active/inactive tabs
 * @param {Array} ocrData - Array of OCR text objects from recognizeText
 * @returns {Array} Array of tab data objects with x, y, text, click, and color properties
 */
export function parseChatBoxTabRow(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0) {
    return [];
  }

  // The OCR library already returns structured data with x, y, text, click, color
  return ocrData.filter((item) => item && typeof item === 'object');
}

/**
 * Parser for character selection modal
 * Processes OCR data from character selection screen
 * @param {Array} ocrData - Array of OCR text objects from recognizeText
 * @returns {Array} Array of character data objects
 */
export function parseSelectCharacterModal(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0) {
    return [];
  }

  // The OCR library already returns structured data
  return ocrData.filter((item) => item && typeof item === 'object');
}

/**
 * Parser for VIP widget
 * Processes OCR data from VIP widget to separate online and offline VIPs
 * @param {Array} ocrData - Array of OCR text objects from recognizeText
 * @returns {Object} Object with online and offline arrays of sorted VIP names
 */
export function parseVipWidget(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0) {
    return { online: [], offline: [] };
  }

  const online = [];
  const offline = [];

  ocrData.forEach((item) => {
    if (!item || typeof item !== 'object' || !item.text) return;

    // Check color to determine online/offline status
    // [96, 248, 96] = green = online
    // [248, 96, 96] = red = offline
    const isOnline =
      item.color &&
      item.color.r === 96 &&
      item.color.g === 248 &&
      item.color.b === 96;

    if (isOnline) {
      online.push(item.text);
    } else {
      offline.push(item.text);
    }
  });

  // Sort alphabetically
  online.sort((a, b) => a.localeCompare(b));
  offline.sort((a, b) => a.localeCompare(b));

  return { online, offline };
}

/**
 * Parser registry mapping region names to their respective parsers
 * This allows for easy extension and maintenance of parsers
 */
export const regionParsers = {
  skillsWidget: parseSkillsWidget,
  chatboxMain: parseChatbox,
  chatboxSecondary: parseChatbox,
  chatBoxTabRow: parseChatBoxTabRow,
  selectCharacterModal: parseSelectCharacterModal,
  vipWidget: parseVipWidget,
};

/**
 * Generic parser dispatcher
 * Routes OCR data to the appropriate parser based on region name
 * @param {string} regionName - Name of the region being parsed
 * @param {Array} ocrData - Raw OCR data array
 * @returns {Object} Parsed data object with region and data properties
 */
export function parseRegionData(regionName, ocrData) {
  const parser = regionParsers[regionName];
  if (!parser) {
    console.warn(`[Parsers] No parser found for region: ${regionName}`);
    return { region: regionName, data: [] };
  }

  try {
    const data = parser(ocrData);
    return { region: regionName, data };
  } catch (error) {
    console.error(`[Parsers] Error parsing region ${regionName}:`, error);
    return { region: regionName, data: [] };
  }
}
