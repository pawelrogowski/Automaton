import { exec } from 'child_process';
import { parentPort } from 'worker_threads';
import { keyPress } from '../keyboardControll/keyPress.js';
import parseMathCondition from '../utils/parseMathCondition.js';
import areCharStatusConditionsMet from '../utils/areStatusConditionsMet.js';

// State variables to track game and bot states
let currentState = null;
let prevState = null;
let gameState = null;
let global = null;
let healing = null;
let isLoopRunning = false;

// Track the last execution time for each rule
const lastRuleExecitionTimes = {};
// Track the last execution time for each category
const lastCategoriesExecitionTimes = {};

// Define options for delays and logging
const options = {
  globalDelay: 1,
  categoryDelays: {
    Healing: 1000,
    Potion: 1000,
    Support: 500,
    Attack: 1000,
    Equip: 500,
  },
  logsEnabled: false,
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
  if (options.logsEnabled) {
    console.log(
      `Executing click for key: ${key}, category: ${category}, delay: ${ruleDelay}, current time: ${now}`,
    );
  }
  await keyPress(global.windowId, key);
  lastRuleExecitionTimes[rule.id] = now; // Update the last execution time of this individual rule
  lastCategoriesExecitionTimes[rule.category] = now; // Update the last execution time of this category
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
  rules.filter(
    (rule) =>
      !(
        (rule.category === 'Healing' && gameState.healingCdActive) ||
        (rule.category === 'Support' && gameState.supportCdActive) ||
        (rule.category === 'Attack' && gameState.attackCdActive)
      ),
  );

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
  // Check if the bot is enabled
  if (!global || !global.botEnabled) return;

  // Get the current time
  const now = Date.now();

  // Filter rules by enabled status, delay, and conditions
  const enabledRules = filterEnabledRules(rules);
  const rulesWithoutActiveCooldowns = filterRulesByActiveCooldowns(enabledRules, gameState);
  const rulesNotOnDelay = filterRulesNotOnDelay(rulesWithoutActiveCooldowns, now);
  const rulesWithConditionsMet = filterRulesByConditions(rulesNotOnDelay, gameState);

  // Get the highest priority rule
  const highestPriorityRule = getHighestPriorityRule(rulesWithConditionsMet);

  // Execute the highest priority rule if it exists
  if (highestPriorityRule) {
    await executeClick(
      highestPriorityRule.key,
      highestPriorityRule.category,
      highestPriorityRule.delay,
      highestPriorityRule,
    );
  }
};

/**
 * Continuously process rules in a loop.
 */
function processRulesLoop() {
  // Check if the bot is enabled and the loop is not already running
  if (global && global.botEnabled && !isLoopRunning) {
    isLoopRunning = true;
    if (options.logsEnabled) {
      console.log('new loop iteration', 'current time:', Date.now());
    }

    const localHealing = healing;
    const localGameState = gameState;
    const localGlobal = global;

    // Call processRules and ensure it's awaited to complete before resetting the flag
    processRules(localHealing, localGameState, localGlobal)
      .then(() => {
        isLoopRunning = false; // Reset the flag when the loop iteration is complete
        // Schedule the next iteration of the loop
        setTimeout(processRulesLoop, options.globalDelay);
      })
      .catch((error) => {
        console.error('Error processing rules:', error);
        isLoopRunning = false; // Ensure the flag is reset even if an error occurs
        setTimeout(processRulesLoop, options.globalDelay);
      });
  } else {
    // If the loop is already running or the bot is not enabled, schedule the next iteration
    setTimeout(processRulesLoop, options.globalDelay);
  }
}

/**
 * Wait for the bot to be enabled before starting the loop.
 */
async function waitForBotEnabled() {
  while (!global || !global.botEnabled) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  processRulesLoop();
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
