import parseMathCondition from '../../utils/parseMathCondition.js';
import areCharStatusConditionsMet from '../../utils/areStatusConditionsMet.js';
import { keyPress, keyPressManaSync } from '../../keyboardControll/keyPress.js';
import { OPTIONS } from './constants.js';
import useItemOnCoordinates from '../../mouseControll/useItemOnCoordinates.js';
import { getRandomNumber } from '../../utils/getRandomNumber.js';

let lastRuleExecutionTimes = {};
let lastCategoriesExecutionTimes = {};
let manaSyncTimeoutId = null;
let lastAttackCooldownState = false;
let lastManaSyncExecutionTime = 0;
let attackCooldownStartTime = 0;
let manaSyncScheduled = false;
let lastKeypressTime = 0;

const KEYPRESS_COOLDOWN = 50;
const customManaSyncDelay = 800;

const canExecuteKeypress = () => {
  const now = Date.now();
  return now - lastKeypressTime >= KEYPRESS_COOLDOWN;
};

const executeRateLimitedKeyPress = (windowId, keys, rule) => {
  if (!canExecuteKeypress()) return false;

  keyPress(windowId, keys, rule);
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

const shouldHealFriend = (rule, directGameState) => {
  console.log('Current Party Data', directGameState.partyMembers);
  console.log('\n=== shouldHealFriend check ===');

  // Log attack cooldown check
  const isAttackCooldownMet = rule.requireAttackCooldown ? directGameState.attackCdActive : true;
  console.log('Attack cooldown check:', {
    requireAttackCooldown: rule.requireAttackCooldown,
    attackCdActive: directGameState.attackCdActive,
    isAttackCooldownMet,
  });

  if (!isAttackCooldownMet) {
    console.log('Failed: Attack cooldown requirement not met');
    return false;
  }

  // Get the specific party member
  const partyIndex = parseInt(rule.partyPosition, 10) - 1;
  const targetMember = directGameState.partyMembers[partyIndex];

  console.log('Party member check:', {
    rulePartyPosition: rule.partyPosition,
    calculatedIndex: partyIndex,
    targetMemberExists: !!targetMember,
    targetMemberActive: targetMember?.isActive,
    targetMemberHP: targetMember?.hpPercentage,
  });

  // Check if party member exists and is active
  if (!targetMember || !targetMember.isActive) {
    console.log('Failed: Target member does not exist or is not active');
    return false;
  }

  // Check if HP is below or equal to trigger percentage
  const hpTriggerPercentage = parseInt(rule.friendHpTriggerPercentage, 10);
  console.log('HP check:', {
    currentHP: targetMember.hpPercentage,
    triggerThreshold: hpTriggerPercentage,
    shouldHeal: targetMember.hpPercentage <= hpTriggerPercentage,
  });

  if (targetMember.hpPercentage > hpTriggerPercentage) {
    console.log('Failed: HP above threshold');
    return false;
  }

  // Check mana shield requirement if present
  const manaShieldMet = !rule.requireManaShield || rule.conditions.some((condition) => directGameState.characterStatus[condition.name]);
  console.log('Mana shield check:', {
    requireManaShield: rule.requireManaShield,
    manaShieldMet,
  });

  console.log('Final result: Will heal');
  return manaShieldMet;
};
const filterRulesByConditions = (rules, directGameState) =>
  rules.filter((rule) => {
    // Filter out manaSync rules if attack cooldown is not active
    if (rule.id.startsWith('manaSync') && !directGameState.attackCdActive) {
      return false;
    }

    // Special handling for healFriend rules
    if (rule.id.startsWith('healFriend')) {
      return shouldHealFriend(rule, directGameState);
    }

    // Regular rules conditions
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

const executeHealFriendRule = (rule, directGameState, global) => {
  console.log('\n=== executeHealFriendRule execution ===');

  const partyIndex = parseInt(rule.partyPosition, 10) - 1;
  const targetMember = directGameState.partyMembers[partyIndex];

  if (!targetMember || !targetMember.isActive) {
    console.log('Failed: Target member does not exist or is not active');
    return false;
  }

  const hpTriggerPercentage = parseInt(rule.friendHpTriggerPercentage, 10);
  if (targetMember.hpPercentage > hpTriggerPercentage) {
    console.log('Failed: HP above threshold');
    return false;
  }

  const now = Date.now();
  let executed = false;

  if (rule.useRune) {
    if (canExecuteKeypress()) {
      useItemOnCoordinates(
        global.windowId,
        targetMember.uhCoordinates.x + getRandomNumber(0, 130),
        targetMember.uhCoordinates.y + getRandomNumber(0, 11),
        rule.key,
      );
      lastKeypressTime = now;
      executed = true;
      console.log('Rune heal executed');
    } else {
      console.log('Skipped: Keypress on cooldown');
    }
  } else {
    executed = executeRateLimitedKeyPress(global.windowId, [rule.key], rule);
    console.log('Regular heal executed:', executed);
  }

  // Only update timings if we actually executed the action
  if (executed) {
    lastRuleExecutionTimes[rule.id] = now;
    lastCategoriesExecutionTimes[rule.category] = now;
    console.log('Rule execution times updated');
  }

  return executed;
};

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
      const healExecuted = executeHealFriendRule(healFriendRule, directGameState, global);
      if (healExecuted) {
        executeManaSyncThisRotation = false;
        break;
      }
    }

    // Process regular rules
    if (regularRules.length > 0) {
      const regularRuleKeys = regularRules.map((rule) => rule.key);

      // Now, instead of just passing `regularRuleKeys`,
      // we should also pass the corresponding `rule` to maintain context.
      regularRules.forEach((rule, index) => {
        if (executeRateLimitedKeyPress(global.windowId, [regularRuleKeys[index]], rule)) {
          const now = Date.now();
          lastRuleExecutionTimes[rule.id] = now;
          lastCategoriesExecutionTimes[rule.category] = now;
        }
      });
    }

    // Handle manaSync scheduling
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
