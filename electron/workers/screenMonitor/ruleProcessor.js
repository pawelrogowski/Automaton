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
let lastKeypressTime = 0;

const KEYPRESS_COOLDOWN = 50;
const customManaSyncDelay = 800;

const canExecuteKeypress = () => {
  const now = Date.now();
  return now - lastKeypressTime >= KEYPRESS_COOLDOWN;
};

const executeRateLimitedKeyPress = (windowId, keys) => {
  if (!canExecuteKeypress()) return false;

  keyPress(windowId, keys);
  lastKeypressTime = Date.now();
  return true;
};

// Helper function to check if a party member needs healing
const doesPartyMemberNeedHealing = (partyMember, rule, directGameState) => {
  // Explicit threshold check - heal when HP is BELOW the threshold
  const currentHp = partyMember.hpPercentage;
  const thresholdHp = parseInt(rule.friendHpTriggerPercentage, 10);
  const hpThresholdMet = currentHp <= thresholdHp; // Only heal if HP is less than threshold

  const basicConditionsMet = (rule.requireAttackCooldown ? directGameState.attackCdActive : true) && partyMember.isActive && hpThresholdMet;

  return (
    basicConditionsMet && (!rule.requireManaShield || rule.conditions.some((condition) => directGameState.characterStatus[condition.name]))
  );
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
    if (rule.name.startsWith('healFriend')) {
      if (rule.partyPosition === '0') {
        // When monitoring all party members, we'll check if ANY member needs healing
        return directGameState.partyMembers.some((member) => doesPartyMemberNeedHealing(member, rule, directGameState));
      } else {
        const partyMember = directGameState.partyMembers[parseInt(rule.partyPosition, 10) - 1];
        return partyMember && doesPartyMemberNeedHealing(partyMember, rule, directGameState);
      }
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
    const healFriendRules = highestPriorityRules.filter((rule) => rule.id.startsWith('healFriend'));

    for (const healFriendRule of healFriendRules) {
      // console.log(`Processing heal friend rule: ${healFriendRule.id}`);
      // console.log(`Party position: ${healFriendRule.partyPosition}`);

      if (healFriendRule.partyPosition === '0') {
        // Handle monitoring all party members
        // console.log('Checking all party members...');
        for (let i = 0; i < directGameState.partyMembers.length; i++) {
          const partyMember = directGameState.partyMembers[i];
          // console.log(`Checking party member ${i + 1}, HP: ${partyMember.hpPercentage}`);

          if (partyMember && partyMember.isActive && doesPartyMemberNeedHealing(partyMember, healFriendRule, directGameState)) {
            if (healFriendRule.useRune && canExecuteKeypress()) {
              console.log(`Healing party member ${i + 1} at coordinates:`, partyMember.uhCoordinates);
              useItemOnCoordinates(global.windowId, partyMember.uhCoordinates.x, partyMember.uhCoordinates.y + 26, healFriendRule.key);
              lastKeypressTime = Date.now();
              lastRuleExecutionTimes[healFriendRule.id] = Date.now();
              lastCategoriesExecutionTimes[healFriendRule.category] = Date.now();
              break;
            }
          }
        }
      } else {
        const positionIndex = parseInt(healFriendRule.partyPosition, 10) - 1;
        const partyMember = directGameState.partyMembers[positionIndex];

        console.log(`Checking specific party member ${positionIndex + 1}`);
        if (partyMember && partyMember.isActive && doesPartyMemberNeedHealing(partyMember, healFriendRule, directGameState)) {
          if (healFriendRule.useRune && canExecuteKeypress()) {
            console.log(`Healing specific party member at coordinates:`, partyMember.uhCoordinates);
            useItemOnCoordinates(global.windowId, partyMember.uhCoordinates.x, partyMember.uhCoordinates.y + 26, healFriendRule.key);
            lastKeypressTime = Date.now();
            lastRuleExecutionTimes[healFriendRule.id] = Date.now();
            lastCategoriesExecutionTimes[healFriendRule.category] = Date.now();
          }
        }
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
