import robotjs from 'robotjs';
import { exec } from 'child_process';

let hpPercentage = null;
let manaPercentage = null;
let intervalId;

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
  console.log('Received message:', message);
  const { rule, windowId } = message;
  setInterval(() => {
    // console.log('second log', message);
    const colorConditionsMet = rule.colors.every((color) => {
      const pixelColor = `#${robotjs.getPixelColor(color.x, color.y)}`;
      return color.enabled ? pixelColor === color.color : pixelColor !== color.color;
    });

    console.log('Color conditions met:', colorConditionsMet);

    const hpConditionMet = evaluateCondition(
      rule.hpTriggerCondition,
      rule.hpTriggerPercentage,
      hpPercentage,
    );

    console.log('HP condition met:', hpConditionMet);

    const manaConditionMet = evaluateCondition(
      rule.manaTriggerCondition,
      rule.manaTriggerPercentage,
      manaPercentage,
    );

    console.log('Mana condition met:', manaConditionMet);

    if (colorConditionsMet) {
      exec(`xdotool key --window ${windowId} ${rule.key}`);
    } else {
      console.log('no rule triggered');
    }
  }, rule.interval);
});
