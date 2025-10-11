import parseMathCondition from '../../utils/parseMathCondition.js';
import areCharStatusConditionsMet from '../../utils/areStatusConditionsMet.js';
import { OPTIONS } from './constants.js';

let lastRuleExecutionTimes = {};
let lastCategoriesExecutionTimes = {};

export const filterEnabledRules = (rules) =>
  rules.filter((rule) => rule.enabled);

export const filterRulesNotOnDelay = (rules) =>
  rules.filter(
    (rule) =>
      Date.now() - (lastRuleExecutionTimes[rule.id] || 0) >=
        (rule.delay || 0) &&
      Date.now() -
        Math.max(
          ...rules
            .filter((r) => r.category === rule.category)
            .map((r) => lastRuleExecutionTimes[r.id] || 0),
        ) >=
        OPTIONS.categoryDelays[rule.category],
  );

export const filterRulesByActiveCooldowns = (rules, directGameState) =>
  rules.filter((rule) => {
    const cooldownStateKey = OPTIONS.cooldownStateMapping[rule.category];
    return !cooldownStateKey || !directGameState[cooldownStateKey];
  });

export const filterRulesByConditions = (rules, directGameState) =>
  rules.filter((rule) => {
    return (
      parseMathCondition(
        rule.hpTriggerCondition,
        parseInt(rule.hpTriggerPercentage, 10),
        directGameState.hppc,
      ) &&
      parseMathCondition(
        rule.manaTriggerCondition,
        parseInt(rule.manaTriggerPercentage, 10),
        directGameState.mppc,
      ) &&
      areCharStatusConditionsMet(rule, directGameState) &&
      parseMathCondition(
        rule.monsterNumCondition,
        parseInt(rule.monsterNum, 10),
        directGameState.monsterNum,
      )
    );
  });

export const getAllValidRules = (rules, directGameState) => {
  const enabledRules = filterEnabledRules(rules);
  const rulesWithoutActiveCooldowns = filterRulesByActiveCooldowns(
    enabledRules,
    directGameState,
  );
  const rulesNotOnDelay = filterRulesNotOnDelay(rulesWithoutActiveCooldowns);
  return filterRulesByConditions(rulesNotOnDelay, directGameState).sort(
    (a, b) => b.priority - a.priority,
  );
};
