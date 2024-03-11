import { exec } from 'child_process';
import { parentPort } from 'worker_threads';
import { keyPress } from '../keyboardControll/keyPress.js';

let currentState = null;
let prevState = null;
let gameState = null;
let global = null;
let healing = null;

// Store the last execution time for each rule
const lastExecutionTimes = {};

// Parse the math condition based on the condition and trigger percentage
const parseMathCondition = (condition, triggerPercentage, actualPercentage) => {
  if (gameState.hpPercentage > 0) {
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

// Function to check if the character status conditions are met
const areCharStatusConditionsMet = (rule, gameState) => {
  return rule.conditions.every((condition) => {
    const charStatusValue = gameState.characterStatus[condition.name];
    // If the key is missing or has a null value, consider it passed
    if (charStatusValue === undefined || charStatusValue === null) {
      return true;
    }
    // Compare the condition value with the actual character status value
    return charStatusValue === condition.value;
  });
};

// Function to process a single rule
// Function to process a single rule
// Function to process a single rule
const processRule = async (rule, gameState, global) => {
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
      // console.log(
      //   `Rule ${rule.id} executed by processing ${rule.category} category, attackCdActive is currently ${gameState.attackCdActive}`,
      // );
      await keyPress(global.windowId, rule.key);
      lastExecutionTimes[rule.id] = now;
      // Wait for 25ms before processing the next rule
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
};

// Function to process a category of rules
const processCategory = async (category, rules, gameState, global) => {
  // console.log(`Processing category: ${category}`);
  if (
    (category === 'Healing' && gameState.healingCdActive) ||
    (category === 'Support' && gameState.supportCdActive) ||
    (category === 'Attack' && gameState.attackCdActive)
  ) {
    // console.log(`Skipping category due to cooldown: ${category}`);
    return; // Skip processing if the category is on cooldown
  }

  let filteredRules = rules.filter((rule) => rule.enabled && rule.category === category);

  // Special handling for the 'manaSync' rule
  if (category === 'Potion') {
    const manaSyncRule = filteredRules.find((rule) => rule.id === 'manaSync');
    if (manaSyncRule && gameState.attackCdActive) {
      // console.log('Processing manaSync rule');
      await processRule(manaSyncRule, gameState, global);
      // Remove the manaSync rule from the filteredRules to avoid processing it again
      filteredRules = filteredRules.filter((rule) => rule.id !== 'manaSync');
    } else {
      // console.log('Skipping manaSync rule due to attackCdActive:', gameState.attackCdActive);
    }
  }

  filteredRules.sort((a, b) => b.priority - a.priority); // Sort rules by priority (descending)

  for (const rule of filteredRules) {
    await processRule(rule, gameState, global);
  }
};

// Main function to check healing rules
async function checkHealingRules() {
  // console.log('Checking healing rules');

  // Special handling for the 'manaSync' rule
  const manaSyncRule = healing.find((rule) => rule.id === 'manaSync');
  if (manaSyncRule && manaSyncRule.enabled && gameState.attackCdActive) {
    // console.log(`Processing manaSync rule`);
    await processRule(manaSyncRule, gameState, global);
  }

  // Process other categories
  const categories = Array.from(new Set(healing.map((rule) => rule.category)));
  for (const category of categories) {
    if (category === 'Potion' && manaSyncRule) {
      // console.log(`Skipping manaSync rule due to attackCdActive: ${gameState.attackCdActive}`);
      continue; // Skip processing the 'manaSync' rule here
    }

    if (
      (category === 'Healing' && gameState.healingCdActive) ||
      (category === 'Support' && gameState.supportCdActive) ||
      (category === 'Attack' && gameState.attackCdActive)
    ) {
      // console.log(`Skipping category due to cooldown: ${category}`);
      continue; // Skip processing if the category is on cooldown
    }

    const filteredRules = healing.filter((rule) => rule.enabled && rule.category === category);
    filteredRules.sort((a, b) => b.priority - a.priority); // Sort rules by priority (descending)

    for (const rule of filteredRules) {
      await processRule(rule, gameState, global);
    }
  }
}

// Set up an interval to check the conditions every 16ms (60 times per second)
setInterval(() => {
  if (global.botEnabled) {
    checkHealingRules();
  }
}, 100);

// Call checkHealingRules immediately when the state changes to force a check
parentPort.on('message', (state) => {
  if (prevState !== state) {
    ({ gameState, global, healing } = state);
    // if (global.botEnabled) {
    //   checkHealingRules(); // Force a check because the state has changed
    // }
  }
  prevState = state; // Update prevState with the current state
});
