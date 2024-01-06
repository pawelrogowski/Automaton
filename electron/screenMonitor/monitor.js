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

    setInterval(() => {
      console.time('intervalExecution');

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
        const currentTime = Date.now();
        if (currentTime - lastExecTime >= 150) {
          exec(`xdotool key --window ${windowId} ${rule.key}`);
          console.log('clicked hotkey', rule.key);
          lastExecTime = Date.now();
        }
      }

      console.timeEnd('intervalExecution');
    }, rule.interval);
  } else {
    if (message.payload.hpPercentage) {
      currentHP = message.payload.hpPercentage;
    } else if (message.payload.manaPercentage) {
      currentMP = message.payload.manaPercentage;
    }
  }
});
