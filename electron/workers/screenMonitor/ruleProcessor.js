import parseMathCondition from '../../utils/parseMathCondition.js';
import areCharStatusConditionsMet from '../../utils/areStatusConditionsMet.js';
import { keyPress, keyPressManaSync } from '../../keyboardControll/keyPress.js';
import { OPTIONS } from './constants.js';
import useItemOnCoordinates from '../../mouseControll/useItemOnCoordinates.js';
import { getRandomNumber } from '../../utils/getRandomNumber.js';

const SHOW_LOGS = false;

let lastRuleExecutionTimes = {};
let lastCategoriesExecutionTimes = {};
let manaSyncTimeoutId = null;
let lastAttackCooldownState = false;
let lastManaSyncExecutionTime = 0;
let attackCooldownStartTime = 0;
let manaSyncScheduled = false;
let lastKeypressTime = 0;

const KEYPRESS_COOLDOWN = 64;
const customManaSyncDelay = 800;

const canExecuteKeypress = () => {
  const now = Date.now();
  const canExecute = now - lastKeypressTime >= KEYPRESS_COOLDOWN;
  if (SHOW_LOGS) {
    console.log('Keypress execution check:', {
      currentTime: now,
      lastKeypressTime,
      timeSinceLastPress: now - lastKeypressTime,
      cooldownRequired: KEYPRESS_COOLDOWN,
      canExecute,
    });
  }
  return canExecute;
};

const executeRateLimitedKeyPress = (windowId, keys, rule) => {
  if (SHOW_LOGS) {
    console.log('Attempting rate-limited keypress:', {
      windowId,
      keys,
      ruleId: rule.id,
      category: rule.category,
    });
  }

  if (!canExecuteKeypress()) {
    if (SHOW_LOGS) console.log('Rate-limited keypress rejected: Still on cooldown');
    return false;
  }

  keyPress(windowId, keys, rule);
  lastKeypressTime = Date.now();

  if (SHOW_LOGS) console.log('Rate-limited keypress executed successfully');
  return true;
};

const filterEnabledRules = (rules) => {
  const filtered = rules.filter((rule) => rule.enabled);
  if (SHOW_LOGS) {
    console.log('Filtering enabled rules:', {
      totalRules: rules.length,
      enabledRules: filtered.length,
      enabledRuleIds: filtered.map((r) => r.id),
    });
  }
  return filtered;
};

const filterRulesNotOnDelay = (rules) => {
  const now = Date.now();
  const filtered = rules.filter((rule) => {
    const ruleDelay = now - (lastRuleExecutionTimes[rule.id] || 0) >= (rule.delay || 0);
    const categoryDelay =
      now - Math.max(...rules.filter((r) => r.category === rule.category).map((r) => lastRuleExecutionTimes[r.id] || 0)) >=
      OPTIONS.categoryDelays[rule.category];

    if (SHOW_LOGS) {
      console.log(`Delay check for rule ${rule.id}:`, {
        ruleDelay,
        categoryDelay,
        timeSinceLastExecution: now - (lastRuleExecutionTimes[rule.id] || 0),
        requiredDelay: rule.delay || 0,
        categoryDelayRequired: OPTIONS.categoryDelays[rule.category],
      });
    }

    return ruleDelay && categoryDelay;
  });

  if (SHOW_LOGS) {
    console.log('Rules after delay filtering:', {
      beforeCount: rules.length,
      afterCount: filtered.length,
      passedRuleIds: filtered.map((r) => r.id),
    });
  }

  return filtered;
};

const filterRulesByActiveCooldowns = (rules, directGameState) => {
  const filtered = rules.filter((rule) => {
    const cooldownStateKey = OPTIONS.cooldownStateMapping[rule.category];
    const passes = !cooldownStateKey || !directGameState[cooldownStateKey];

    if (SHOW_LOGS) {
      console.log(`Cooldown check for rule ${rule.id}:`, {
        category: rule.category,
        cooldownStateKey,
        cooldownActive: directGameState[cooldownStateKey],
        passes,
      });
    }

    return passes;
  });

  if (SHOW_LOGS) {
    console.log('Rules after cooldown filtering:', {
      beforeCount: rules.length,
      afterCount: filtered.length,
      passedRuleIds: filtered.map((r) => r.id),
    });
  }

  return filtered;
};

const filterRulesByWalkingState = (rules, directGameState) => {
  const filtered = rules.filter((rule) => {
    const passes = !rule.isWalking || (rule.isWalking && directGameState.isWalking);

    if (SHOW_LOGS) {
      console.log(`Walking state check for rule ${rule.id}:`, {
        requiresWalking: rule.isWalking,
        currentlyWalking: directGameState.isWalking,
        passes,
      });
    }

    return passes;
  });

  if (SHOW_LOGS) {
    console.log('Rules after walking state filtering:', {
      beforeCount: rules.length,
      afterCount: filtered.length,
      passedRuleIds: filtered.map((r) => r.id),
    });
  }

  return filtered;
};

const shouldHealFriend = (rule, directGameState) => {
  if (SHOW_LOGS) {
    console.log('\n=== shouldHealFriend check ===');
    console.log('Current Party Data:', directGameState.partyMembers);
  }

  const isAttackCooldownMet = rule.requireAttackCooldown ? directGameState.attackCdActive : true;
  if (SHOW_LOGS) {
    console.log('Attack cooldown check:', {
      requireAttackCooldown: rule.requireAttackCooldown,
      attackCdActive: directGameState.attackCdActive,
      isAttackCooldownMet,
    });
  }

  if (!isAttackCooldownMet) {
    if (SHOW_LOGS) console.log('Failed: Attack cooldown requirement not met');
    return false;
  }

  const partyIndex = parseInt(rule.partyPosition, 10) - 1;
  const targetMember = directGameState.partyMembers[partyIndex];

  if (SHOW_LOGS) {
    console.log('Party member check:', {
      rulePartyPosition: rule.partyPosition,
      calculatedIndex: partyIndex,
      targetMemberExists: !!targetMember,
      targetMemberActive: targetMember?.isActive,
      targetMemberHP: targetMember?.hpPercentage,
    });
  }

  if (!targetMember || !targetMember.isActive) {
    if (SHOW_LOGS) console.log('Failed: Target member does not exist or is not active');
    return false;
  }

  const hpTriggerPercentage = parseInt(rule.friendHpTriggerPercentage, 10);
  if (SHOW_LOGS) {
    console.log('HP check:', {
      currentHP: targetMember.hpPercentage,
      triggerThreshold: hpTriggerPercentage,
      shouldHeal: targetMember.hpPercentage <= hpTriggerPercentage,
    });
  }

  if (targetMember.hpPercentage > hpTriggerPercentage || targetMember.hpPercentage === 0) {
    if (SHOW_LOGS) console.log('Failed: HP above threshold');
    return false;
  }

  const manaShieldMet = !rule.requireManaShield || rule.conditions.some((condition) => directGameState.characterStatus[condition.name]);
  if (SHOW_LOGS) {
    console.log('Mana shield check:', {
      requireManaShield: rule.requireManaShield,
      manaShieldMet,
    });
  }

  if (SHOW_LOGS) console.log('Final result: Will heal');
  return manaShieldMet;
};

const filterRulesByConditions = (rules, directGameState) => {
  const filtered = rules.filter((rule) => {
    if (SHOW_LOGS) {
      console.log(`\nChecking conditions for rule ${rule.id}:`);
    }

    if (rule.id.startsWith('manaSync') && !directGameState.attackCdActive) {
      if (SHOW_LOGS) console.log('ManaSync rule rejected: Attack cooldown not active');
      return false;
    }

    if (rule.id.startsWith('healFriend')) {
      const shouldHeal = shouldHealFriend(rule, directGameState);
      if (SHOW_LOGS) console.log('HealFriend rule result:', shouldHeal);
      return shouldHeal;
    }

    const hpCondition = parseMathCondition(rule.hpTriggerCondition, parseInt(rule.hpTriggerPercentage, 10), directGameState.hpPercentage);
    const manaCondition = parseMathCondition(
      rule.manaTriggerCondition,
      parseInt(rule.manaTriggerPercentage, 10),
      directGameState.manaPercentage,
    );
    const statusCondition = areCharStatusConditionsMet(rule, directGameState);
    const monsterCondition = parseMathCondition(rule.monsterNumCondition, parseInt(rule.monsterNum, 10), directGameState.monsterNum);

    if (SHOW_LOGS) {
      console.log('Regular rule conditions:', {
        hpCondition,
        manaCondition,
        statusCondition,
        monsterCondition,
        currentHP: directGameState.hpPercentage,
        currentMana: directGameState.manaPercentage,
        currentMonsters: directGameState.monsterNum,
      });
    }

    return hpCondition && manaCondition && statusCondition && monsterCondition;
  });

  if (SHOW_LOGS) {
    console.log('Rules after condition filtering:', {
      beforeCount: rules.length,
      afterCount: filtered.length,
      passedRuleIds: filtered.map((r) => r.id),
    });
  }

  return filtered;
};

const getAllValidRules = (rules, directGameState) => {
  if (SHOW_LOGS) console.log('\n=== Starting rule validation process ===');

  const enabledRules = filterEnabledRules(rules);
  const rulesWithoutActiveCooldowns = filterRulesByActiveCooldowns(enabledRules, directGameState);
  const rulesNotOnDelay = filterRulesNotOnDelay(rulesWithoutActiveCooldowns);
  const rulesMeetingWalkingConditions = filterRulesByWalkingState(rulesNotOnDelay, directGameState);
  const finalRules = filterRulesByConditions(rulesMeetingWalkingConditions, directGameState).sort((a, b) => b.priority - a.priority);

  if (SHOW_LOGS) {
    console.log('Final valid rules:', {
      count: finalRules.length,
      rules: finalRules.map((r) => ({
        id: r.id,
        priority: r.priority,
        category: r.category,
      })),
    });
  }

  return finalRules;
};

const getHighestPriorityRulesByCategory = (rules) => {
  const categoryMap = new Map();

  if (SHOW_LOGS) console.log('\n=== Finding highest priority rules by category ===');

  for (const rule of rules) {
    if (!categoryMap.has(rule.category) || rule.priority > categoryMap.get(rule.category).priority) {
      if (SHOW_LOGS) {
        console.log(`Updated highest priority rule for category ${rule.category}:`, {
          ruleId: rule.id,
          priority: rule.priority,
          previousPriority: categoryMap.get(rule.category)?.priority,
        });
      }
      categoryMap.set(rule.category, rule);
    }
  }

  const result = Array.from(categoryMap.values());

  if (SHOW_LOGS) {
    console.log('Final highest priority rules:', {
      totalCategories: categoryMap.size,
      rules: result.map((r) => ({
        category: r.category,
        ruleId: r.id,
        priority: r.priority,
      })),
    });
  }

  return result;
};

const executeHealFriendRule = (rule, directGameState, global) => {
  if (SHOW_LOGS) console.log('\n=== executeHealFriendRule execution ===');

  const partyIndex = parseInt(rule.partyPosition, 10) - 1;
  const targetMember = directGameState.partyMembers[partyIndex];

  if (!targetMember || !targetMember.isActive) {
    if (SHOW_LOGS) console.log('Failed: Target member does not exist or is not active');
    return false;
  }

  const hpTriggerPercentage = parseInt(rule.friendHpTriggerPercentage, 10);
  if (targetMember.hpPercentage > hpTriggerPercentage) {
    if (SHOW_LOGS) console.log('Failed: HP above threshold');
    return false;
  }

  const now = Date.now();
  let executed = false;

  if (rule.useRune) {
    if (canExecuteKeypress()) {
      if (SHOW_LOGS) {
        console.log('Executing rune heal:', {
          targetX: targetMember.uhCoordinates.x,
          targetY: targetMember.uhCoordinates.y,
          key: rule.key,
        });
      }

      useItemOnCoordinates(
        global.windowId,
        targetMember.uhCoordinates.x + getRandomNumber(0, 130),
        targetMember.uhCoordinates.y + getRandomNumber(0, 11),
        rule.key,
      );
      lastKeypressTime = now;
      executed = true;
    } else {
      if (SHOW_LOGS) console.log('Skipped: Keypress on cooldown');
    }
  } else {
    executed = executeRateLimitedKeyPress(global.windowId, [rule.key], rule);
  }

  if (executed) {
    lastRuleExecutionTimes[rule.id] = now;
    lastCategoriesExecutionTimes[rule.category] = now;
    if (SHOW_LOGS) {
      console.log('Heal execution successful:', {
        ruleId: rule.id,
        category: rule.category,
        timestamp: now,
      });
    }
  }

  return executed;
};

const scheduleManaSyncExecution = (manaSyncRules, global) => {
  if (SHOW_LOGS) {
    console.log('\n=== Scheduling ManaSync execution ===', {
      existingTimeout: !!manaSyncTimeoutId,
      rulesCount: manaSyncRules.length,
      delay: customManaSyncDelay,
    });
  }

  if (manaSyncTimeoutId) {
    if (SHOW_LOGS) console.log('Clearing existing manaSync timeout');
    clearTimeout(manaSyncTimeoutId);
  }

  manaSyncTimeoutId = setTimeout(() => {
    if (SHOW_LOGS) console.log('ManaSync timeout triggered, attempting execution');

    if (canExecuteKeypress()) {
      const executionTime = Date.now();

      manaSyncRules.forEach((rule) => {
        lastRuleExecutionTimes[rule.id] = executionTime;
        lastCategoriesExecutionTimes[rule.category] = executionTime;
        if (SHOW_LOGS) {
          console.log(`Executing manaSync for rule: ${rule.id}`, {
            key: rule.key,
            category: rule.category,
            timestamp: executionTime,
          });
        }
        keyPressManaSync(global.windowId, rule.key, 2);
      });

      lastKeypressTime = executionTime;
      lastManaSyncExecutionTime = executionTime;

      if (SHOW_LOGS) {
        console.log('ManaSync execution completed:', {
          executionTime,
          rulesExecuted: manaSyncRules.length,
        });
      }
    } else {
      if (SHOW_LOGS) console.log('ManaSync execution skipped: keypress cooldown active');
    }

    manaSyncTimeoutId = null;
    manaSyncScheduled = false;
  }, customManaSyncDelay);

  manaSyncScheduled = true;

  if (SHOW_LOGS) {
    console.log('ManaSync scheduled:', {
      delay: customManaSyncDelay,
      scheduledTime: Date.now() + customManaSyncDelay,
    });
  }
};

export const processRules = async (activePreset, directGameState, global) => {
  if (SHOW_LOGS) {
    console.log('\n=== Starting rule processing ===', {
      timestamp: Date.now(),
      presetRules: activePreset.length,
      attackCooldownActive: directGameState.attackCdActive,
    });
  }

  const validRules = getAllValidRules(activePreset, directGameState);
  const highestPriorityRules = getHighestPriorityRulesByCategory(validRules);

  if (highestPriorityRules.length > 0) {
    if (SHOW_LOGS) {
      console.log('Processing highest priority rules:', {
        totalRules: highestPriorityRules.length,
        ruleIds: highestPriorityRules.map((r) => r.id),
      });
    }

    const manaSyncRules = highestPriorityRules.filter((rule) => rule.id.startsWith('manaSync'));
    const healFriendRules = highestPriorityRules.filter((rule) => rule.id.startsWith('healFriend'));
    const regularRules = highestPriorityRules.filter((rule) => !rule.id.startsWith('manaSync') && !rule.id.startsWith('healFriend'));

    if (SHOW_LOGS) {
      console.log('Rules categorization:', {
        manaSyncRules: manaSyncRules.length,
        healFriendRules: healFriendRules.length,
        regularRules: regularRules.length,
      });
    }

    let executeManaSyncThisRotation = true;

    // Process healFriend rules in priority order
    for (const healFriendRule of healFriendRules) {
      if (SHOW_LOGS) {
        console.log(`Processing healFriend rule: ${healFriendRule.id}`, {
          priority: healFriendRule.priority,
        });
      }

      const healExecuted = executeHealFriendRule(healFriendRule, directGameState, global);
      if (healExecuted) {
        if (SHOW_LOGS) console.log('Heal executed successfully, skipping manaSync for this rotation');
        executeManaSyncThisRotation = false;
        break;
      }
    }

    // Process regular rules
    if (regularRules.length > 0) {
      if (SHOW_LOGS) {
        console.log('Processing regular rules:', {
          count: regularRules.length,
          rules: regularRules.map((r) => ({
            id: r.id,
            key: r.key,
          })),
        });
      }

      const regularRuleKeys = regularRules.map((rule) => rule.key);

      regularRules.forEach((rule, index) => {
        if (SHOW_LOGS) {
          console.log(`Attempting to execute regular rule: ${rule.id}`, {
            key: regularRuleKeys[index],
          });
        }

        if (executeRateLimitedKeyPress(global.windowId, [regularRuleKeys[index]], rule)) {
          const now = Date.now();
          lastRuleExecutionTimes[rule.id] = now;
          lastCategoriesExecutionTimes[rule.category] = now;

          if (SHOW_LOGS) {
            console.log(`Regular rule executed successfully: ${rule.id}`, {
              timestamp: now,
              category: rule.category,
            });
          }
        }
      });
    }

    // Handle manaSync scheduling
    if (directGameState.attackCdActive !== lastAttackCooldownState) {
      if (SHOW_LOGS) {
        console.log('Attack cooldown state changed:', {
          previous: lastAttackCooldownState,
          current: directGameState.attackCdActive,
        });
      }

      if (directGameState.attackCdActive) {
        attackCooldownStartTime = Date.now();

        if (SHOW_LOGS) {
          console.log('Attack cooldown started:', {
            startTime: attackCooldownStartTime,
            manaSyncRulesAvailable: manaSyncRules.length > 0,
            manaSyncScheduled,
            executeManaSyncThisRotation,
          });
        }

        if (manaSyncRules.length > 0 && !manaSyncScheduled && executeManaSyncThisRotation) {
          scheduleManaSyncExecution(manaSyncRules, global);
        }
      } else {
        if (manaSyncTimeoutId) {
          if (SHOW_LOGS) console.log('Clearing manaSync timeout due to cooldown state change');
          clearTimeout(manaSyncTimeoutId);
          manaSyncTimeoutId = null;
          manaSyncScheduled = false;
        }
      }
    }
  } else {
    if (SHOW_LOGS) console.log('No valid rules to process');
  }

  lastAttackCooldownState = directGameState.attackCdActive;
};
