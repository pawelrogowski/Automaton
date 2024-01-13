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

function checkHealingRules() {
  let highestPriorityRule = null;
  healing.forEach((rule) => {
    if (rule.enabled) {
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

      if (hpConditionMet && manaConditionMet) {
        if (!highestPriorityRule || rule.priority > highestPriorityRule.priority) {
          highestPriorityRule = rule;
        }
      }
    }
  });

  if (highestPriorityRule) {
    exec(`xdotool key --window ${global.windowId} ${highestPriorityRule.key}`);
  }
}

setInterval(() => {
  if (global.healingEnabled) {
    checkHealingRules();
  }
}, 100);
