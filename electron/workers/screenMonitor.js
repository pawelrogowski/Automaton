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
import getViewport from '../screenMonitor/screenGrabUtils/getViewport.js';
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
let lastRuleExecitionTimes = {};
let lastCategoriesExecitionTimes = {};
let lastMonsterNumber;
let lastPartyNumber;
let iterationCounter = 0;
let totalExecutionTime = 0;
let directGameState;
let lastDirectGameState;
let manaSyncTimeoutId = null;
let lastManaSyncScheduleTime = 0;
let options = {
  globalDelay: 0,
  categoryDelays: {
    Healing: 200,
    Potion: 1000,
    Support: 500,
    Attack: 1000,
    Equip: 250,
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

const filterEnabledRules = (rules) => rules.filter((rule) => rule.enabled);

const filterRulesNotOnDelay = (rules) =>
  rules.filter(
    (rule) =>
      Date.now() - (lastRuleExecitionTimes[rule.id] || 0) >= (rule.delay || 0) &&
      Date.now() -
        Math.max(
          ...rules
            .filter((r) => r.category === rule.category)
            .map((r) => lastRuleExecitionTimes[r.id] || 0),
        ) >=
        options.categoryDelays[rule.category],
  );

const filterRulesByActiveCooldowns = (rules, directGameState) =>
  rules.filter((rule) => {
    const cooldownStateKey = options.cooldownStateMapping[rule.category];
    if (!cooldownStateKey) {
      return true;
    }
    return !directGameState[cooldownStateKey];
  });

const filterRulesByConditions = (rules, directGameState) =>
  rules.filter(
    (rule) =>
      parseMathCondition(
        rule.hpTriggerCondition,
        parseInt(rule.hpTriggerPercentage, 10),
        directGameState.hpPercentage,
      ) &&
      parseMathCondition(
        rule.manaTriggerCondition,
        parseInt(rule.manaTriggerPercentage, 10),
        directGameState.manaPercentage,
      ) &&
      areCharStatusConditionsMet(rule, directGameState) &&
      parseMathCondition(
        rule.monsterNumCondition,
        parseInt(rule.monsterNum, 10),
        directGameState.monsterNum,
      ) &&
      (rule.id !== 'manaSync' || directGameState.attackCdActive),
  );

const getAllValidRules = (rules, directGameState) => {
  const enabledRules = filterEnabledRules(rules);
  const rulesWithoutActiveCooldowns = filterRulesByActiveCooldowns(enabledRules, directGameState);
  const rulesNotOnDelay = filterRulesNotOnDelay(rulesWithoutActiveCooldowns);
  const rulesWithConditionsMet = filterRulesByConditions(rulesNotOnDelay, directGameState);
  return rulesWithConditionsMet.sort((a, b) => b.priority - a.priority);
};
const getHighestPriorityRulesByCategory = (rules) => {
  const categoryMap = new Map();
  for (const rule of rules) {
    if (
      !categoryMap.has(rule.category) ||
      rule.priority > categoryMap.get(rule.category).priority
    ) {
      categoryMap.set(rule.category, rule);
    }
  }
  return Array.from(categoryMap.values());
};
const getHighestPriorityRule = (rules) =>
  rules.length > 0 ? rules.reduce((a, b) => (a.priority > b.priority ? a : b)) : null;

const processRules = async (rules, directGameState, global) => {
  const validRules = getAllValidRules(rules, directGameState);
  const highestPriorityRules = getHighestPriorityRulesByCategory(validRules);

  if (highestPriorityRules.length > 0) {
    // Separate manaSyncRule from other rules
    const manaSyncRule = highestPriorityRules.find((rule) => rule.id === 'manaSync');
    const otherRules = highestPriorityRules.filter((rule) => rule.id !== 'manaSync');

    // Execute other rules immediately
    if (otherRules.length > 0) {
      const otherKeys = otherRules.map((rule) => rule.key);
      await keyPress(global.windowId, otherKeys);

      // Update execution times for other rules
      const now = Date.now();
      otherRules.forEach((rule) => {
        lastRuleExecitionTimes[rule.id] = now;
        lastCategoriesExecitionTimes[rule.category] = now;
      });

      if (options.logsEnabled) {
        console.log(
          `Executing chained command for keys: ${otherKeys.join(', ')}, current time: ${now}`,
        );
      }
    }

    // Handle manaSync rule
    if (manaSyncRule) {
      const now = Date.now();
      const timeSinceLastSchedule = now - lastManaSyncScheduleTime;

      if (timeSinceLastSchedule >= 1100 && !manaSyncTimeoutId) {
        manaSyncTimeoutId = setTimeout(async () => {
          await keyPress(global.windowId, [manaSyncRule.key]);

          const executionTime = Date.now();
          lastRuleExecitionTimes[manaSyncRule.id] = executionTime;
          lastCategoriesExecitionTimes[manaSyncRule.category] = executionTime;

          if (options.logsEnabled) {
            console.log(
              `Executing delayed manaSync command for key: ${manaSyncRule.key}, current time: ${executionTime}`,
            );
          }

          manaSyncTimeoutId = null;
          lastManaSyncScheduleTime = executionTime;
        }, 910);

        lastManaSyncScheduleTime = now;

        if (options.logsEnabled) {
          console.log(`Scheduled manaSync execution at ${now}`);
        }
      }
    }
  }
};

async function main() {
  if (global.windowId) {
    const { width } = await getViewport(global.windowId);

    const imageData = await grabScreen(global.windowId);

    const startRegions = findSequences(imageData, regionColorSequences, width);
    const { healthBar, manaBar, cooldownBar, statusBar, battleListStart, partyListStart } =
      startRegions;

    let battleListRegion = {
      x: battleListStart.x,
      y: battleListStart.y,
      width: 4,
      height: 215,
    };

    let partyListRegion = {
      x: partyListStart.x,
      y: partyListStart.y,
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

      cooldownBarRegions = findSequences(cooldownBarImageData, cooldownColorSequences, 1000);

      statusBarRegions = findSequences(statusBarImageData, statusBarSequences, 106);

      const characterStatusUpdates = {};
      for (const [key, value] of Object.entries(statusBarSequences)) {
        characterStatusUpdates[key] = statusBarRegions[key]?.x !== undefined;
      }

      let monsterNumber = findAllOccurrences(
        battleListImageData,
        battleListSequences.battleEntry,
        4,
      );

      directGameState = {
        hpPercentage: newHealthPercentage,
        manaPercentage: newManaPercentage,
        healingCdActive: cooldownBarRegions.healing?.x !== undefined,
        supportCdActive: cooldownBarRegions.support?.x !== undefined,
        attackCdActive: cooldownBarRegions.attack?.x !== undefined,
        characterStatus: characterStatusUpdates,
        monsterNum: monsterNumber,
      };

      if (global.botEnabled) {
        await processRules(healing, directGameState, global);
      }
      if (newHealthPercentage !== lastDispatchedHealthPercentage) {
        parentPort.postMessage({
          type: 'setHealthPercent',
          payload: { hpPercentage: newHealthPercentage },
        });
        lastDispatchedHealthPercentage = newHealthPercentage;
      }
      if (newManaPercentage !== lastDispatchedManaPercentage) {
        parentPort.postMessage({
          type: 'setManaPercent',
          payload: { manaPercentage: newManaPercentage },
        });
        lastDispatchedManaPercentage = newManaPercentage;
      }

      hpManaImageData = null;
      cooldownBarImageData = null;
      statusBarImageData = null;
      const additionalRandomDelay = Math.floor(Math.random() * (30 - 10 + 1)) + 10;
      setTimeout(loop, global.refreshRate);
    }

    loop();
  }
}

waitForWindowId.then(() => {
  main();
});
