import robotjs from 'robotjs';
import { exec } from 'child_process';

let currentHP = 0;
let currentMP = 0;

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

      if (colorConditionsMet && hpCondition && manaCondition) {
        exec(`xdotool key --window ${windowId} ${rule.key} --repeat 3 --delay 0`);
      }
    }, 25);
  } else {
    if (message.payload.hpPercentage) {
      currentHP = message.payload.hpPercentage;
    } else if (message.payload.manaPercentage) {
      currentMP = message.payload.manaPercentage;
    }
  }
});
