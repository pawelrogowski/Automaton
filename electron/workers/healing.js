import { exec } from 'child_process';
import { parentPort } from 'worker_threads';

let currentState = null;
let prevState = null;
let global = null;
let gameState = null;
let healing = null;

const lastExecutionTimes = {};

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

async function checkHealingRules() {
  const categories = Array.from(new Set(healing.map((rule) => rule.category)));
  await Promise.all(
    categories.map(async (category) => {
      // Special handling for the 'manaSync' rule
      if (category === 'Potion') {
        const manaSyncRule = healing.find((rule) => rule.id === 'manaSync');
        if (manaSyncRule && manaSyncRule.enabled && gameState.attackCdActive) {
          // Check mana and HP conditions for the 'manaSync' rule
          const hpConditionMet = parseMathCondition(
            manaSyncRule.hpTriggerCondition,
            parseInt(manaSyncRule.hpTriggerPercentage, 10),
            gameState.hpPercentage,
          );
          const manaConditionMet = parseMathCondition(
            manaSyncRule.manaTriggerCondition,
            parseInt(manaSyncRule.manaTriggerPercentage, 10),
            gameState.manaPercentage,
          );

          if (hpConditionMet && manaConditionMet) {
            // Process the 'manaSync' rule here
            const now = Date.now();
            const lastExecutionTime = lastExecutionTimes[manaSyncRule.id] || 0;
            const delay = manaSyncRule.delay || 0;

            if (now - lastExecutionTime >= delay) {
              exec(`xdotool key --window ${global.windowId} ${manaSyncRule.key}`);
              lastExecutionTimes[manaSyncRule.id] = now;
            }
          }
        }
      }
      // Existing logic for other categories
      if (
        (category === 'Healing' && gameState.healingCdActive) ||
        (category === 'Support' && gameState.supportCdActive) ||
        (category === 'Attack' && gameState.attackCdActive)
      ) {
        return;
      }

      let highestPriorityRule = null;
      // Filter rules based on the current game state
      const filteredRules = healing.filter((rule) => {
        if (rule.id !== 'manaSync' && rule.enabled && rule.category === category) {
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
          return hpConditionMet && manaConditionMet;
        }
        return false;
      });

      // Evaluate the rules
      filteredRules.forEach((rule) => {
        const charStatusConditionsMet = rule.conditions.every((condition) => {
          const charStatusValue = gameState.characterStatus[condition.name];
          // If the key is missing or has a null value, consider it passed
          if (charStatusValue === undefined || charStatusValue === null) {
            return true;
          }
          // Compare the condition value with the actual character status value
          return charStatusValue === condition.value;
        });

        if (charStatusConditionsMet) {
          if (!highestPriorityRule || rule.priority > highestPriorityRule.priority) {
            highestPriorityRule = rule;
          }
        }
      });

      if (highestPriorityRule) {
        const now = Date.now();
        const lastExecutionTime = lastExecutionTimes[highestPriorityRule.id] || 0;
        const delay = highestPriorityRule.delay || 0;

        if (now - lastExecutionTime >= delay) {
          exec(`xdotool key --window ${global.windowId} ${highestPriorityRule.key}`);
          lastExecutionTimes[highestPriorityRule.id] = now;
        }
      }
    }),
  );
}

// Set up an interval to check the conditions every 16ms (60 times per second)
setInterval(() => {
  if (global.healingEnabled) {
    checkHealingRules();
  }
}, 16);

// Call checkHealingRules immediately when the state changes to force a check
parentPort.on('message', (state) => {
  if (prevState !== state) {
    ({ gameState, global, healing } = state);
    if (global.healingEnabled) {
      checkHealingRules(); // Force a check because the state has changed
    }
  }
});
