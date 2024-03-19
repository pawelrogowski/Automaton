import { exec } from 'child_process';
import { parentPort } from 'worker_threads';
import { keyPress } from '../keyboardControll/keyPress.js';

let currentState = null;
let prevState = null;
let gameState = null;
let global = null;
let healing = null;

const lastExecutionTimes = {};

const parseMathCondition = (condition, triggerPercentage, actualPercentage) => {
  if (gameState && gameState.hpPercentage > 0) {
    switch (condition) {
      case '<':
        return actualPercentage < triggerPercentage;
      case '<=':
        return actualPercentage <= triggerPercentage;
      case '=':
        return actualPercentage === triggerPercentage;
      case '>':
        return actualPercentage > triggerPercentage;
      case '>=':
        return actualPercentage >= triggerPercentage;
      case '!=':
        return actualPercentage !== triggerPercentage;
      default:
        return false;
    }
  } else {
    return false;
  }
};

const areCharStatusConditionsMet = (rule, gameState) => {
  return rule.conditions.every((condition) => {
    const charStatusValue = gameState.characterStatus[condition.name];
    if (charStatusValue === undefined || charStatusValue === null) {
      return true;
    }
    return charStatusValue === condition.value;
  });
};

const processRule = async (rule, gameState, global) => {
  if (!global || !global.botEnabled) return;

  const hpConditionMet = parseMathCondition(
    rule.hpTriggerCondition,
    parseInt(rule.hpTriggerPercentage, 10),
    gameState.hpPercentage,
  );
  const manaConditionMet = parseMathCondition(
    rule.manaTriggerCondition,
    parseInt(rule.manaTriggerPercentage, 10),
    gameState.manaPercentage,
  );

  if (hpConditionMet && manaConditionMet && areCharStatusConditionsMet(rule, gameState)) {
    const now = Date.now();
    const lastExecutionTime = lastExecutionTimes[rule.id] || 0;
    const delay = rule.delay || 0;

    if (now - lastExecutionTime >= delay) {
      if (rule.name === 'manaSync' && gameState.attackCdActive) {
        await keyPress(global.windowId, rule.key);
      } else if (rule.name !== 'manaSync') {
        await keyPress(global.windowId, rule.key);
      }
      lastExecutionTimes[rule.id] = now;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
};

const processCategory = async (category, rules, gameState, global) => {
  if (!global || !global.botEnabled) return;

  if (
    (category === 'Healing' && gameState.healingCdActive) ||
    (category === 'Support' && gameState.supportCdActive) ||
    (category === 'Attack' && gameState.attackCdActive)
  ) {
    return;
  }

  let filteredRules = rules.filter((rule) => rule.enabled && rule.category === category);

  // Special handling for the 'manaSync' rule
  if (category === 'Potion') {
    const manaSyncRule = filteredRules.find((rule) => rule.id === 'manaSync');
    if (manaSyncRule && gameState.attackCdActive) {
      await processRule(manaSyncRule, gameState, global);
      // Exclude the manaSync rule from the filteredRules to avoid processing it again
      filteredRules = filteredRules.filter((rule) => rule.id !== 'manaSync');
    }
  }

  filteredRules.sort((a, b) => b.priority - a.priority);

  for (const rule of filteredRules) {
    await processRule(rule, gameState, global);
  }
};

async function checkHealingRules() {
  if (!global || !global.botEnabled) return;

  const categories = Array.from(new Set(healing.map((rule) => rule.category)));
  await Promise.all(
    categories.map((category) => processCategory(category, healing, gameState, global)),
  );
}

function checkHealingRulesLoop() {
  if (global && global.botEnabled) {
    checkHealingRules();
  }
  setTimeout(checkHealingRulesLoop, 50);
}

// Function to wait for global.botEnabled to be true
async function waitForBotEnabled() {
  while (!global || !global.botEnabled) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  checkHealingRulesLoop();
}

// Start the loop after global.botEnabled becomes true
waitForBotEnabled();

parentPort.on('message', (state) => {
  if (prevState !== state) {
    ({ gameState, global, healing } = state);
  }
  prevState = state;
});
