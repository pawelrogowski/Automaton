import pkg from 'font-ocr';
import regionDefinitions from '../../constants/regionDefinitions.js';

const { recognizeText } = pkg;

export const CHAR_PRESETS = {
  ALPHANUMERIC_SPACE:
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
};

/**
 * Processes the player list region to extract player names.
 * @param {Buffer} buffer - The screen capture buffer.
 * @param {object} regions - The object containing all region definitions.
 * @returns {Promise<string[]>} A promise that resolves to an array of player names.
 */
export async function processPlayerList(buffer, regions) {
  const playerListRegion = regions.playerList;
  if (
    !playerListRegion ||
    !playerListRegion.x ||
    !playerListRegion.y ||
    playerListRegion.width <= 0 ||
    playerListRegion.height <= 0
  ) {
    return [];
  }

  try {
    const playerOcrColors = regionDefinitions.playerList?.ocrColors || [];
    const ocrResults =
      recognizeText(
        buffer,
        playerListRegion,
        playerOcrColors,
        CHAR_PRESETS.ALPHANUMERIC_SPACE,
      ) || [];

    return ocrResults
      .map((result) => result.text.trim())
      .filter((name) => name.length > 0);
  } catch (ocrError) {
    console.error(
      '[CreatureMonitorOCR] OCR failed for playerList entries:',
      ocrError,
    );
    return [];
  }
}

/**
 * Processes the NPC list region to extract NPC names.
 * @param {Buffer} buffer - The screen capture buffer.
 * @param {object} regions - The object containing all region definitions.
 * @returns {Promise<string[]>} A promise that resolves to an array of NPC names.
 */
export async function processNpcList(buffer, regions) {
  const npcListRegion = regions.npcList;
  if (
    !npcListRegion ||
    !npcListRegion.x ||
    !npcListRegion.y ||
    npcListRegion.width <= 0 ||
    npcListRegion.height <= 0
  ) {
    return [];
  }

  try {
    const npcOcrColors = regionDefinitions.npcList?.ocrColors || [];
    const ocrResults =
      recognizeText(
        buffer,
        npcListRegion,
        npcOcrColors,
        CHAR_PRESETS.ALPHANUMERIC_SPACE,
      ) || [];

    return ocrResults
      .map((result) => result.text.trim())
      .filter((name) => name.length > 0);
  } catch (ocrError) {
    console.error(
      '[CreatureMonitorOCR] OCR failed for npcList entries:',
      ocrError,
    );
    return [];
  }
}
