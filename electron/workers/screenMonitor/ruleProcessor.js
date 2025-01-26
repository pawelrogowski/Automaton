import parseMathCondition from '../../utils/parseMathCondition.js';
import areCharStatusConditionsMet from '../../utils/areStatusConditionsMet.js';
import { keyPress, keyPressManaSync } from '../../keyboardControll/keyPress.js';
import { OPTIONS } from './constants.js';
import useItemOnCoordinates from '../../mouseControll/useItemOnCoordinates.js';
import { getRandomNumber } from '../../utils/getRandomNumber.js';

class RuleProcessor {
  constructor() {
    this.lastRuleExecutionTimes = {};
    this.lastCategoriesExecutionTimes = {};
    this.lastAttackCooldownState = false;
    this.attackCooldownStartTime = 0;
    this.lastKeypressTime = 0;
    this.delayedCheckPerformed = false;

    this.KEYPRESS_COOLDOWN = 50;
    this.customManaSyncDelay = 650;
  }

  canExecuteKeypress() {
    const now = Date.now();
    return now - this.lastKeypressTime >= this.KEYPRESS_COOLDOWN;
  }

  executeRateLimitedKeyPress(windowId, keys, rule) {
    if (!this.canExecuteKeypress()) {
      return false;
    }

    keyPress(windowId, keys, rule);
    this.lastKeypressTime = Date.now();
    return true;
  }

  filterEnabledRules(rules) {
    return rules.filter((rule) => rule.enabled);
  }

  filterRulesNotOnDelay(rules) {
    const now = Date.now();
    return rules.filter((rule) => {
      const ruleDelay = now - (this.lastRuleExecutionTimes[rule.id] || 0) >= (rule.delay || 0);
      const categoryDelay =
        now - Math.max(...rules.filter((r) => r.category === rule.category).map((r) => this.lastRuleExecutionTimes[r.id] || 0)) >=
        OPTIONS.categoryDelays[rule.category];
      return ruleDelay && categoryDelay;
    });
  }

  filterRulesByActiveCooldowns(rules, directGameState) {
    return rules.filter((rule) => {
      const cooldownStateKey = OPTIONS.cooldownStateMapping[rule.category];
      return !cooldownStateKey || !directGameState[cooldownStateKey];
    });
  }

  filterRulesByWalkingState(rules, directGameState) {
    return rules.filter((rule) => !rule.isWalking || (rule.isWalking && directGameState.isWalking));
  }

  shouldHealFriend(rule, directGameState, ignoreRequireAttackCooldown = false) {
    if (!directGameState?.partyMembers) return false;

    const isAttackCooldownMet = ignoreRequireAttackCooldown ? true : rule.requireAttackCooldown ? directGameState.attackCdActive : true;
    if (!isAttackCooldownMet) {
      return false;
    }

    const hpTriggerPercentage = parseInt(rule.friendHpTriggerPercentage, 10);

    if (rule.partyPosition === '0') {
      return directGameState.partyMembers.some(
        (member) => member.isActive && member.hpPercentage <= hpTriggerPercentage && member.hpPercentage > 0,
      );
    } else {
      const partyIndex = parseInt(rule.partyPosition, 10) - 1;
      const targetMember = directGameState.partyMembers[partyIndex];

      if (!targetMember || !targetMember.isActive) {
        return false;
      }

      return targetMember.hpPercentage <= hpTriggerPercentage && targetMember.hpPercentage > 0;
    }
  }

  filterRulesByConditions(rules, directGameState) {
    return rules.filter((rule) => {
      if (rule.id.startsWith('manaSync') && !directGameState.attackCdActive) {
        return false;
      }

      if (rule.id.startsWith('healFriend')) {
        return this.shouldHealFriend(rule, directGameState);
      }

      const hpCondition = parseMathCondition(rule.hpTriggerCondition, parseInt(rule.hpTriggerPercentage, 10), directGameState.hpPercentage);
      const manaCondition = parseMathCondition(
        rule.manaTriggerCondition,
        parseInt(rule.manaTriggerPercentage, 10),
        directGameState.manaPercentage,
      );
      const statusCondition = areCharStatusConditionsMet(rule, directGameState);
      const monsterCondition = parseMathCondition(rule.monsterNumCondition, parseInt(rule.monsterNum, 10), directGameState.monsterNum);

      return hpCondition && manaCondition && statusCondition && monsterCondition;
    });
  }

  getAllValidRules(rules, directGameState) {
    const enabledRules = this.filterEnabledRules(rules);
    const rulesWithoutActiveCooldowns = this.filterRulesByActiveCooldowns(enabledRules, directGameState);
    const rulesNotOnDelay = this.filterRulesNotOnDelay(rulesWithoutActiveCooldowns);
    const rulesMeetingWalkingConditions = this.filterRulesByWalkingState(rulesNotOnDelay, directGameState);
    return this.filterRulesByConditions(rulesMeetingWalkingConditions, directGameState).sort((a, b) => b.priority - a.priority);
  }

  getHighestPriorityRulesByCategory(rules) {
    const categoryMap = new Map();

    for (const rule of rules) {
      if (!categoryMap.has(rule.category) || rule.priority > categoryMap.get(rule.category).priority) {
        categoryMap.set(rule.category, rule);
      }
    }

    return Array.from(categoryMap.values());
  }

  executeHealFriendRule(rule, directGameState, global) {
    if (!directGameState?.partyMembers) return false;

    const hpTriggerPercentage = parseInt(rule.friendHpTriggerPercentage, 10);
    const now = Date.now();
    let executed = false;

    if (rule.partyPosition === '0') {
      for (const targetMember of directGameState.partyMembers) {
        if (targetMember.isActive && targetMember.hpPercentage <= hpTriggerPercentage && targetMember.hpPercentage > 0) {
          if (rule.useRune) {
            if (this.canExecuteKeypress()) {
              useItemOnCoordinates(
                global.windowId,
                targetMember.uhCoordinates.x + getRandomNumber(0, 130),
                targetMember.uhCoordinates.y + getRandomNumber(0, 11),
                rule.key,
              );
              this.lastKeypressTime = now;
              executed = true;
              break;
            }
          } else {
            executed = this.executeRateLimitedKeyPress(global.windowId, [rule.key], rule);
            break;
          }
        }
      }
    } else {
      const partyIndex = parseInt(rule.partyPosition, 10) - 1;
      const targetMember = directGameState.partyMembers[partyIndex];

      if (targetMember && targetMember.isActive && targetMember.hpPercentage <= hpTriggerPercentage && targetMember.hpPercentage > 0) {
        if (rule.useRune) {
          if (this.canExecuteKeypress()) {
            useItemOnCoordinates(
              global.windowId,
              targetMember.uhCoordinates.x + getRandomNumber(0, 130),
              targetMember.uhCoordinates.y + getRandomNumber(0, 11),
              rule.key,
            );
            this.lastKeypressTime = now;
            executed = true;
          }
        } else {
          executed = this.executeRateLimitedKeyPress(global.windowId, [rule.key], rule);
        }
      }
    }

    if (executed) {
      this.lastRuleExecutionTimes[rule.id] = now;
      this.lastCategoriesExecutionTimes[rule.category] = now;
    }

    return executed;
  }

  async processRules(activePreset, directGameState, global) {
    const validRules = this.getAllValidRules(activePreset, directGameState);
    const highestPriorityRules = this.getHighestPriorityRulesByCategory(validRules);

    if (highestPriorityRules.length > 0) {
      const manaSyncRules = highestPriorityRules.filter((rule) => rule.id.startsWith('manaSync'));
      const healFriendRules = highestPriorityRules.filter((rule) => rule.id.startsWith('healFriend'));
      const regularRules = highestPriorityRules.filter((rule) => !rule.id.startsWith('manaSync') && !rule.id.startsWith('healFriend'));

      let executeDelayedRules = true;

      // Immediate healFriend rules (non-rune OR don't require attack cooldown)
      const immediateHealFriends = healFriendRules.filter((rule) => !rule.useRune || !rule.requireAttackCooldown);

      for (const healFriendRule of immediateHealFriends) {
        if (this.executeHealFriendRule(healFriendRule, directGameState, global)) {
          executeDelayedRules = false;
          break;
        }
      }

      // Execute regular rules if no immediate rule was executed
      if (executeDelayedRules && regularRules.length > 0) {
        regularRules.forEach((rule) => {
          if (this.executeRateLimitedKeyPress(global.windowId, [rule.key], rule)) {
            const now = Date.now();
            this.lastRuleExecutionTimes[rule.id] = now;
            this.lastCategoriesExecutionTimes[rule.category] = now;
          }
        });
      }

      // Handle attack cooldown state changes
      if (directGameState.attackCdActive !== this.lastAttackCooldownState) {
        if (directGameState.attackCdActive) {
          this.attackCooldownStartTime = Date.now();
          this.delayedCheckPerformed = false;
        } else {
          this.delayedCheckPerformed = false;
        }
      }

      // Perform delayed check using current state
      if (directGameState.attackCdActive && !this.delayedCheckPerformed) {
        const timeSinceCooldown = Date.now() - this.attackCooldownStartTime;

        if (timeSinceCooldown >= this.customManaSyncDelay) {
          this.delayedCheckPerformed = true;

          // Get all potential delayed rules
          const delayedHealFriends = healFriendRules.filter((rule) => rule.requireAttackCooldown && rule.useRune);
          const delayedRules = [...manaSyncRules, ...delayedHealFriends];

          // Check current validity (ignore attack cooldown for healFriends)
          const validDelayedRules = delayedRules.filter((rule) => {
            if (rule.id.startsWith('manaSync')) {
              return directGameState.attackCdActive;
            }
            return this.shouldHealFriend(rule, directGameState, true);
          });

          // Sort by priority and execute highest
          const sortedRules = validDelayedRules.sort((a, b) => b.priority - a.priority);
          if (sortedRules.length > 0 && this.canExecuteKeypress()) {
            const ruleToExecute = sortedRules[0];

            if (ruleToExecute.id.startsWith('manaSync')) {
              keyPressManaSync(global.windowId, ruleToExecute.key, 2);
            } else {
              this.executeHealFriendRule(ruleToExecute, directGameState, global);
            }

            const now = Date.now();
            this.lastRuleExecutionTimes[ruleToExecute.id] = now;
            this.lastCategoriesExecutionTimes[ruleToExecute.category] = now;
            this.lastKeypressTime = now;
          }
        }
      }
    }

    this.lastAttackCooldownState = directGameState.attackCdActive;
  }
}

export default RuleProcessor;
