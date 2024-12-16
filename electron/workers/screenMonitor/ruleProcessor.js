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
    return !cooldownStateKey || !directGameState[cooldownStateKey];
  });

const filterRulesByWalkingState = (rules, directGameState) =>
  rules.filter((rule) => {
    return !rule.isWalking || (rule.isWalking && directGameState.isWalking);
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

      return (
        basicConditionsMet &&
        (!rule.requireManaShield ||
          rule.conditions.some((condition) => directGameState.characterStatus[condition.name]))
      );
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
  const rulesMeetingWalkingConditions = filterRulesByWalkingState(rulesNotOnDelay, directGameState);
  return filterRulesByConditions(rulesMeetingWalkingConditions, directGameState).sort(
    (a, b) => b.priority - a.priority,
  );
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

const scheduleManaSyncExecution = (manaSyncRules, global) => {
  if (manaSyncTimeoutId) {
    clearTimeout(manaSyncTimeoutId);
  }

  manaSyncTimeoutId = setTimeout(() => {
    const executionTime = Date.now();
    manaSyncRules.forEach((rule) => {
      lastRuleExecutionTimes[rule.id] = executionTime;
      lastCategoriesExecutionTimes[rule.category] = executionTime;
      keyPressManaSync(global.windowId, rule.key, 6);
    });

    lastManaSyncExecutionTime = executionTime;
    manaSyncTimeoutId = null;
    manaSyncScheduled = false;
  }, customManaSyncDelay);

  manaSyncScheduled = true;
};

export const processRules = async (activePreset, rules, directGameState, global) => {
  const validRules = getAllValidRules(activePreset, directGameState);
  const highestPriorityRules = getHighestPriorityRulesByCategory(validRules);

  if (highestPriorityRules.length > 0) {
    const manaSyncRules = highestPriorityRules.filter((rule) => rule.id.startsWith('manaSync'));
    const healFriendRules = highestPriorityRules.filter((rule) => rule.id.startsWith('healFriend'));
    const regularRules = highestPriorityRules.filter(
      (rule) => !rule.id.startsWith('manaSync') && !rule.id.startsWith('healFriend'),
    );

    let executeManaSyncThisRotation = true;

    for (const healFriendRule of healFriendRules) {
      const positionIndex = parseInt(healFriendRule.partyPosition, 10) - 1;
      const partyMember = directGameState.partyMembers[positionIndex];

      if (partyMember && partyMember.isActive) {
        if (healFriendRule.useRune) {
          useItemOnCoordinates(
            global.windowId,
            partyMember.uhCoordinates.x,
            partyMember.uhCoordinates.y,
            healFriendRule.key,
          );
          executeManaSyncThisRotation = false;
        } else {
          keyPress(global.windowId, [healFriendRule.key]);
        }

        lastRuleExecutionTimes[healFriendRule.id] = Date.now();
        lastCategoriesExecutionTimes[healFriendRule.category] = Date.now();
      }
    }

    if (regularRules.length > 0) {
      const regularRuleKeys = regularRules.map((rule) => rule.key);
      keyPress(global.windowId, regularRuleKeys);

      const now = Date.now();
      regularRules.forEach((rule) => {
        lastRuleExecutionTimes[rule.id] = now;
        lastCategoriesExecutionTimes[rule.category] = now;
      });
    }

    if (directGameState.attackCdActive !== lastAttackCooldownState) {
      if (directGameState.attackCdActive) {
        attackCooldownStartTime = Date.now();
        if (executeManaSyncThisRotation && manaSyncRules.length > 0) {
          manaSyncRules.forEach((rule) => keyPressManaSync(global.windowId, rule.key, 1));
        }
        if (manaSyncRules.length > 0 && !manaSyncScheduled && executeManaSyncThisRotation) {
          scheduleManaSyncExecution(manaSyncRules, global);
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
