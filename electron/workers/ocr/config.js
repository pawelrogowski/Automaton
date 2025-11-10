// /home/feiron/Dokumenty/Automaton/electron/workers/ocr/config.js
// --- MODIFIED ---

import { regionParsers } from './parsers.js';
import regionDefinitions from '../../constants/regionDefinitions.js';

export const MAIN_LOOP_INTERVAL = 100;

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
  'preyModal.children.balance': {
    colors: [[192, 192, 192]], // only this color for balance text
    parser: regionParsers.preyBalance,
    storeAction: 'uiValues/setPreyBalance',
    allowedChars: CHAR_PRESETS.NUMERIC,
    throttleMs: 500,
  },
  'marketModal.children.sellToList': {
    colors: [
      [192, 192, 192],
      [200, 125, 125],
      [244, 244, 244],
      [176, 17, 17]

    ], // character name text color
    parser: regionParsers.marketSellToList,
    storeAction: 'uiValues/setMarketSellToList',
    allowedChars: CHAR_PRESETS.ALPHA + ' ',
    throttleMs: 200,
  },
  'npcTalkModal.children.tradeSectionItemList': {
    colors: [[192, 192, 192]], // font color for trade section items
    parser: regionParsers.npcTalkModalTradeSectionItemList,
    storeAction: 'uiValues/setNpcTalkModalTradeItems',
    allowedChars: CHAR_PRESETS.ALPHA + ' ',
    throttleMs: 500,
  },
  'npcTalkModal.children.searchInput': {
    colors: [[255, 255, 255], [192, 192, 192]], // input text colors
    parser: regionParsers.npcTalkModalSearchInput,
    storeAction: 'uiValues/setNpcTalkModalSearchInput',
    allowedChars: CHAR_PRESETS.ALPHA + CHAR_PRESETS.NUMERIC + ' ',
    throttleMs: 200,
  },
  'npcTalkModal.children.amountInput': {
    colors: [[255, 255, 255], [192, 192, 192]], // input text colors
    parser: regionParsers.npcTalkModalAmountInput,
    storeAction: 'uiValues/setNpcTalkModalAmountInput',
    allowedChars: CHAR_PRESETS.NUMERIC,
    throttleMs: 200,
  },
};

