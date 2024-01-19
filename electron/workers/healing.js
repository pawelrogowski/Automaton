import { exec } from 'child_process';
import { parentPort } from 'worker_threads';

let currentState = null;
let prevState = null;
let global = null;
let gameState = null;
let healing = null;

parentPort.on('message', (state) => {
  if (prevState !== state) {
    ({ gameState, global, healing } = state);
  }
});

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

let lastExecutionTimes = {};

function checkHealingRules() {
  const categories = Array.from(new Set(healing.map((rule) => rule.category)));
  categories.forEach((category) => {
    let highestPriorityRule = null;
    healing.forEach((rule) => {
      if (rule.enabled && rule.category === category) {
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
        const cooldownNotActive =
          (category === 'healing' && !gameState.healingCdActive) ||
          (category === 'support' && !gameState.supportCdActive);

        if (hpConditionMet && manaConditionMet && cooldownNotActive) {
          if (!highestPriorityRule || rule.priority > highestPriorityRule.priority) {
            highestPriorityRule = rule;
          }
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
  });
}

setInterval(() => {
  if (global.healingEnabled) {
    checkHealingRules();
  }
}, 10);
