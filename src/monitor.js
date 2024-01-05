import robotjs from 'robotjs';
import { exec } from 'child_process';

let currentHP = null;
let currentMP = null;

function evaluateCondition(condition, triggerPercentage, actualPercentage) {
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
}

console.log('a monitor process is working');
let lastExecTime = 0;
process.on('message', (message) => {
  if (message.type === 'start') {
    const { rule, windowId } = message;
    setInterval(() => {
      const colorConditionsMet = rule.colors.every((color) => {
        const pixelColor = `#${robotjs.getPixelColor(color.x, color.y)}`;
        return color.enabled ? pixelColor === color.color : pixelColor !== color.color;
      });
      console.log(currentHP, currentMP, '________________________');

      const hpConditionMet = evaluateCondition(
        rule.hpTriggerCondition,
        rule.hpTriggerPercentage,
        currentHP,
      );

      const manaConditionMet = evaluateCondition(
        rule.manaTriggerCondition,
        rule.manaTriggerPercentage,
        currentMP,
      );

      if (colorConditionsMet && manaConditionMet && hpConditionMet) {
        const currentTime = Date.now();
        if (currentTime - lastExecTime >= 500) {
          exec(`xdotool key --window ${windowId} ${rule.key}`);
          console.log('clicked hotkey', currentTime - lastExecTime >= 500);
          lastExecTime = Date.now();
        }
      }
    }, rule.interval);
  } else {
    currentHP = message.payload.hpPercentage;
    currentMP = message.payload.manaPercentage;
  }
});
