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
  SPECIAL: `~!@#$%^&*()_+{}|":?><-=[];'\./ `,
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
    allowedChars: CHAR_PRESETS.ALPHANUMERIC + ' .:',
  },
  // chatboxMain: {
  //   colors: regionDefinitions.chatboxMain?.ocrColors,
  //   parser: regionParsers.chatboxMain,
  //   storeAction: 'uiValues/setChatboxMain',
  //   allowedChars: CHAR_PRESETS.ALL,
  // },
  // chatboxSecondary: {
  //   colors: regionDefinitions.chatboxSecondary?.ocrColors,
  //   parser: regionParsers.chatboxSecondary,
  //   storeAction: 'uiValues/setChatboxSecondary',
  //   allowedChars: CHAR_PRESETS.ALL,
  // },
  chatBoxTabRow: {
    colors: regionDefinitions.chatBoxTabRow?.ocrColors,
    parser: regionParsers.chatBoxTabRow,
    storeAction: 'uiValues/setChatTabs',
    allowedChars: CHAR_PRESETS.ALPHA + ' ',
  },
  selectCharacterModal: {
    colors: regionDefinitions.selectCharacterModal?.ocrColors,
    parser: regionParsers.selectCharacterModal,
    storeAction: 'uiValues/setSelectCharacterModal',
    allowedChars: CHAR_PRESETS.ALPHA + ' ',
  },
  vipWidget: {
    colors: regionDefinitions.vipWidget?.ocrColors,
    parser: regionParsers.vipWidget,
    storeAction: 'uiValues/setVipWidget',
    allowedChars: CHAR_PRESETS.ALPHA + ' ',
  },
  gameWorld: {
    colors: regionDefinitions.gameWorld?.ocrColors,
    parser: regionParsers.gameWorld,
    storeAction: 'uiValues/setGameWorldOcr',
    // dictionary: ['Phant', 'Rat', 'Spider', 'Dog'],
    allowedChars: CHAR_PRESETS.ALPHA + ' ',
  },
};
