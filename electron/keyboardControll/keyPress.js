import { workerData } from 'worker_threads';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const keypress = require(workerData.keypressPath);

export const keyPress = (windowId, key, rule = null) => {
  const startTime = Date.now(); // Record the start time
  keypress.sendKey(parseInt(windowId), key[0]);
  if (rule) {
    try {
      // Format the conditions to make them more readable
      const readableConditions =
        rule.conditions.length > 0 ? rule.conditions.map((condition) => `${condition.name}: ${condition.value}`).join(', ') : 'None'; // Concatenate each condition in a readable format

      const executionTime = Date.now() - startTime; // Calculate the elapsed time

      // Log the details with execution time
      // console.table({
      //   name: rule.name,
      //   category: rule.category,
      //   key: rule.key,
      //   hpTrigger: `${rule.hpTriggerCondition} ${rule.hpTriggerPercentage}%`,
      //   manaTrigger: `${rule.manaTriggerCondition} ${rule.manaTriggerPercentage}%`,
      //   priority: rule.priority,
      //   conditions: readableConditions, // Use the formatted conditions
      //   executionTime: `${executionTime} ms`, // Show the execution time in milliseconds
      // });
    } catch (error) {
      const readableConditions =
        rule.conditions.length > 0 ? rule.conditions.map((condition) => `${condition.name}: ${condition.value}`).join(', ') : 'None'; // Concatenate each condition in a readable format

      const executionTime = Date.now() - startTime; // Calculate the elapsed time

      // Log the details with execution time
      console.table({
        name: rule.name,
        category: rule.category,
        key: rule.key,
        hpTrigger: `${rule.hpTriggerCondition} ${rule.hpTriggerPercentage}%`,
        manaTrigger: `${rule.manaTriggerCondition} ${rule.manaTriggerPercentage}%`,
        priority: rule.priority,
        conditions: readableConditions,
        error: error,
      });
    }
  }
};

export const keyPressManaSync = async (windowId, key, pressNumber = 1) => {
  keypress.sendKey(parseInt(windowId), key);

  // Handle remaining presses with delays
  for (let i = 1; i < pressNumber; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await keypress.sendKey(parseInt(windowId), key);
  }
};
