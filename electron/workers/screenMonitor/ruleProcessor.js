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
let lastKeypressTime = 0; // Added: Track the last keypress time

const KEYPRESS_COOLDOWN = 50; // Added: 50ms cooldown between keypresses
const customManaSyncDelay = 800;

// Added: Helper function to check if enough time has passed since last keypress
const canExecuteKeypress = () => {
  const now = Date.now();
  return now - lastKeypressTime >= KEYPRESS_COOLDOWN;
};

// Added: Wrapper function for keyPress that respects the rate limit
const executeRateLimitedKeyPress = (windowId, keys) => {
  if (!canExecuteKeypress()) return false;

  keyPress(windowId, keys);
  lastKeypressTime = Date.now();
  return true;
};

const filterEnabledRules = (rules) => rules.filter((rule) => rule.enabled);

const filterRulesNotOnDelay = (rules) =>
  rules.filter(
    (rule) =>
      Date.now() - (lastRuleExecutionTimes[rule.id] || 0) >= (rule.delay || 0) &&
      Date.now() - Math.max(...rules.filter((r) => r.category === rule.category).map((r) => lastRuleExecutionTimes[r.id] || 0)) >=
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
    if (rule.id.startsWith('healFriend')) {
      const isAttackCooldownMet = rule.requireAttackCooldown ? directGameState.attackCdActive : true;

      // Handle partyPosition 0 (all members) vs specific position
      const relevantMembers =
        rule.partyPosition === 0
          ? directGameState.partyMembers.filter((member) => member.isActive)
          : [directGameState.partyMembers[parseInt(rule.partyPosition, 10) - 1]].filter((member) => member && member.isActive);

      // Check if any relevant party member meets the HP condition
      const memberMeetsHpCondition = relevantMembers.some((member) => member.hpPercentage <= parseInt(rule.friendHpTriggerPercentage, 10));

      const basicConditionsMet = isAttackCooldownMet && memberMeetsHpCondition;
      const manaShieldCheck =
        !rule.requireManaShield || rule.conditions.some((condition) => directGameState.characterStatus[condition.name]);

      return basicConditionsMet && manaShieldCheck;
    }

    return (
      parseMathCondition(rule.hpTriggerCondition, parseInt(rule.hpTriggerPercentage, 10), directGameState.hpPercentage) &&
      parseMathCondition(rule.manaTriggerCondition, parseInt(rule.manaTriggerPercentage, 10), directGameState.manaPercentage) &&
      areCharStatusConditionsMet(rule, directGameState) &&
      parseMathCondition(rule.monsterNumCondition, parseInt(rule.monsterNum, 10), directGameState.monsterNum)
    );
  });

const getAllValidRules = (rules, directGameState) => {
  const enabledRules = filterEnabledRules(rules);
  const rulesWithoutActiveCooldowns = filterRulesByActiveCooldowns(enabledRules, directGameState);
  const rulesNotOnDelay = filterRulesNotOnDelay(rulesWithoutActiveCooldowns);
  const rulesMeetingWalkingConditions = filterRulesByWalkingState(rulesNotOnDelay, directGameState);
  return filterRulesByConditions(rulesMeetingWalkingConditions, directGameState).sort((a, b) => b.priority - a.priority);
};

const getHighestPriorityRulesByCategory = (rules) => {
  const categoryMap = new Map();
  for (const rule of rules) {
    if (!categoryMap.has(rule.category) || rule.priority > categoryMap.get(rule.category).priority) {
      categoryMap.set(rule.category, rule);
    }
  }
  return Array.from(categoryMap.values());
};

// Modified: Updated to use rate-limited keypress
const scheduleManaSyncExecution = (manaSyncRules, global) => {
  if (manaSyncTimeoutId) {
    clearTimeout(manaSyncTimeoutId);
  }

  manaSyncTimeoutId = setTimeout(() => {
    if (canExecuteKeypress()) {
      const executionTime = Date.now();
      manaSyncRules.forEach((rule) => {
        lastRuleExecutionTimes[rule.id] = executionTime;
        lastCategoriesExecutionTimes[rule.category] = executionTime;
        keyPressManaSync(global.windowId, rule.key, 2);
      });
      lastKeypressTime = executionTime;
      lastManaSyncExecutionTime = executionTime;
    }
    manaSyncTimeoutId = null;
    manaSyncScheduled = false;
  }, customManaSyncDelay);

  manaSyncScheduled = true;
};

export const processRules = async (activePreset, directGameState, global) => {
  const validRules = getAllValidRules(activePreset, directGameState);
  const highestPriorityRules = getHighestPriorityRulesByCategory(validRules);

  if (highestPriorityRules.length > 0) {
    const manaSyncRules = highestPriorityRules.filter((rule) => rule.id.startsWith('manaSync'));
    const healFriendRules = highestPriorityRules.filter((rule) => rule.id.startsWith('healFriend'));
    const regularRules = highestPriorityRules.filter((rule) => !rule.id.startsWith('manaSync') && !rule.id.startsWith('healFriend'));

    let executeManaSyncThisRotation = true;

    // Process healFriend rules in priority order
    for (const healFriendRule of healFriendRules) {
      // Get relevant party members based on position
      const relevantMembers =
        healFriendRule.partyPosition === 0
          ? directGameState.partyMembers.filter((member) => member.isActive)
          : [directGameState.partyMembers[parseInt(healFriendRule.partyPosition, 10) - 1]].filter((member) => member && member.isActive);

      // Filter members that meet HP condition
      const membersNeedingHeal = relevantMembers.filter(
        (member) => member.hpPercentage <= parseInt(healFriendRule.friendHpTriggerPercentage, 10),
      );

      if (membersNeedingHeal.length > 0) {
        // Find the member with lowest HP if multiple match
        const targetMember = membersNeedingHeal.reduce((lowest, current) =>
          current.hpPercentage < lowest.hpPercentage ? current : lowest,
        );

        if (healFriendRule.useRune) {
          if (canExecuteKeypress()) {
            useItemOnCoordinates(global.windowId, targetMember.uhCoordinates.x, targetMember.uhCoordinates.y, healFriendRule.key);
            lastKeypressTime = Date.now();
            executeManaSyncThisRotation = false;
          }
        } else {
          if (executeRateLimitedKeyPress(global.windowId, [healFriendRule.key])) {
            executeManaSyncThisRotation = false;
          }
        }

        lastRuleExecutionTimes[healFriendRule.id] = Date.now();
        lastCategoriesExecutionTimes[healFriendRule.category] = Date.now();

        // Break after executing highest priority rule that found a target
        break;
      }
    }

    // Rest of the original processRules function remains the same
    if (regularRules.length > 0) {
      const regularRuleKeys = regularRules.map((rule) => rule.key);
      if (executeRateLimitedKeyPress(global.windowId, regularRuleKeys)) {
        const now = Date.now();
        regularRules.forEach((rule) => {
          lastRuleExecutionTimes[rule.id] = now;
          lastCategoriesExecutionTimes[rule.category] = now;
        });
      }
    }

    if (directGameState.attackCdActive !== lastAttackCooldownState) {
      if (directGameState.attackCdActive) {
        attackCooldownStartTime = Date.now();

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
