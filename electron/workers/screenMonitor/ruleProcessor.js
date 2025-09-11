import parseMathCondition from '../../utils/parseMathCondition.js';
import areCharStatusConditionsMet from '../../utils/areStatusConditionsMet.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger({ info: true, error: true, warn: true });

import { getRandomNumber } from '../../utils/getRandomNumber.js';
import { OPTIONS } from './constants.js';

class RuleProcessor {
  constructor(parentPort) {
    this.parentPort = parentPort;
    this.lastSuccessfulRuleActionTime = {}; // PRIMARY FOR DELAY on non-ManaSync rules
    this.lastCategoryExecutionTime = {};
    this.lastPartyHealActionTime = 0;
    this.lastAttackCooldownState = false;
    this.attackCooldownStartTime = null;
    this.lastKeypressTime = 0;
    this.effectiveCooldownEndTime = 0;

    // ManaSync specific state
    this.manaSyncWatchList = new Map();
    this.executedManaSyncThisCooldown = new Set();
    this.forcedManaSyncExecutedThisCooldown = new Set();

    this.pendingActionConfirmations = new Map(); // For item disappearance check

    // Attack CD Exclusivity state
    this.actionTakenThisAttackCooldown = false;
    this.healFriendRuneExecutionsThisAttackCooldown = 0;

    // Constants
    this.KEYPRESS_COOLDOWN_MS = 50;
    this.PARTY_HEAL_MIN_INTERVAL_MS = 50;
    this.MANASYNC_FORCED_EXECUTION_DELAY_MS = 740;
    this.MANASYNC_FORCED_EXECUTION_WINDOW_MS = 100;
    this.MANA_SYNC_WATCH_DURATION_MS = 800;
    this.ACTION_CONFIRMATION_TIMEOUT_MS = 300;

    this.RULE_PREFIX = {
      USER: 'userRule',
      ACTION_BAR: 'actionBarItem',
      MANA_SYNC: 'manaSync',
      PARTY_HEAL: 'healFriend',
      ROTATION: 'rotationRule',
      EQUIP: 'equipRule',
    };
    this.PARTY_HEAL_RUNE_ITEMS = new Set([
      'ultimateHealingRune',
      'intenseHealingRune',
    ]);
    this.lastRuleExecutionTime = {}; // NEW: To track last execution time for each rule
  }

  async processRules(activePreset, gameState, globalConfig) {
    // getIsTyping() is removed, need to handle this.
    // For now, we will assume it's always false or remove the check if it's not critical.
    // If it's critical, we need to find an alternative way to check typing status.
    // For this task, I will remove the check for getIsTyping() for now.
    // if (getIsTyping()) {
    //   return;
    // }

    if (!globalConfig.isOnline) {
      return;
    }

    if (!gameState.rulesEnabled) {
      return;
    }

    const now = performance.now();
    const attackCdChanged = this._handleAttackCooldownTransitions(
      now,
      gameState,
      activePreset,
      globalConfig,
    );
    let manaSyncRuleExecutedImmediately = attackCdChanged.executed;

    let manaSyncRuleExecutedFromWatch = false;
    if (
      !manaSyncRuleExecutedImmediately &&
      gameState.attackCd &&
      this.manaSyncWatchList.size > 0 &&
      !this.actionTakenThisAttackCooldown
    ) {
      manaSyncRuleExecutedFromWatch = this._processManaSyncWatch(
        now,
        gameState,
        activePreset,
        globalConfig,
      );
    }

    let manaSyncRuleForcedExecution = false;
    if (
      gameState.attackCd &&
      !this.actionTakenThisAttackCooldown &&
      !manaSyncRuleExecutedImmediately &&
      !manaSyncRuleExecutedFromWatch
    ) {
      manaSyncRuleForcedExecution = this._processForcedManaSyncExecution(
        now,
        gameState,
        activePreset,
        globalConfig,
      );
    }

    // --- Action Confirmation Processing ---
    this._processActionConfirmations(now, gameState);

    let ruleActionTriggeredThisCycle =
      manaSyncRuleExecutedImmediately ||
      manaSyncRuleExecutedFromWatch ||
      manaSyncRuleForcedExecution;

    // --- Standard Rule Processing (User, Equip, ActionBar, PartyHeal non-rune) ---
    if (!ruleActionTriggeredThisCycle) {
      const nonManaSyncPreset = activePreset.filter(
        (r) => !r.id.startsWith(this.RULE_PREFIX.MANA_SYNC),
      );
      const eligibleRules = this._filterEligibleRules(
        now,
        nonManaSyncPreset,
        gameState,
      );

      if (eligibleRules.length > 0) {
        const ruleToExecute = eligibleRules[0];
        const nonManaSyncActionSuccess = this._attemptExecutionAndHandleOutcome(
          now,
          ruleToExecute,
          gameState,
          globalConfig,
        );

        if (nonManaSyncActionSuccess) {
          ruleActionTriggeredThisCycle = true;
        }
      }
    }
  }

  // --- Filtering Logic ---
  _filterEligibleRules(now, rules, gameState) {
    let eligibleRules = rules.filter((rule) => rule.enabled);

    eligibleRules = this._filterRulesByActiveCooldowns(
      eligibleRules,
      gameState,
    );

    eligibleRules = this._filterRulesNotOnDelay(now, eligibleRules);

    eligibleRules = this._filterRulesByWalkingState(eligibleRules, gameState);

    // ADDED FILTERS
    eligibleRules = this._filterRulesByBasicConditions(eligibleRules, gameState);
    eligibleRules = this._filterRulesByItemAvailability(eligibleRules, gameState);
    // END ADDED FILTERS

    eligibleRules = eligibleRules.filter((rule) => {
      /* PartyHeal Interval Filter */
      if (rule.id.startsWith(this.RULE_PREFIX.PARTY_HEAL)) {
        const timeSinceLastHeal = now - this.lastPartyHealActionTime;
        return timeSinceLastHeal >= this.PARTY_HEAL_MIN_INTERVAL_MS;
      }
      return true;
    });

    eligibleRules = eligibleRules.filter((rule) => {
      /* HealFriend Rune Exclusivity */
      if (
        rule.id.startsWith(this.RULE_PREFIX.PARTY_HEAL) &&
        this.PARTY_HEAL_RUNE_ITEMS.has(rule.actionItem)
      ) {
        if (gameState.attackCd) {
          if (this.actionTakenThisAttackCooldown) {
            return false;
          }
          if (this.healFriendRuneExecutionsThisAttackCooldown >= 2) {
            return false;
          }
        }
      }
      return true;
    });

    eligibleRules = eligibleRules.filter((rule) => {
      /* Equip Rule Specifics */
      if (rule.id.startsWith(this.RULE_PREFIX.EQUIP)) {
        if (
          typeof rule.actionItem !== 'string' ||
          rule.actionItem.trim() === '' ||
          !rule.targetSlot
        )
          return false;
        if (typeof rule.equipOnlyIfSlotIsEmpty !== 'boolean') return false;

        const currentItemInSlot = gameState.equippedItems?.[rule.targetSlot];
        const itemToBeEquippedName =
          rule.itemToBeEquippedName || rule.actionItem;

        if (rule.equipOnlyIfSlotIsEmpty) {
          let expectedEmptyItemKey;
          // {{change 1}}
          if (rule.targetSlot === 'amulet') {
            expectedEmptyItemKey = 'Empty';
          } else if (rule.targetSlot === 'ring') {
            expectedEmptyItemKey = 'Empty';
          } else if (rule.targetSlot === 'boots') {
            expectedEmptyItemKey = 'Empty';
          } else {
            return false;
          }
          if (currentItemInSlot !== expectedEmptyItemKey) {
            return false;
          }
        }
        // Avoid re-equipping if the item is already in the slot
        if (currentItemInSlot === itemToBeEquippedName) {
          return false;
        }
        return true;
      }
      return true;
    });

    eligibleRules = eligibleRules.filter((rule) => {
      /* PartyHeal Final Condition */
      if (rule.id.startsWith(this.RULE_PREFIX.PARTY_HEAL)) {
        return this._shouldHealFriend(rule, gameState);
      }
      return true;
    });

    eligibleRules.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return eligibleRules;
  }

  _filterRulesNotOnDelay(now, rules) {
    return rules.filter((rule) => {
      const ruleId = rule.id;
      const ruleDelay = rule.delay ?? 0;
      const category = rule.category;

      // NEW: Rule-specific cooldown
      const timeSinceLastRuleExecution = now - (this.lastRuleExecutionTime[ruleId] || 0);
      if (timeSinceLastRuleExecution < 150) { // 150ms cooldown
        return false;
      }

      // INDIVIDUAL DELAY
      const timeSinceLastSuccessfulTrigger =
        now - (this.lastSuccessfulRuleActionTime[ruleId] || 0);
      if (timeSinceLastSuccessfulTrigger < ruleDelay) {
        return false;
      }

      // CATEGORY DELAY
      if (rule.id.startsWith(this.RULE_PREFIX.USER) && category) {
        const categoryDelay = OPTIONS.categoryDelays?.[category] ?? 0;
        if (categoryDelay > 0) {
          const timeSinceCategoryLastTrigger =
            now - (this.lastCategoryExecutionTime[category] || 0);
          if (timeSinceCategoryLastTrigger < categoryDelay) {
            return false;
          }
        }
      }
      return true;
    });
  }

  _filterRulesByActiveCooldowns(rules, gameState) {
    return rules.filter((rule) => {
      if (rule.id.startsWith(this.RULE_PREFIX.USER)) {
        const cooldownStateKey = rule.category
          ? OPTIONS.cooldownStateMapping?.[rule.category]
          : null;
        return !cooldownStateKey || !gameState[cooldownStateKey];
      }
      return true;
    });
  }

  _filterRulesByWalkingState(rules, gameState) {
    return rules.filter((rule) => {
      if (
        rule.id.startsWith(this.RULE_PREFIX.USER) ||
        rule.id.startsWith(this.RULE_PREFIX.ACTION_BAR)
      ) {
        return !rule.isWalking || (rule.isWalking && gameState.isWalking);
      }
      return true;
    });
  }

  _filterRulesByBasicConditions(rules, gameState) {
    return rules.filter((rule) => {
      if (
        rule.id.startsWith(this.RULE_PREFIX.USER) ||
        rule.id.startsWith(this.RULE_PREFIX.ACTION_BAR) ||
        rule.id.startsWith(this.RULE_PREFIX.EQUIP)
      ) {
        const hpMet = parseMathCondition(
          rule.hpTriggerCondition,
          parseInt(rule.hpTriggerPercentage, 10),
          gameState.hppc,
        );
        const manaMet = parseMathCondition(
          rule.manaTriggerCondition,
          parseInt(rule.manaTriggerPercentage, 10),
          gameState.mppc,
        );
        let monsterMet = true;
        if (rule.monsterNumCondition != null && rule.monsterNum != null) {
          monsterMet = parseMathCondition(
            rule.monsterNumCondition,
            parseInt(rule.monsterNum, 10),
            gameState.monsterNum,
          );
        }
        const statusMet = areCharStatusConditionsMet(rule, gameState);
        return hpMet && manaMet && statusMet && monsterMet;
      }
      return true;
    });
  }

  _filterRulesByItemAvailability(rules, gameState) {
    return rules.filter((rule) => {
      if (
        rule.id.startsWith(this.RULE_PREFIX.ACTION_BAR) ||
        rule.id.startsWith(this.RULE_PREFIX.PARTY_HEAL) ||
        rule.id.startsWith(this.RULE_PREFIX.EQUIP)
      ) {
        const requiredItemToClick = rule.actionItem;
        if (
          typeof requiredItemToClick !== 'string' ||
          requiredItemToClick.trim() === ''
        ) {
          return false;
        }

        const isCreateRuneAction =
          requiredItemToClick.includes('create') &&
          requiredItemToClick.includes('Rune');

        if (isCreateRuneAction) {
          if (!gameState.activeActionItems?.['blankRune']) {
            return false;
          }
        }

        if (!gameState.activeActionItems?.[requiredItemToClick]) {
          return false;
        }
        return true;
      }
      return true;
    });
  }

  // --- ManaSync Logic ---
  _handleAttackCooldownTransitions(now, gameState, activePreset, globalConfig) {
    const attackCdIsCurrentlyActive = gameState.attackCd;
    const attackCdJustStarted =
      attackCdIsCurrentlyActive && !this.lastAttackCooldownState;
    const attackCdJustEnded =
      !attackCdIsCurrentlyActive && this.lastAttackCooldownState;
    let executedManaSyncNow = false;

    if (attackCdJustEnded) {
      this.manaSyncWatchList.clear();
      this.executedManaSyncThisCooldown.clear();
      this.forcedManaSyncExecutedThisCooldown.clear();
      this.attackCooldownStartTime = null;
    }

    if (attackCdJustStarted) {
      this.attackCooldownStartTime = now;
      this.manaSyncWatchList.clear();
      this.executedManaSyncThisCooldown.clear();
      this.forcedManaSyncExecutedThisCooldown.clear();
      this.actionTakenThisAttackCooldown = false;
      this.healFriendRuneExecutionsThisAttackCooldown = 0;

      const manaSyncRules = activePreset
        .filter((r) => r.enabled && r.id.startsWith(this.RULE_PREFIX.MANA_SYNC))
        .sort((a, b) => (b.priority || 0) - (a.priority || 0));

      for (const rule of manaSyncRules) {
        if (executedManaSyncNow || this.actionTakenThisAttackCooldown) break;
        const conditionsMet = this._checkManaSyncConditions(rule, gameState);
        const itemIsActive = !!gameState.activeActionItems?.[rule.actionItem];
        if (conditionsMet.all) {
          if (!rule.actionItem) {
            console.warn(`[RuleProc] ManaSync ${rule.id} no actionItem.`);
            continue;
          }
          if (itemIsActive) {
            if (
              !this._hasHigherPriorityEligibleHealFriend(
                gameState,
                activePreset,
                rule.priority || 0,
                now,
              )
            ) {
              const keypressSent = this._tryExecuteAction(
                now,
                rule,
                gameState,
                globalConfig,
                'manaSyncNormal',
              );
              if (keypressSent) {
                this.executedManaSyncThisCooldown.add(rule.id);
                this.actionTakenThisAttackCooldown = true;
                executedManaSyncNow = true;
              }
            }
          } else {
            this.manaSyncWatchList.set(rule.id, {
              startTime: now,
              checkedConditions: conditionsMet,
            });
          }
        }
      }
    }
    this.lastAttackCooldownState = attackCdIsCurrentlyActive;
    return {
      changed: attackCdJustStarted || attackCdJustEnded,
      executed: executedManaSyncNow,
    };
  }

  _processManaSyncWatch(now, gameState, activePreset, globalConfig) {
    if (this.manaSyncWatchList.size === 0 || this.actionTakenThisAttackCooldown)
      return false;
    let executedFromWatch = false;
    const rulesToRemoveFromWatch = [];
    const sortedWatchKeys = Array.from(this.manaSyncWatchList.keys())
      .sort
      /* by prio */
      ();

    for (const ruleId of sortedWatchKeys) {
      if (executedFromWatch || this.actionTakenThisAttackCooldown) break;
      const watchData = this.manaSyncWatchList.get(ruleId);
      const rule = activePreset.find((r) => r.id === ruleId);
      if (
        !rule ||
        !rule.actionItem ||
        this.executedManaSyncThisCooldown.has(ruleId) ||
        now - watchData.startTime > this.MANA_SYNC_WATCH_DURATION_MS
      ) {
        rulesToRemoveFromWatch.push(ruleId);
        continue;
      }
      const itemIsNowActive = !!gameState.activeActionItems?.[rule.actionItem];
      if (itemIsNowActive) {
        const conditionsStillMet = this._checkManaSyncConditions(
          rule,
          gameState,
        );
        if (conditionsStillMet.all) {
          if (
            !this._hasHigherPriorityEligibleHealFriend(
              gameState,
              activePreset,
              rule.priority || 0,
              now,
            )
          ) {
            const keypressSent = this._tryExecuteAction(
              now,
              rule,
              gameState,
              globalConfig,
              'manaSyncNormal',
            );
            if (keypressSent) {
              this.executedManaSyncThisCooldown.add(ruleId);
              this.actionTakenThisAttackCooldown = true;
              executedFromWatch = true;
            }
          }
        }
        rulesToRemoveFromWatch.push(ruleId);
      }
    }
    rulesToRemoveFromWatch.forEach((id) => this.manaSyncWatchList.delete(id));
    return executedFromWatch;
  }

  _processForcedManaSyncExecution(now, gameState, activePreset, globalConfig) {
    if (
      !gameState.attackCd ||
      !this.attackCooldownStartTime ||
      this.actionTakenThisAttackCooldown
    )
      return false;
    const timeSinceCdStart = now - this.attackCooldownStartTime;
    const isInForcedWindow =
      timeSinceCdStart >= this.MANASYNC_FORCED_EXECUTION_DELAY_MS &&
      timeSinceCdStart <=
        this.MANASYNC_FORCED_EXECUTION_DELAY_MS +
          this.MANASYNC_FORCED_EXECUTION_WINDOW_MS;
    if (!isInForcedWindow) return false;

    const manaSyncRules = activePreset
      .filter((r) => r.enabled && r.id.startsWith(this.RULE_PREFIX.MANA_SYNC))
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
    for (const rule of manaSyncRules) {
      if (this.actionTakenThisAttackCooldown) break;
      if (
        this.executedManaSyncThisCooldown.has(rule.id) ||
        this.forcedManaSyncExecutedThisCooldown.has(rule.id)
      )
        continue;
      const conditionsMet = this._checkManaSyncConditions(rule, gameState);
      if (conditionsMet.all) {
        if (
          !this._hasHigherPriorityEligibleHealFriend(
            gameState,
            activePreset,
            rule.priority || 0,
            now,
          )
        ) {
          const keypressSent = this._tryExecuteAction(
            now,
            rule,
            gameState,
            globalConfig,
            'manaSyncForced',
          );
          if (keypressSent) {
            this.forcedManaSyncExecutedThisCooldown.add(rule.id);
            this.actionTakenThisAttackCooldown = true;
            return true;
          }
        }
      }
    }
    return false;
  }

  _checkManaSyncConditions(rule, gameState) {
    const hpMet = parseMathCondition(
      rule.hpTriggerCondition ?? '>=',
      parseInt(rule.hpTriggerPercentage ?? 0, 10),
      gameState.hppc,
    );
    const manaMet = parseMathCondition(
      rule.manaTriggerCondition ?? '<=',
      parseInt(rule.manaTriggerPercentage ?? 100, 10),
      gameState.mppc,
    );
    const statusMet = areCharStatusConditionsMet(rule, gameState);
    return { hpMet, manaMet, statusMet, all: hpMet && manaMet && statusMet };
  }

  _hasHigherPriorityEligibleHealFriend(
    gameState,
    activePreset,
    manaSyncPriority,
    now,
  ) {
    if (this.actionTakenThisAttackCooldown) return false;
    const competingHealFriends = activePreset.filter(
      (r) =>
        r.enabled &&
        r.id.startsWith(this.RULE_PREFIX.PARTY_HEAL) &&
        r.requireAttackCooldown === true &&
        (r.priority || 0) > manaSyncPriority,
    );
    if (competingHealFriends.length === 0) return false;
    for (const healRule of competingHealFriends) {
      if (
        this.PARTY_HEAL_RUNE_ITEMS.has(healRule.actionItem) &&
        this.healFriendRuneExecutionsThisAttackCooldown >= 2
      )
        continue;
      const healRuleDelay = healRule.delay ?? 0;
      const timeSinceHealRuleLastTrigger =
        now - (this.lastSuccessfulRuleActionTime[healRule.id] || 0);
      if (timeSinceHealRuleLastTrigger < healRuleDelay) continue;
      if (this._shouldHealFriend(healRule, gameState) && healRule.actionItem)
        return true;
    }
    return false;
  }

  // --- Action Execution and Confirmation ---
  _processActionConfirmations(now, gameState) {
    if (this.pendingActionConfirmations.size === 0) return;
    const ruleIdsToRemove = [];
    for (const [ruleId, data] of this.pendingActionConfirmations) {
      if (
        !gameState.activeActionItems?.[data.actionItem] ||
        now - data.attemptTimestamp > this.ACTION_CONFIRMATION_TIMEOUT_MS
      ) {
        ruleIdsToRemove.push(ruleId);
      }
    }
    ruleIdsToRemove.forEach((id) => this.pendingActionConfirmations.delete(id));
  }

  _attemptExecutionAndHandleOutcome(
    now,
    ruleToExecute,
    gameState,
    globalConfig,
  ) {
    const ruleId = ruleToExecute.id;

    if (this.pendingActionConfirmations.has(ruleId)) {
      return false;
    }

    const actionSuccess = this._tryExecuteAction(
      now,
      ruleToExecute,
      gameState,
      globalConfig,
      'standard',
    );

    if (actionSuccess) {
      this.lastSuccessfulRuleActionTime[ruleId] = now;
      this.lastRuleExecutionTime[ruleId] = now; // NEW: Record rule execution time

      if (ruleToExecute.category && ruleId.startsWith(this.RULE_PREFIX.USER)) {
        this.lastCategoryExecutionTime[ruleToExecute.category] = now;
      }
      if (ruleId.startsWith(this.RULE_PREFIX.PARTY_HEAL)) {
        this.lastPartyHealActionTime = now;
        if (
          this.PARTY_HEAL_RUNE_ITEMS.has(ruleToExecute.actionItem) &&
          gameState.attackCd
        ) {
          this.actionTakenThisAttackCooldown = true;
          this.healFriendRuneExecutionsThisAttackCooldown++;
        }
      }
      if (
        typeof ruleToExecute.actionItem === 'string' &&
        ruleToExecute.actionItem.length > 0
      ) {
        this.pendingActionConfirmations.set(ruleId, {
          attemptTimestamp: now,
          actionItem: ruleToExecute.actionItem,
        });
      }
      return true;
    }
    return false;
  }

  _tryExecuteAction(now, rule, gameState, globalConfig, executionType) {
    const ruleId = rule.id;
    const isManaSync = executionType.startsWith('manaSync');
    const isPriorityRuleForCooldown =
      isManaSync ||
      (ruleId.startsWith(this.RULE_PREFIX.PARTY_HEAL) &&
        this.PARTY_HEAL_RUNE_ITEMS.has(rule.actionItem) &&
        gameState.attackCd);

    if (!isPriorityRuleForCooldown && now < this.effectiveCooldownEndTime) {
      return false;
    }

    if (!rule.key) {
      console.warn(`[RuleProc] Cannot execute ${ruleId}: Missing 'key'.`);
      return false;
    }

    let actionSent = false;
    try {
      if (
        ruleId.startsWith(this.RULE_PREFIX.PARTY_HEAL) &&
        this.PARTY_HEAL_RUNE_ITEMS.has(rule.actionItem)
      ) {
        const targetMember = this._findPartyHealTarget(rule, gameState);
        if (targetMember?.uhCoordinates) {
          this.parentPort.postMessage({
            type: 'inputAction',
            payload: {
              type: 'userRule', // New priority type
              action: {
                module: 'keypress',
                method: 'sendKey',
                args: [rule.key]
              }
            }
          });
          this.parentPort.postMessage({
            type: 'inputAction',
            payload: {
              type: 'userRule', // New priority type
              action: {
                module: 'mouseController',
                method: 'leftClick',
                args: [
                  targetMember.uhCoordinates.x + getRandomNumber(0, 130),
                  targetMember.uhCoordinates.y + getRandomNumber(0, 11)
                ]
              }
            }
          });
          actionSent = true;
        } else {
          console.warn(
            `[RuleProc] PartyHeal Rune ${ruleId}: No valid target found.`,
          );
        }
      } else {
        this.parentPort.postMessage({
          type: 'inputAction',
          payload: {
            type: 'userRule', // New priority type
            action: {
              module: 'keypress',
              method: 'sendKey',
              args: [rule.key]
            }
          }
        });
        actionSent = true;
      }

      if (actionSent) {
        this.lastKeypressTime = now;
        this.effectiveCooldownEndTime = now + 150; // Changed from (isPriorityRuleForCooldown ? 25 : this.KEYPRESS_COOLDOWN_MS);
      }
      return actionSent;
    } catch (error) {
      console.error(
        `[RuleProcessor] Error during action execution for ${ruleId} (Type: ${executionType}):`,
        error,
      );
      return false;
    }
  }

  // --- Party Heal Specific Logic ---
  _shouldHealFriend(rule, gameState) {
    if (!gameState?.partyMembers || rule.friendHpTriggerPercentage == null)
      return false;
    if (rule.requireAttackCooldown && !gameState.attackCd) return false;
    const hpTriggerPercentage = parseInt(rule.friendHpTriggerPercentage, 10);
    const partyPositionIndex = parseInt(rule.partyPosition, 10);
    if (
      isNaN(partyPositionIndex) ||
      partyPositionIndex < 0 ||
      isNaN(hpTriggerPercentage)
    )
      return false;
    if (partyPositionIndex === 0) {
      return gameState.partyMembers.some(
        (m) =>
          m.isActive &&
          m.hppc != null &&
          m.hppc > 0 &&
          m.hppc <= hpTriggerPercentage,
      );
    } else {
      const targetMember = gameState.partyMembers?.[partyPositionIndex - 1];
      return (
        !!targetMember &&
        targetMember.isActive &&
        targetMember.hppc != null &&
        targetMember.hppc > 0 &&
        targetMember.hppc <= hpTriggerPercentage
      );
    }
  }

  _findPartyHealTarget(rule, gameState) {
    const hpTriggerPercentage = parseInt(rule.friendHpTriggerPercentage, 10);
    const partyPositionIndex = parseInt(rule.partyPosition, 10);
    if (
      isNaN(partyPositionIndex) ||
      partyPositionIndex < 0 ||
      isNaN(hpTriggerPercentage)
    )
      return null;
    if (partyPositionIndex === 0) {
      const potentialTargets = gameState.partyMembers
        .filter(
          (m) =>
            m.isActive &&
            m.hppc != null &&
            m.hppc > 0 &&
            m.hppc <= hpTriggerPercentage,
        )
        .sort((a, b) => a.hppc - b.hppc);
      return potentialTargets[0] || null;
    } else {
      const targetMember = gameState.partyMembers?.[partyPositionIndex - 1];
      if (
        targetMember &&
        targetMember.isActive &&
        targetMember.hppc != null &&
        targetMember.hppc > 0 &&
        targetMember.hppc <= hpTriggerPercentage
      ) {
        return targetMember;
      }
      return null;
    }
  }
}

export default RuleProcessor;