import { regionParsers } from './parsers.js';
import regionDefinitions from '../../constants/regionDefinitions.js';

export const MAIN_LOOP_INTERVAL = 20;
export const PERFORMANCE_LOGGING_ENABLED = true;
export const PERFORMANCE_LOG_INTERVAL_MS = 10000;

export const FRAME_COUNTER_INDEX = 0;
export const WIDTH_INDEX = 1;
export const HEIGHT_INDEX = 2;
export const IS_RUNNING_INDEX = 3;
export const DIRTY_REGION_COUNT_INDEX = 5;
export const DIRTY_REGIONS_START_INDEX = 6;

export const OCR_REGION_CONFIGS = {
  skillsWidget: {
    colors: regionDefinitions.skillsWidget?.ocrColors,
    parser: regionParsers.skillsWidget,
    storeAction: 'uiValues/setSkillsWidget',
  },
  chatboxMain: {
    colors: regionDefinitions.chatboxMain?.ocrColors,
    parser: regionParsers.chatboxMain,
    storeAction: 'uiValues/setChatboxMain',
  },
  chatboxSecondary: {
    colors: regionDefinitions.chatboxSecondary?.ocrColors,
    parser: regionParsers.chatboxSecondary,
    storeAction: 'uiValues/setChatboxSecondary',
  },
  chatBoxTabRow: {
    colors: regionDefinitions.chatBoxTabRow?.ocrColors,
    parser: regionParsers.chatBoxTabRow,
    storeAction: 'uiValues/setChatTabs',
  },
  selectCharacterModal: {
    colors: regionDefinitions.selectCharacterModal?.ocrColors,
    parser: regionParsers.selectCharacterModal,
    storeAction: 'uiValues/setSelectCharacterModal',
  },
  vipWidget: {
    colors: regionDefinitions.vipWidget?.ocrColors,
    parser: regionParsers.vipWidget,
    storeAction: 'uiValues/setVipWidget',
  },
};
