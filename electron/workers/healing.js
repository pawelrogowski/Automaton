import { exec } from 'child_process';
import { parentPort } from 'worker_threads';
import { keyPress } from '../keyboardControll/keyPress.js';

// State variables to track game and bot states
let currentState = null;
let prevState = null;
let gameState = null;
let global = null;
let healing = null;

// Track the last execution time for each rule
const lastExecutionTimes = {};

// Define options for delays and logging
const options = {
  globalDelay: 50, // Global delay in ms
  categoryDelays: {
    Healing: 1000, // Delay for Healing category in ms
    Potion: 1000,
    Support: 500, // Delay for Support category in ms
    Attack: 1000, // Delay for Attack category in ms
    Equip: 500,
    // Add more categories as needed
  },
  logsEnabled: false, // Disable logs by default
};

/**
 * Parse mathematical conditions for HP and mana triggers.
 * @param {string} condition - The mathematical condition to check.
 * @param {number} triggerPercentage - The trigger percentage value.
 * @param {number} actualPercentage - The actual percentage value to check against.
 * @returns {boolean} - True if the condition is met, false otherwise.
 */
const parseMathCondition = (condition, triggerPercentage, actualPercentage) => {
  // Check if gameState is valid and then evaluate the condition
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

/**
 * Check if character status conditions are met.
 * @param {Object} rule - The rule object.
 * @param {Object} gameState - The game state object.
 * @returns {boolean} - True if all conditions are met, false otherwise.
 */
const areCharStatusConditionsMet = (rule, gameState) => {
  // Check each condition in the rule's conditions array
  return rule.conditions.every((condition) => {
    const charStatusValue = gameState.characterStatus[condition.name];
    // If the condition's value is undefined or null, consider it met
    if (charStatusValue === undefined || charStatusValue === null) {
      return true;
    }
    return charStatusValue === condition.value;
  });
};

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
  // Calculate the delay based on the highest of global, category, and rule-specific delays
  const delay = Math.max(options.globalDelay, options.categoryDelays[category] || 0, ruleDelay);

  // Log the execution and perform the click
  if (options.logsEnabled) {
    console.log(
      `Executing click for key: ${key}, category: ${category}, delay: ${ruleDelay}, current time: ${now}`,
    );
  }
  await keyPress(global.windowId, key);
  lastExecutionTimes[rule.id] = now; // Update the last execution time
};

/**
 * Process a single rule.
 * @param {Object} rule - The rule object.
 * @param {Object} gameState - The game state object.
 * @param {Object} global - The global object.
 * @returns {Promise<void>} - A Promise that resolves after the rule is processed.
 */
const processRule = async (rule, gameState, global) => {
  // Check if the bot is enabled and if the rule's conditions are met
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

    // Check if the rule's delay has passed since the last execution
    if (now - lastExecutionTime >= delay) {
      if (options.logsEnabled) {
        console.log(`Processing rule: ${rule.name}, delay: ${delay}, current time: ${now}`);
      }
      await executeClick(rule.key, rule.category, delay, rule);
    } else {
      if (options.logsEnabled) {
        console.log(
          `Skipping rule: ${rule.name}, last execution time: ${lastExecutionTime}, current time: ${now}`,
        );
      }
    }
  }
};

/**
 * Process all rules within a category.
 * @param {string} category - The category to process.
 * @param {Object[]} rules - The list of rules.
 * @param {Object} gameState - The game state object.
 * @param {Object} global - The global object.
 * @returns {Promise<void>} - A Promise that resolves after all rules in the category are processed.
 */
const processCategory = async (category, rules, gameState, global) => {
  // Check if the bot is enabled
  if (!global || !global.botEnabled) return;

  // Get the current time
  const now = Date.now();

  // Filter rules by category, enabled status, and no active delays
  let filteredRules = rules.filter(
    (rule) =>
      rule.enabled &&
      rule.category === category &&
      // Check if the rule's delay has passed since the last execution
      now - (lastExecutionTimes[rule.id] || 0) >= (rule.delay || 0) &&
      // Check if the category-specific delay has passed since the last execution of any rule in the category
      now -
        Math.max(
          ...rules.filter((r) => r.category === category).map((r) => lastExecutionTimes[r.id] || 0),
        ) >=
        options.categoryDelays[category],
  );

  // Special handling for the 'manaSync' rule in the 'Potion' category
  if (category === 'Potion') {
    // Include the 'manaSync' rule only if the attack cooldown is active
    if (!gameState.attackCdActive) {
      filteredRules = filteredRules.filter((rule) => rule.id !== 'manaSync');
    }
  }

  // Process each rule in the filtered list
  for (const rule of filteredRules) {
    await processRule(rule, gameState, global);
  }
};

/**
 * Check healing rules and process them.
 * @returns {Promise<void>} - A Promise that resolves after all healing rules are processed.
 */
async function checkHealingRules() {
  if (!global || !global.botEnabled) return;

  // Get unique categories from the healing rules
  const categories = Array.from(new Set(healing.map((rule) => rule.category)));

  // Process each category
  await Promise.all(
    categories.map((category) => processCategory(category, healing, gameState, global)),
  );
}

/**
 * Continuously check healing rules in a loop.
 */
function checkHealingRulesLoop() {
  if (global && global.botEnabled) {
    if (options.logsEnabled) {
      console.log('new loop iteration', 'current time:', Date.now());
    }
    checkHealingRules();
  }
  setTimeout(checkHealingRulesLoop, options.globalDelay);
}

/**
 * Wait for the bot to be enabled before starting the loop.
 */
async function waitForBotEnabled() {
  while (!global || !global.botEnabled) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  checkHealingRulesLoop();
}

// Start the loop after global.botEnabled becomes true
waitForBotEnabled();

// Listen for messages from the parent thread to update the game state
parentPort.on('message', (state) => {
  if (prevState !== state) {
    ({ gameState, global, healing } = state);
  }
  prevState = state;
});
