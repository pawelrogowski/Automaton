import { parentPort } from 'worker_threads';
import grabScreen from '../screenMonitor/screenGrabUtils/grabScreen.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';
import findSequences from '../screenMonitor/screenGrabUtils/findSequences.js';
import regionColorSequences from '../constants/regionColorSequeces.js';
import cooldownColorSequences from '../constants/cooldownColorSequences.js';
import battleListSequences from '../constants/battleListSequences.js';
import statusBarSequences from '../constants/statusBarSequences.js';
import parseMathCondition from '../utils/parseMathCondition.js';
import areCharStatusConditionsMet from '../utils/areStatusConditionsMet.js';
import { keyPress } from '../keyboardControll/keyPress.js';
import findBoundingRect from '../screenMonitor/screenGrabUtils/findBoundingRect.js';
import getViewport from '../screenMonitor/screenGrabUtils/getViewport.js';
import { antiIdle } from '../keyboardControll/antiIdle.js';
import cropImageData from '../screenMonitor/utils/cropImageData.js';
import findAllOccurrences from '../screenMonitor/screenGrabUtils/findAllOccurences.js';

let state = null;
let global = null;
let healing = null;
let gameState = null;
let prevState;
let lastCooldownStates = {};
let lastDispatchedHealthPercentage;
let lastDispatchedManaPercentage;
let lastDispatchedCharacterStatuses = {};
let lastHealthPercentage;
let lastManaPercentage;
let wholeWindowData;
let hpManaImageData;
let cooldownBarImageData;
let statusBarImageData;
let battleListImageData;
let cooldownBarRegions;
let statusBarRegions;
// variables to keep track of rule execution times
let lastRuleExecitionTimes = {};
let lastCategoriesExecitionTimes = {};
let lastMonsterNumber;
let iterationCounter = 0;
let totalExecutionTime = 0;

let options = {
  globalDelay: 1,
  categoryDelays: {
    Healing: 250,
    Potion: 250,
    Support: 250,
    Attack: 1000,
    Equip: 100,
    Others: 25,
  },
  cooldownStateMapping: {
    Healing: 'healingCdActive',
    Support: 'supportCdActive',
    Attack: 'attackCdActive',
  },
  logsEnabled: false,
};

parentPort.on('message', (state) => {
  if (prevState !== state) {
    ({ gameState, global, healing } = state);
  }
  prevState = state;
});

const waitForWindowId = new Promise((resolve) => {
  const messageHandler = (updatedState) => {
    state = updatedState;
    ({ global: global } = state);
    if (global?.windowId !== null && global?.windowId !== undefined) {
      resolve(global.windowId);
      parentPort.off('message', messageHandler);
    }
  };

  parentPort.on('message', messageHandler);
});

/**
 * Execute a click based on the rule's details.
 * @param {string} key - The key to press.
 * @param {string} category - The category of the rule.
 * @param {number} ruleDelay - The delay specified by the rule.
 * @param {Object} rule - The rule object.
 * @returns {Promise<void>} - A Promise that resolves after the click is executed.
 */
const executeClick = async (key, category, ruleDelay, rule) => {
  const now = Date.now();
  if (options.logsEnabled) {
    console.log(
      `Executing click for key: ${key}, category: ${category}, delay: ${ruleDelay}, current time: ${now}`,
    );
  }
  await keyPress(global.windowId, key);
  lastRuleExecitionTimes[rule.id] = now;
  lastCategoriesExecitionTimes[rule.category] = now;
};

/**
 * Filter rules by enabled status.
 * @param {Object[]} rules - The list of rules.
 * @returns {Object[]} - The filtered list of enabled rules.
 */
const filterEnabledRules = (rules) => rules.filter((rule) => rule.enabled);

/**
 * Filter rules by delay.
 * @param {Object[]} rules - The list of rules.
 * @param {number} now - The current time.
 * @returns {Object[]} - The filtered list of rules not on delay.
 */
const filterRulesNotOnDelay = (rules, now) =>
  rules.filter(
    (rule) =>
      now - (lastRuleExecitionTimes[rule.id] || 0) >= (rule.delay || 0) &&
      now -
        Math.max(
          ...rules
            .filter((r) => r.category === rule.category)
            .map((r) => lastRuleExecitionTimes[r.id] || 0),
        ) >=
        options.categoryDelays[rule.category],
  );

/**
 * Filter rules by active cooldowns.
 * @param {Object[]} rules - The list of rules.
 * @param {Object} gameState - The game state object.
 * @returns {Object[]} - The filtered list of rules not affected by active cooldowns.
 */
const filterRulesByActiveCooldowns = (rules, gameState) =>
  rules.filter((rule) => {
    const cooldownStateKey = options.cooldownStateMapping[rule.category];
    if (!cooldownStateKey) {
      return true;
    }
    return !gameState[cooldownStateKey];
  });

/**
 * Filter rules by conditions.
 * @param {Object[]} rules - The list of rules.
 * @param {Object} gameState - The game state object.
 * @returns {Object[]} - The filtered list of rules that meet the conditions.
 */
const filterRulesByConditions = (rules, gameState) =>
  rules.filter(
    (rule) =>
      parseMathCondition(
        rule.hpTriggerCondition,
        parseInt(rule.hpTriggerPercentage, 10),
        gameState.hpPercentage,
      ) &&
      parseMathCondition(
        rule.manaTriggerCondition,
        parseInt(rule.manaTriggerPercentage, 10),
        gameState.manaPercentage,
      ) &&
      areCharStatusConditionsMet(rule, gameState) &&
      parseMathCondition(
        rule.monsterNumCondition,
        parseInt(rule.monsterNum, 10),
        gameState.monsterNum,
      ) &&
      (rule.id !== 'manaSync' || gameState.attackCdActive), // Special case for "manaSync" rule
  );

/**
 * Get the highest priority rule from a list of rules.
 * @param {Object[]} rules - The list of rules.
 * @returns {Object|null} - The highest priority rule or null if no rules are provided.
 */
const getHighestPriorityRule = (rules) =>
  rules.length > 0 ? rules.reduce((a, b) => (a.priority > b.priority ? a : b)) : null;

/**
 * Process all rules.
 * @param {Object[]} rules - The list of rules.
 * @param {Object} gameState - The game state object.
 * @param {Object} global - The global object.
 * @returns {Promise<void>} - A Promise that resolves after all rules are processed.
 */
const processRules = async (rules, gameState, global) => {
  const now = Date.now();
  const enabledRules = filterEnabledRules(rules);
  const rulesWithoutActiveCooldowns = filterRulesByActiveCooldowns(enabledRules, gameState);
  const rulesNotOnDelay = filterRulesNotOnDelay(rulesWithoutActiveCooldowns, now);
  const rulesWithConditionsMet = filterRulesByConditions(rulesNotOnDelay, gameState);
  const highestPriorityRule = getHighestPriorityRule(rulesWithConditionsMet);

  if (highestPriorityRule) {
    await executeClick(
      highestPriorityRule.key,
      highestPriorityRule.category,
      highestPriorityRule.delay,
      highestPriorityRule,
    );
  }
};

async function main() {
  if (global.windowId) {
    const { width } = await getViewport(global.windowId);

    const imageData = await grabScreen(global.windowId);

    const startRegions = findSequences(imageData, regionColorSequences, width);
    const { healthBar, manaBar, cooldownBar, statusBar, battleListStart } = startRegions;

    let battleListRegion = {
      x: battleListStart.x,
      y: battleListStart.y,
      width: 4,
      height: 215,
    };

    let hpManaRegion = {
      x: healthBar.x,
      y: healthBar.y,
      width: 94,
      height: 14,
    };

    let cooldownsRegion = {
      x: cooldownBar.x,
      y: cooldownBar.y,
      width: 1000,
      height: 1,
    };

    let statusBarRegion = {
      x: statusBar.x,
      y: statusBar.y,
      width: 104,
      height: 9,
    };

    async function loop() {
      [hpManaImageData, cooldownBarImageData, statusBarImageData, battleListImageData] =
        await Promise.all([
          grabScreen(global.windowId, hpManaRegion),
          grabScreen(global.windowId, cooldownsRegion),
          grabScreen(global.windowId, statusBarRegion),
          grabScreen(global.windowId, battleListRegion),
        ]);

      const { percentage: newHealthPercentage } = await calculatePercentages(
        healthBar,
        hpManaRegion,
        hpManaImageData,
        [
          [120, 61, 64],
          [211, 79, 79],
          [219, 79, 79],
          [194, 74, 74],
          [100, 46, 49],
        ],
        hpManaRegion.width,
      );

      if (newHealthPercentage !== lastDispatchedHealthPercentage) {
        parentPort.postMessage({
          type: 'setHealthPercent',
          payload: { hpPercentage: newHealthPercentage },
        });
        lastDispatchedHealthPercentage = newHealthPercentage;
      }
      lastHealthPercentage = newHealthPercentage;

      const { percentage: newManaPercentage } = await calculatePercentages(
        manaBar,
        hpManaRegion,
        hpManaImageData,
        [
          [83, 80, 218],
          [77, 74, 194],
          [45, 45, 105],
          [61, 61, 125],
          [82, 79, 211],
        ],
        hpManaRegion.width,
      );

      if (newManaPercentage !== lastDispatchedManaPercentage) {
        parentPort.postMessage({
          type: 'setManaPercent',
          payload: { manaPercentage: newManaPercentage },
        });
        lastDispatchedManaPercentage = newManaPercentage;
      }
      lastManaPercentage = newManaPercentage;

      cooldownBarRegions = findSequences(cooldownBarImageData, cooldownColorSequences, 1000);

      for (const [key, value] of Object.entries(cooldownBarRegions)) {
        const isCooldownActive = value.x !== undefined;

        if (isCooldownActive !== lastCooldownStates[key]) {
          let type;
          let payload;
          if (key === 'healing') {
            type = 'setHealingCdActive';
            payload = { HealingCdActive: isCooldownActive };
          } else if (key === 'support') {
            type = 'setSupportCdActive';
            payload = { supportCdActive: isCooldownActive };
          } else if (key === 'attack') {
            type = 'setAttackCdActive';
            payload = { attackCdActive: isCooldownActive };
          }
          parentPort.postMessage({ type, payload });
          lastCooldownStates[key] = isCooldownActive;
        }
      }

      statusBarRegions = findSequences(statusBarImageData, statusBarSequences, 106);

      const characterStatusUpdates = Object.keys(lastDispatchedCharacterStatuses).reduce(
        (acc, key) => {
          acc[key] = false;
          return acc;
        },
        {},
      );

      for (const [key, value] of Object.entries(statusBarRegions)) {
        if (value.x !== undefined) {
          characterStatusUpdates[key] = true;
        }
      }

      const hasStatusChanged = Object.keys(characterStatusUpdates).some(
        (key) => lastDispatchedCharacterStatuses[key] !== characterStatusUpdates[key],
      );

      if (hasStatusChanged) {
        parentPort.postMessage({
          type: 'setCharacterStatus',
          payload: { characterStatus: characterStatusUpdates },
        });

        lastDispatchedCharacterStatuses = { ...characterStatusUpdates };
      }
      let monsterNumber = findAllOccurrences(
        battleListImageData,
        battleListSequences.battleEntry,
        4,
      );
      if (lastMonsterNumber !== monsterNumber) {
        lastMonsterNumber = monsterNumber;
        parentPort.postMessage({
          type: 'setMonsterNum',
          payload: { monsterNum: monsterNumber },
        });
      }
      if (global.botEnabled) {
        await processRules(healing, gameState, global);
      }

      hpManaImageData = null;
      cooldownBarImageData = null;
      statusBarImageData = null;
      setTimeout(loop, Math.max(global.refreshRate, 25));
    }

    loop();
  }
}

waitForWindowId.then(() => {
  main();
});
