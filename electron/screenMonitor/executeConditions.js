import robotjs from 'robotjs';
import { execSync } from 'child_process';

let currentHP = null;
let currentMP = null;
let isBarVisible = true;
let lastExecTime = Date.now();
let isHealingCooldown = true;

const clickCooldown = 250;
const ruleCheckCooldown = 1;

function evaluateCondition(condition, triggerPercentage, actualPercentage) {
  if (isBarVisible) {
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
}

process.on('message', (message) => {
  if (message.type === 'start') {
    const { rule, windowId } = message;

    setInterval(() => {
      const hpCondition = evaluateCondition(
        rule.hpTriggerCondition,
        rule.hpTriggerPercentage,
        currentHP,
      );
      const manaCondition = evaluateCondition(
        rule.manaTriggerCondition,
        rule.manaTriggerPercentage,
        currentMP,
      );

      const colorConditionsMet = rule.colors.every((color) => {
        const pixelColor = `#${robotjs.getPixelColor(color.x, color.y)}`;
        return color.enabled ? pixelColor === color.color : pixelColor !== color.color;
      });

      if (
        colorConditionsMet &&
        hpCondition &&
        manaCondition &&
        currentHP != null &&
        currentMP != null
      ) {
        const now = Date.now();
        if (now - lastExecTime >= clickCooldown && !isHealingCooldown) {
          execSync(`xdotool key --window ${windowId} ${rule.key}`);
          lastExecTime = now;
          setTimeout(() => {}, clickCooldown);
        }
      }
    }, ruleCheckCooldown);
  } else if (message.payload.hpPercentage) {
    currentHP = message.payload.hpPercentage;
  } else if (message.payload.manaPercentage) {
    currentMP = message.payload.manaPercentage;
  } else if (message.payload && message.payload.isBarVisible !== undefined) {
    isBarVisible = message.payload.isBarVisible;
  } else if (message.payload && message.payload.isHealingCooldown !== undefined) {
    isHealingCooldown = message.payload.isHealingCooldown;
  } else {
    console.log('unhandled dispatch', message);
  }
});
