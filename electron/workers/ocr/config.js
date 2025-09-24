// /home/feiron/Dokumenty/Automaton/electron/workers/ocr/config.js
// --- MODIFIED ---

import { regionParsers } from './parsers.js';
import regionDefinitions from '../../constants/regionDefinitions.js';

export const MAIN_LOOP_INTERVAL = 5;

export const FRAME_COUNTER_INDEX = 0;
export const WIDTH_INDEX = 1;
export const HEIGHT_INDEX = 2;
export const IS_RUNNING_INDEX = 3;
export const DIRTY_REGION_COUNT_INDEX = 5;
export const DIRTY_REGIONS_START_INDEX = 6;

export const CHAR_PRESETS = {
  LOWERCASE: 'abcdefghijklmnopqrstuvwxyz',
  UPPERCASE: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  NUMERIC: '0123456789',
  SPECIAL: `~!@#$%^&*()_+{}|":?><-=[];'./ `,
};
CHAR_PRESETS.ALL =
  CHAR_PRESETS.LOWERCASE +
  CHAR_PRESETS.NUMERIC +
  CHAR_PRESETS.SPECIAL +
  CHAR_PRESETS.UPPERCASE;
CHAR_PRESETS.ALPHA = CHAR_PRESETS.LOWERCASE + CHAR_PRESETS.UPPERCASE;
CHAR_PRESETS.ALPHANUMERIC = CHAR_PRESETS.ALPHA + CHAR_PRESETS.NUMERIC;

export const OCR_REGION_CONFIGS = {
  skillsWidget: {
    colors: regionDefinitions.skillsWidget?.ocrColors,
    parser: regionParsers.skillsWidget,
    storeAction: 'uiValues/setSkillsWidget',
    allowedChars: CHAR_PRESETS.ALPHANUMERIC + ' .:,',
    throttleMs: 250, // NEW
  },
  chatBoxTabRow: {
    colors: regionDefinitions.chatBoxTabRow?.ocrColors,
    parser: regionParsers.chatBoxTabRow,
    storeAction: 'uiValues/setChatTabs',
    allowedChars: CHAR_PRESETS.ALPHA + ' ',
    throttleMs: 500, // NEW
  },
  selectCharacterModal: {
    colors: regionDefinitions.selectCharacterModal?.ocrColors,
    parser: regionParsers.selectCharacterModal,
    storeAction: 'uiValues/setSelectCharacterModal',
    allowedChars: CHAR_PRESETS.ALPHA + ' ',
    throttleMs: 100, // NEW
  },
  vipWidget: {
    colors: regionDefinitions.vipWidget?.ocrColors,
    parser: regionParsers.vipWidget,
    storeAction: 'uiValues/setVipWidget',
    allowedChars: CHAR_PRESETS.ALPHA + ' ',
    throttleMs: 2000, // NEW
  },
};
