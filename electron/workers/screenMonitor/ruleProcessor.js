import parseMathCondition from '../../utils/parseMathCondition.js';
import areCharStatusConditionsMet from '../../utils/areStatusConditionsMet.js';
import { keyPress, keyPressManaSync } from '../../keyboardControll/keyPress.js';
import { OPTIONS } from './constants.js';
import useItemOnCoordinates from '../../mouseControll/useItemOnCoordinates.js';

let lastRuleExecutionTimes = {};
let lastCategoriesExecutionTimes = {};
let manaSyncTimeoutId = null;
let lastAttackCooldownState = false;
let lastManaSyncExecutionTime = 0;
let attackCooldownStartTime = 0;
let manaSyncScheduled = false;

const customManaSyncDelay = 600;

const filterEnabledRules = (rules) => rules.filter((rule) => rule.enabled);

const filterRulesNotOnDelay = (rules) =>
  rules.filter(
    (rule) =>
      Date.now() - (lastRuleExecutionTimes[rule.id] || 0) >= (rule.delay || 0) &&
      Date.now() -
        Math.max(
          ...rules
            .filter((r) => r.category === rule.category)
            .map((r) => lastRuleExecutionTimes[r.id] || 0),
        ) >=
        OPTIONS.categoryDelays[rule.category],
  );

const filterRulesByActiveCooldowns = (rules, directGameState) =>
  rules.filter((rule) => {
    const cooldownStateKey = OPTIONS.cooldownStateMapping[rule.category];

    if (!cooldownStateKey) {
      return true;
    }
    return !directGameState[cooldownStateKey];
  });

const filterRulesByConditions = (rules, directGameState) =>
  rules.filter((rule) => {
    if (rule.name === 'healFriend') {
      const basicConditionsMet =
        parseMathCondition(
          rule.hpTriggerCondition,
          parseInt(rule.hpTriggerPercentage, 10),
          directGameState.hpPercentage,
        ) &&
        parseMathCondition(
          rule.manaTriggerCondition,
          parseInt(rule.manaTriggerPercentage, 10),
          directGameState.manaPercentage,
        ) &&
        parseMathCondition(
          rule.monsterNumCondition,
          parseInt(rule.monsterNum, 10),
          directGameState.monsterNum,
        ) &&
        (rule.requireAttackCooldown ? directGameState.attackCdActive : true) &&
        directGameState.partyMembers[0].isActive &&
        parseMathCondition(
          '<=',
          parseInt(rule.friendHpTriggerPercentage, 10),
          directGameState.partyMembers[0].hpPercentage,
        );
      if (!basicConditionsMet) return false;

      if (rule.requireManaShield) {
        return rule.conditions.some((condition) => directGameState.characterStatus[condition.name]);
      } else {
        return true; // If requireManaShield is false, no additional conditions need to be met
      }
    }

    return (
      parseMathCondition(
        rule.hpTriggerCondition,
        parseInt(rule.hpTriggerPercentage, 10),
        directGameState.hpPercentage,
      ) &&
      parseMathCondition(
        rule.manaTriggerCondition,
        parseInt(rule.manaTriggerPercentage, 10),
        directGameState.manaPercentage,
      ) &&
      areCharStatusConditionsMet(rule, directGameState) &&
      parseMathCondition(
        rule.monsterNumCondition,
        parseInt(rule.monsterNum, 10),
        directGameState.monsterNum,
      )
    );
  });

const getAllValidRules = (rules, directGameState) => {
  const enabledRules = filterEnabledRules(rules);
  const rulesWithoutActiveCooldowns = filterRulesByActiveCooldowns(enabledRules, directGameState);
  const rulesNotOnDelay = filterRulesNotOnDelay(rulesWithoutActiveCooldowns);
  const rulesWithConditionsMet = filterRulesByConditions(rulesNotOnDelay, directGameState);
  return rulesWithConditionsMet.sort((a, b) => b.priority - a.priority);
};

const getHighestPriorityRulesByCategory = (rules) => {
  const categoryMap = new Map();
  for (const rule of rules) {
    if (
      !categoryMap.has(rule.category) ||
      rule.priority > categoryMap.get(rule.category).priority
    ) {
      categoryMap.set(rule.category, rule);
    }
  }
  return Array.from(categoryMap.values());
};

const scheduleManaSyncExecution = (manaSyncRule, global) => {
  if (manaSyncTimeoutId) {
    clearTimeout(manaSyncTimeoutId);
  }

  manaSyncTimeoutId = setTimeout(async () => {
    const executionTime = Date.now();
    lastRuleExecutionTimes[manaSyncRule.id] = executionTime;
    lastCategoriesExecutionTimes[manaSyncRule.category] = executionTime;
    lastManaSyncExecutionTime = executionTime;
    manaSyncTimeoutId = null;
    manaSyncScheduled = false;

    const manaSyncStartTime = performance.now();
    keyPressManaSync(global.windowId, manaSyncRule.key, 6);
    const manaSyncDuration = performance.now() - manaSyncStartTime;

    if (OPTIONS.logsEnabled) {
      console.log(
        `Executing manaSync command for key: ${manaSyncRule.key}, current time: ${executionTime}, duration: ${manaSyncDuration.toFixed(2)} ms`,
      );
    }
  }, customManaSyncDelay);

  if (OPTIONS.logsEnabled) {
    console.log(`Scheduled manaSync execution at ${Date.now() + customManaSyncDelay}`);
  }
  manaSyncScheduled = true;
};

export const processRules = async (activePreset, rules, directGameState, global) => {
  const validRules = getAllValidRules(activePreset, directGameState);
  const highestPriorityRules = getHighestPriorityRulesByCategory(validRules);

  if (highestPriorityRules.length > 0) {
    const manaSyncRule = highestPriorityRules.find((rule) => rule.id === 'manaSync');
    const healFriendRule = highestPriorityRules.find((rule) => rule.id === 'healFriend');
    const regularRules = highestPriorityRules.filter(
      (rule) => rule.id !== 'manaSync' && rule.id !== 'healFriend',
    );

    let executeManaSyncThisRotation = true;

    if (healFriendRule) {
      const healFriendStartTime = performance.now();
      if (healFriendRule.useRune) {
        useItemOnCoordinates(
          global.windowId,
          directGameState.partyMembers[0].uhCoordinates.x,
          directGameState.partyMembers[0].uhCoordinates.y,
          healFriendRule.key,
        );
        executeManaSyncThisRotation = false;
      } else {
        keyPress(global.windowId, [healFriendRule.key]);
      }
      const healFriendDuration = performance.now() - healFriendStartTime;

      lastRuleExecutionTimes[healFriendRule.id] = Date.now();
      lastCategoriesExecutionTimes[healFriendRule.category] = Date.now();

      if (OPTIONS.logsEnabled) {
        console.log(
          `Executing healFriend command for key: ${healFriendRule.key}, useRune: ${healFriendRule.useRune}, current time: ${Date.now()}, duration: ${healFriendDuration.toFixed(2)} ms`,
        );
      }
    }

    if (regularRules.length > 0) {
      const regularRuleKeys = regularRules.map((rule) => rule.key);
      const keypressStartTime = performance.now();
      keyPress(global.windowId, regularRuleKeys);
      const keypressDuration = performance.now() - keypressStartTime;

      const now = Date.now();
      regularRules.forEach((rule) => {
        lastRuleExecutionTimes[rule.id] = now;
        lastCategoriesExecutionTimes[rule.category] = now;
      });

      if (OPTIONS.logsEnabled) {
        console.log(
          `Executing chained command for keys: ${regularRuleKeys.join(', ')}, current time: ${now}, keypress duration: ${keypressDuration.toFixed(2)} ms`,
        );
      }
    }

    if (directGameState.attackCdActive !== lastAttackCooldownState) {
      if (directGameState.attackCdActive) {
        attackCooldownStartTime = Date.now();
        if (executeManaSyncThisRotation && manaSyncRule) {
          keyPressManaSync(global.windowId, manaSyncRule.key, 1);
        }
        if (manaSyncRule && !manaSyncScheduled && executeManaSyncThisRotation) {
          scheduleManaSyncExecution(manaSyncRule, global);
        }
      } else {
        if (manaSyncTimeoutId) {
          clearTimeout(manaSyncTimeoutId);
          manaSyncTimeoutId = null;
          manaSyncScheduled = false;
        }
      }
    }
  }

  lastAttackCooldownState = directGameState.attackCdActive;
};
