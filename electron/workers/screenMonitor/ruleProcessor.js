// screenMonitor/ruleProcessor.js
import parseMathCondition from '../../utils/parseMathCondition.js';
import areCharStatusConditionsMet from '../../utils/areStatusConditionsMet.js';
import { keyPress, keyPressManaSync } from '../../keyboardControll/keyPress.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger({ info: true, error: true, warn: true });

import useItemOnCoordinates from '../../mouseControll/useItemOnCoordinates.js';
import { getRandomNumber } from '../../utils/getRandomNumber.js';
import { OPTIONS } from './constants.js';
import { config } from './modules/config.js';

class RuleProcessor {
  constructor() {
    this.lastSuccessfulRuleActionTime = {}; // PRIMARY FOR DELAY on non-ManaSync rules
    this.lastCategoryExecutionTime = {};
    this.lastPartyHealActionTime = 0;
    this.lastAttackCooldownState = false;
    this.attackCooldownStartTime = null;
    this.lastKeypressTime = 0;
    this.effectiveCooldownEndTime = 0;

    // ManaSync specific state (from V1)
    this.manaSyncWatchList = new Map();
    this.executedManaSyncThisCooldown = new Set();
    this.forcedManaSyncExecutedThisCooldown = new Set();

    this.pendingActionConfirmations = new Map(); // For item disappearance check

    // Attack CD Exclusivity state (from V1)
    this.actionTakenThisAttackCooldown = false;
    this.healFriendRuneExecutionsThisAttackCooldown = 0;

    // Constants (from V1)
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
    this.PARTY_HEAL_RUNE_ITEMS = new Set(['ultimateHealingRune', 'intenseHealingRune']);
  }

  async processRules(activePreset, gameState, globalConfig) {
    const logSteps = config.logging.logRuleProcessingSteps;
    const logExec = config.logging.logRuleExecutionDetails;
    const now = Date.now();

    if (logSteps) console.log(`[RuleProc] --- Cycle Start (Time: ${now}) ---`);

    // --- ManaSync Processing (largely V1 logic) ---
    const attackCdChanged = this._handleAttackCooldownTransitions(now, gameState, activePreset, globalConfig);
    let manaSyncRuleExecutedImmediately = attackCdChanged.executed;

    let manaSyncRuleExecutedFromWatch = false;
    if (
      !manaSyncRuleExecutedImmediately &&
      gameState.attackCd &&
      this.manaSyncWatchList.size > 0 &&
      !this.actionTakenThisAttackCooldown
    ) {
      manaSyncRuleExecutedFromWatch = this._processManaSyncWatch(now, gameState, activePreset, globalConfig);
    }

    let manaSyncRuleForcedExecution = false;
    if (
      gameState.attackCd &&
      !this.actionTakenThisAttackCooldown &&
      !manaSyncRuleExecutedImmediately &&
      !manaSyncRuleExecutedFromWatch
    ) {
      // Ensure no other mana sync ran
      manaSyncRuleForcedExecution = this._processForcedManaSyncExecution(now, gameState, activePreset, globalConfig);
    }

    // --- Action Confirmation Processing ---
    this._processActionConfirmations(now, gameState);

    let ruleActionTriggeredThisCycle = manaSyncRuleExecutedImmediately || manaSyncRuleExecutedFromWatch || manaSyncRuleForcedExecution;

    // --- Standard Rule Processing (User, Equip, ActionBar, PartyHeal non-rune) ---
    if (!ruleActionTriggeredThisCycle) {
      if (logSteps) console.log('[RuleProc] Evaluating non-ManaSync rules for execution...');
      const nonManaSyncPreset = activePreset.filter((r) => !r.id.startsWith(this.RULE_PREFIX.MANA_SYNC));
      const eligibleRules = this._filterEligibleRules(now, nonManaSyncPreset, gameState);

      if (eligibleRules.length > 0) {
        const ruleToExecute = eligibleRules[0];
        if (logExec)
          console.log(
            `[RuleProc] Attempting highest priority eligible rule: ${ruleToExecute.id} (Prio: ${ruleToExecute.priority || 0}, Delay: ${ruleToExecute.delay || 0})`,
          );

        const nonManaSyncActionSuccess = this._attemptExecutionAndHandleOutcome(now, ruleToExecute, gameState, globalConfig);

        if (nonManaSyncActionSuccess) {
          if (logExec)
            console.log(`[RuleProc] Successfully initiated action for ${ruleToExecute.id}. It should now be on its delay if applicable.`);
          ruleActionTriggeredThisCycle = true;
        } else {
          if (logExec)
            console.log(
              `[RuleProc] Failed to initiate action for ${ruleToExecute.id} (e.g., global cooldown, action error, or conditions no longer met just before execution). It will NOT start its specific delay from this attempt.`,
            );
        }
      } else {
        if (logExec && nonManaSyncPreset.length > 0) console.log('[RuleProc] No non-ManaSync rules met all conditions or were eligible.');
      }
    } else {
      if (logSteps)
        console.log('[RuleProc] Skipping non-ManaSync evaluation as a ManaSync rule executed or other exclusive action was taken.');
    }

    if (logSteps)
      console.log(
        `[RuleProc] --- Cycle End (Action Triggered: ${ruleActionTriggeredThisCycle}, Exclusive CD Action: ${this.actionTakenThisAttackCooldown}) ---`,
      );
  }

  // --- Filtering Logic ---
  _filterEligibleRules(now, rules, gameState) {
    const logSteps = config.logging.logRuleProcessingSteps;
    const logExec = config.logging.logRuleExecutionDetails;
    // ... (initial logging)

    let eligibleRules = rules.filter((rule) => rule.enabled);
    // ... (logging)

    eligibleRules = this._filterRulesByActiveCooldowns(eligibleRules, gameState);
    // ... (logging)

    // CRITICAL DELAY FILTER (using V2's working logic)
    eligibleRules = this._filterRulesNotOnDelay(now, eligibleRules);
    // ... (logging)

    eligibleRules = this._filterRulesByWalkingState(eligibleRules, gameState);
    // ... (logging)

    eligibleRules = eligibleRules.filter((rule) => {
      /* PartyHeal Interval Filter */
      if (rule.id.startsWith(this.RULE_PREFIX.PARTY_HEAL)) {
        const timeSinceLastHeal = now - this.lastPartyHealActionTime;
        const intervalMet = timeSinceLastHeal >= this.PARTY_HEAL_MIN_INTERVAL_MS;
        if (!intervalMet && logExec)
          console.log(
            `[RuleProc] Filter Fail (PartyHeal Interval): ${rule.id} short, ${timeSinceLastHeal}ms < ${this.PARTY_HEAL_MIN_INTERVAL_MS}ms`,
          );
        return intervalMet;
      }
      return true;
    });
    // ... (logging)

    eligibleRules = eligibleRules.filter((rule) => {
      /* HealFriend Rune Exclusivity */
      if (rule.id.startsWith(this.RULE_PREFIX.PARTY_HEAL) && this.PARTY_HEAL_RUNE_ITEMS.has(rule.actionItem)) {
        if (gameState.attackCd) {
          if (this.actionTakenThisAttackCooldown) {
            /* log & return false */ return false;
          }
          if (this.healFriendRuneExecutionsThisAttackCooldown >= 2) {
            /* log & return false */ return false;
          }
        }
      }
      return true;
    });
    // ... (logging)

    eligibleRules = this._filterRulesByBasicConditions(eligibleRules, gameState);
    // ... (logging)

    eligibleRules = this._filterRulesByItemAvailability(eligibleRules, gameState); // Applies to equipRule, actionBarItem, partyHeal
    // ... (logging)

    eligibleRules = eligibleRules.filter((rule) => {
      /* Equip Rule Specifics */
      if (rule.id.startsWith(this.RULE_PREFIX.EQUIP)) {
        // ... (V1 equip logic, ensure actionItem and targetSlot are valid)
        if (typeof rule.actionItem !== 'string' || rule.actionItem.trim() === '' || !rule.targetSlot) return false;
        if (typeof rule.equipOnlyIfSlotIsEmpty !== 'boolean') return false;
        const currentItemInSlot = gameState.equippedItems?.[rule.targetSlot];
        const itemKeyIntendedToEquip = rule.actionItem; // This is the item to *click* on the bar to equip
        const itemToBeEquippedName = rule.itemToBeEquippedName || itemKeyIntendedToEquip; // Actual item name that appears in slot

        if (rule.equipOnlyIfSlotIsEmpty) {
          let expectedEmptyItemKey;
          // {{change 1}}
          if (rule.targetSlot === 'amulet') {
            expectedEmptyItemKey = 'Empty';
          } else if (rule.targetSlot === 'ring') {
            expectedEmptyItemKey = 'Empty';
          } else if (rule.targetSlot === 'boots') { // Add check for boots slot
            expectedEmptyItemKey = 'Empty';
          } else {
            // If targetSlot is none of the handled types, this condition cannot be met correctly.
            return false;
          }
          if (currentItemInSlot !== expectedEmptyItemKey) {
            return false;
          }
        }
        // Avoid re-equipping if the item *is already* in the slot
        // Check against itemToBeEquippedName (actual name in slot) not actionItem (icon on bar)
        if (currentItemInSlot === itemToBeEquippedName) {
          if (logExec)
            console.log(
              `[RuleProc] Equip Rule '${rule.id}': SKIPPING (Avoid Re-equip). Item '${itemToBeEquippedName}' is already equipped in slot '${rule.targetSlot}'.`,
            );
          return false;
        }
        return true;
      }
      return true;
    });
    // ... (logging)

    eligibleRules = eligibleRules.filter((rule) => {
      /* PartyHeal Final Condition */
      if (rule.id.startsWith(this.RULE_PREFIX.PARTY_HEAL)) {
        return this._shouldHealFriend(rule, gameState);
      }
      return true;
    });
    // ... (logging)

    eligibleRules.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    // ... (final logging)
    return eligibleRules;
  }

  _filterRulesNotOnDelay(now, rules) {
    const logExec = config.logging.logRuleExecutionDetails;
    return rules.filter((rule) => {
      const ruleId = rule.id;
      const ruleDelay = rule.delay ?? 0; // Default to 0 if not specified
      const category = rule.category;

      // INDIVIDUAL DELAY (for userRule, equipRule, etc.)
      const timeSinceLastSuccessfulTrigger = now - (this.lastSuccessfulRuleActionTime[ruleId] || 0);
      const individualDelayMet = timeSinceLastSuccessfulTrigger >= ruleDelay;

      if (!individualDelayMet) {
        if (logExec)
          console.log(
            `[RuleProc] Filter Fail (Individual Delay): ${ruleId}. Time since last: ${timeSinceLastSuccessfulTrigger.toFixed(0)}ms < Delay: ${ruleDelay}ms.`,
          );
        return false;
      }

      // CATEGORY DELAY (typically for userRule)
      if (rule.id.startsWith(this.RULE_PREFIX.USER) && category) {
        const categoryDelay = OPTIONS.categoryDelays?.[category] ?? 0;
        if (categoryDelay > 0) {
          const timeSinceCategoryLastTrigger = now - (this.lastCategoryExecutionTime[category] || 0);
          const categoryDelayMet = timeSinceCategoryLastTrigger >= categoryDelay;
          if (!categoryDelayMet) {
            if (logExec)
              console.log(
                `[RuleProc] Filter Fail (Category Delay ${category}): ${ruleId}. Time since cat last: ${timeSinceCategoryLastTrigger.toFixed(0)}ms < Cat Delay: ${categoryDelay}ms.`,
              );
            return false;
          }
        }
      }
      return true;
    });
  }

  // ... (_filterRulesByActiveCooldowns, _filterRulesByWalkingState, _filterRulesByBasicConditions, _filterRulesByItemAvailability - largely same as before)
  _filterRulesByActiveCooldowns(rules, gameState) {
    /* As before */
    return rules.filter((rule) => {
      if (rule.id.startsWith(this.RULE_PREFIX.USER)) {
        const cooldownStateKey = rule.category ? OPTIONS.cooldownStateMapping?.[rule.category] : null;
        return !cooldownStateKey || !gameState[cooldownStateKey];
      }
      return true;
    });
  }
  _filterRulesByWalkingState(rules, gameState) {
    /* As before */
    const logExec = config.logging.logRuleExecutionDetails;
    return rules.filter((rule) => {
      if (rule.id.startsWith(this.RULE_PREFIX.USER) || rule.id.startsWith(this.RULE_PREFIX.ACTION_BAR)) {
        const passes = !rule.isWalking || (rule.isWalking && gameState.isWalking);
        if (!passes && logExec) console.log(`[RuleProc] Filter Fail (Walking State): ${rule.id}`);
        return passes;
      }
      return true;
    });
  }
  _filterRulesByBasicConditions(rules, gameState) {
    /* As before */
    const logExec = config.logging.logRuleExecutionDetails;
    return rules.filter((rule) => {
      let hpMet = true,
        manaMet = true,
        monsterMet = true;
      if (
        rule.id.startsWith(this.RULE_PREFIX.USER) ||
        rule.id.startsWith(this.RULE_PREFIX.ACTION_BAR) ||
        rule.id.startsWith(this.RULE_PREFIX.EQUIP)
      ) {
        hpMet = parseMathCondition(rule.hpTriggerCondition, parseInt(rule.hpTriggerPercentage, 10), gameState.hppc);
        manaMet = parseMathCondition(rule.manaTriggerCondition, parseInt(rule.manaTriggerPercentage, 10), gameState.mppc);
        if (rule.monsterNumCondition != null && rule.monsterNum != null) {
          monsterMet = parseMathCondition(rule.monsterNumCondition, parseInt(rule.monsterNum, 10), gameState.monsterNum);
        }
      }
      const statusMet = areCharStatusConditionsMet(rule, gameState);
      const allMet = hpMet && manaMet && statusMet && monsterMet;
      if (!allMet && logExec)
        console.log(`[RuleProc] Filter Fail (Basic Cond): ${rule.id} (H:${hpMet} M:${manaMet} S:${statusMet} Mon:${monsterMet})`);
      return allMet;
    });
  }

  // --- MODIFIED: Added blankRune requirement for 'Create Rune' spells ---
  _filterRulesByItemAvailability(rules, gameState) {
    const logExec = config.logging.logRuleExecutionDetails;
    return rules.filter((rule) => {
      if (
        rule.id.startsWith(this.RULE_PREFIX.ACTION_BAR) ||
        rule.id.startsWith(this.RULE_PREFIX.PARTY_HEAL) || // For non-rune party heal
        rule.id.startsWith(this.RULE_PREFIX.EQUIP)
      ) {
        const requiredItemToClick = rule.actionItem;
        if (typeof requiredItemToClick !== 'string' || requiredItemToClick.trim() === '') {
          if (logExec) console.log(`[RuleProc] Filter Fail (Item Avail): ${rule.id} - No actionItem configured.`);
          return false;
        }

        // NEW LOGIC: Check for 'Create Rune' spell/action
        const isCreateRuneAction =
          requiredItemToClick.includes('create') && requiredItemToClick.includes('Rune');

        if (isCreateRuneAction) {
          const blankRuneIsVisible = !!gameState.activeActionItems?.['blankRune'];
          if (!blankRuneIsVisible) {
            if (logExec) console.log(`[RuleProc] Filter Fail (Item Avail): ${rule.id} - 'Create Rune' action requires 'blankRune' to be visible, but it's not.`);
            return false;
          }
        }

        // Ensure the action item itself is visible on the action bar
        const itemIsVisibleOnActionBar = !!gameState.activeActionItems?.[requiredItemToClick];
        if (!itemIsVisibleOnActionBar) {
          if (logExec) console.log(`[RuleProc] Filter Fail (Item Avail): ${rule.id} - ActionItem '${requiredItemToClick}' not visible.`);
          return false;
        }
        return true;
      }
      return true;
    });
  }

  // --- ManaSync Logic (from V1, largely unchanged) ---
  _handleAttackCooldownTransitions(now, gameState, activePreset, globalConfig) {
    /* V1 logic */
    const logExec = config.logging.logRuleExecutionDetails;
    const attackCdIsCurrentlyActive = gameState.attackCd;
    const attackCdJustStarted = attackCdIsCurrentlyActive && !this.lastAttackCooldownState;
    const attackCdJustEnded = !attackCdIsCurrentlyActive && this.lastAttackCooldownState;
    let executedManaSyncNow = false;

    if (attackCdJustEnded) {
      if (logExec) {
        /* ... logging ... */
      }
      this.manaSyncWatchList.clear();
      this.executedManaSyncThisCooldown.clear();
      this.forcedManaSyncExecutedThisCooldown.clear();
      this.attackCooldownStartTime = null;
    }

    if (attackCdJustStarted) {
      if (logExec) console.log(`[RuleProc] Attack CD Started at ${now}. Eval ManaSync...`);
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
            if (!this._hasHigherPriorityEligibleHealFriend(gameState, activePreset, rule.priority || 0, now)) {
              // Pass 'manaSyncNormal' as type for _tryExecuteAction
              const keypressSent = this._tryExecuteAction(now, rule, gameState, globalConfig, 'manaSyncNormal');
              if (keypressSent) {
                this.executedManaSyncThisCooldown.add(rule.id);
                this.actionTakenThisAttackCooldown = true;
                executedManaSyncNow = true;
              }
            }
          } else {
            this.manaSyncWatchList.set(rule.id, { startTime: now, checkedConditions: conditionsMet });
          }
        }
      }
    }
    this.lastAttackCooldownState = attackCdIsCurrentlyActive;
    return { changed: attackCdJustStarted || attackCdJustEnded, executed: executedManaSyncNow };
  }
  _processManaSyncWatch(now, gameState, activePreset, globalConfig) {
    /* V1 logic, pass 'manaSyncNormal' to _tryExecuteAction */
    const logExec = config.logging.logRuleExecutionDetails;
    if (this.manaSyncWatchList.size === 0 || this.actionTakenThisAttackCooldown) return false;
    let executedFromWatch = false;
    const rulesToRemoveFromWatch = [];
    const sortedWatchKeys = Array.from(this.manaSyncWatchList.keys()).sort(/* by prio */);

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
        const conditionsStillMet = this._checkManaSyncConditions(rule, gameState);
        if (conditionsStillMet.all) {
          if (!this._hasHigherPriorityEligibleHealFriend(gameState, activePreset, rule.priority || 0, now)) {
            const keypressSent = this._tryExecuteAction(now, rule, gameState, globalConfig, 'manaSyncNormal');
            if (keypressSent) {
              this.executedManaSyncThisCooldown.add(ruleId);
              this.actionTakenThisAttackCooldown = true;
              executedFromWatch = true;
            }
          }
        }
        rulesToRemoveFromWatch.push(ruleId); // Remove once checked or executed
      }
    }
    rulesToRemoveFromWatch.forEach((id) => this.manaSyncWatchList.delete(id));
    return executedFromWatch;
  }
  _processForcedManaSyncExecution(now, gameState, activePreset, globalConfig) {
    /* V1 logic, pass 'manaSyncForced' to _tryExecuteAction */
    const logExec = config.logging.logRuleExecutionDetails;
    if (!gameState.attackCd || !this.attackCooldownStartTime || this.actionTakenThisAttackCooldown) return false;
    const timeSinceCdStart = now - this.attackCooldownStartTime;
    const isInForcedWindow =
      timeSinceCdStart >= this.MANASYNC_FORCED_EXECUTION_DELAY_MS &&
      timeSinceCdStart <= this.MANASYNC_FORCED_EXECUTION_DELAY_MS + this.MANASYNC_FORCED_EXECUTION_WINDOW_MS;
    if (!isInForcedWindow) return false;

    const manaSyncRules = activePreset
      .filter((r) => r.enabled && r.id.startsWith(this.RULE_PREFIX.MANA_SYNC))
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
    for (const rule of manaSyncRules) {
      if (this.actionTakenThisAttackCooldown) break; // Should be caught by outer check, but defensive
      if (this.executedManaSyncThisCooldown.has(rule.id) || this.forcedManaSyncExecutedThisCooldown.has(rule.id)) continue;
      const conditionsMet = this._checkManaSyncConditions(rule, gameState);
      if (conditionsMet.all) {
        if (!this._hasHigherPriorityEligibleHealFriend(gameState, activePreset, rule.priority || 0, now)) {
          const keypressSent = this._tryExecuteAction(now, rule, gameState, globalConfig, 'manaSyncForced');
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
    /* V1 logic */
    const hpMet = parseMathCondition(rule.hpTriggerCondition ?? '>=', parseInt(rule.hpTriggerPercentage ?? 0, 10), gameState.hppc);
    const manaMet = parseMathCondition(
      rule.manaTriggerCondition ?? '<=',
      parseInt(rule.manaTriggerPercentage ?? 100, 10),
      gameState.mppc,
    );
    const statusMet = areCharStatusConditionsMet(rule, gameState);
    return { hpMet, manaMet, statusMet, all: hpMet && manaMet && statusMet };
  }
  _hasHigherPriorityEligibleHealFriend(gameState, activePreset, manaSyncPriority, now) {
    /* V1 logic, ensure healRule delay check uses lastSuccessfulRuleActionTime */
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
      if (this.PARTY_HEAL_RUNE_ITEMS.has(healRule.actionItem) && this.healFriendRuneExecutionsThisAttackCooldown >= 2) continue;
      const healRuleDelay = healRule.delay ?? 0; // HealFriend rules can also have delays
      const timeSinceHealRuleLastTrigger = now - (this.lastSuccessfulRuleActionTime[healRule.id] || 0);
      if (timeSinceHealRuleLastTrigger < healRuleDelay) continue; // Corrected typo here
      if (this._shouldHealFriend(healRule, gameState) && healRule.actionItem) return true;
    }
    return false;
  }

  // --- Action Execution and Confirmation ---
  _processActionConfirmations(now, gameState) {
    /* As before, just clears pending list */
    if (this.pendingActionConfirmations.size === 0) return;
    const ruleIdsToRemove = [];
    for (const [ruleId, data] of this.pendingActionConfirmations) {
      if (!gameState.activeActionItems?.[data.actionItem] || now - data.attemptTimestamp > this.ACTION_CONFIRMATION_TIMEOUT_MS) {
        ruleIdsToRemove.push(ruleId);
      }
    }
    ruleIdsToRemove.forEach((id) => this.pendingActionConfirmations.delete(id));
  }

  /**
   * Attempts action for a non-ManaSync rule. Sets lastSuccessfulRuleActionTime.
   */
  _attemptExecutionAndHandleOutcome(now, ruleToExecute, gameState, globalConfig) {
    const logExec = config.logging.logRuleExecutionDetails;
    const ruleId = ruleToExecute.id;

    if (this.pendingActionConfirmations.has(ruleId)) {
      if (logExec) console.log(`[RuleProc] Action for ${ruleId} skipped: Awaiting item confirmation.`);
      return false;
    }

    // Pass 'standard' for non-ManaSync rules. This distinction is new in _tryExecuteAction
    const actionSuccess = this._tryExecuteAction(now, ruleToExecute, gameState, globalConfig, 'standard');

    if (actionSuccess) {
      // THIS IS THE KEY: Set timestamp for individual delay of this non-ManaSync rule.
      this.lastSuccessfulRuleActionTime[ruleId] = now;
      if (logExec) console.log(`[RuleProc] Action for ${ruleId} successful. lastSuccessfulRuleActionTime set to ${now}.`);

      if (ruleToExecute.category && ruleId.startsWith(this.RULE_PREFIX.USER)) {
        this.lastCategoryExecutionTime[ruleToExecute.category] = now;
      }
      if (ruleId.startsWith(this.RULE_PREFIX.PARTY_HEAL)) {
        this.lastPartyHealActionTime = now;
        if (this.PARTY_HEAL_RUNE_ITEMS.has(ruleToExecute.actionItem) && gameState.attackCd) {
          this.actionTakenThisAttackCooldown = true;
          this.healFriendRuneExecutionsThisAttackCooldown++;
        }
      }
      if (typeof ruleToExecute.actionItem === 'string' && ruleToExecute.actionItem.length > 0) {
        this.pendingActionConfirmations.set(ruleId, { attemptTimestamp: now, actionItem: ruleToExecute.actionItem });
      }
      return true;
    }
    // If actionSuccess is false, lastSuccessfulRuleActionTime is NOT set.
    return false;
  }

  /**
   * Tries to execute the physical action.
   * executionType: 'standard', 'manaSyncNormal', 'manaSyncForced', 'partyHealRune'
   */
  _tryExecuteAction(now, rule, gameState, globalConfig, executionType) {
    const logExec = config.logging.logRuleExecutionDetails;
    const ruleId = rule.id;

    const isManaSync = executionType.startsWith('manaSync');
    const isPartyHealRune = executionType === 'partyHealRune'; // We'll call this specifically for runes

    // Priority rules can bypass general effectiveCooldownEndTime if it's short
    const isPriorityRuleForCooldown =
      isManaSync ||
      (ruleId.startsWith(this.RULE_PREFIX.PARTY_HEAL) && this.PARTY_HEAL_RUNE_ITEMS.has(rule.actionItem) && gameState.attackCd);

    if (!isPriorityRuleForCooldown && now < this.effectiveCooldownEndTime) {
      if (logExec)
        console.log(`[RuleProc] Execute REJECTED (Global Cooldown): ${ruleId} (until ${this.effectiveCooldownEndTime}, now ${now})`);
      return false;
    }
    if (isPriorityRuleForCooldown && now < this.effectiveCooldownEndTime && logExec) {
      console.log(`[RuleProc] Priority rule ${ruleId} attempting action despite global cooldown (until ${this.effectiveCooldownEndTime}).`);
    }

    if (!rule.key) {
      console.warn(`[RuleProc] Cannot execute ${ruleId}: Missing 'key'.`);
      return false;
    }

    let actionSent = false;
    try {
      if (ruleId.startsWith(this.RULE_PREFIX.PARTY_HEAL) && this.PARTY_HEAL_RUNE_ITEMS.has(rule.actionItem)) {
        const targetMember = this._findPartyHealTarget(rule, gameState);
        if (targetMember?.uhCoordinates) {
          if (logExec) console.log(`[RuleProc] Executing PartyHeal Rune (${rule.actionItem}) on ${targetMember.id} (Key: ${rule.key})`);
          useItemOnCoordinates(
            globalConfig.windowId,
            targetMember.uhCoordinates.x + getRandomNumber(0, 130),
            targetMember.uhCoordinates.y + getRandomNumber(0, 11),
            rule.key,
          );
          actionSent = true;
        } else {
          if (logExec) console.warn(`[RuleProc] PartyHeal Rune ${ruleId}: No valid target found.`);
        }
      } else if (isManaSync) {
        // Covers 'manaSyncNormal' and 'manaSyncForced'
        const pressNumber = executionType === 'manaSyncForced' ? 1 : 1; // V1 logic
        if (logExec) console.log(`[RuleProc] Executing ManaSync keypress for ${ruleId} (Key: ${rule.key}, Type: ${executionType})`);
        keyPressManaSync(globalConfig.windowId, rule.key, pressNumber); // V1 call
        actionSent = true;
      } else {
        // 'standard' rules: userRule, equipRule, actionBarItem (non-rune party heal)
        if (logExec) console.log(`[RuleProc] Executing Standard keypress for ${ruleId} (Key: ${rule.key})`);
        keyPress(globalConfig.windowId, rule.key, rule); // V1 call for standard
        actionSent = true;
      }

      if (actionSent) {
        this.lastKeypressTime = now;
        this.effectiveCooldownEndTime = now + (isPriorityRuleForCooldown ? 25 : this.KEYPRESS_COOLDOWN_MS);
        if (logExec) console.log(`[RuleProc] Action SENT for ${ruleId}. Effective CD until ${this.effectiveCooldownEndTime}.`);
      }
      return actionSent;
    } catch (error) {
      console.error(`[RuleProcessor] Error during action execution for ${ruleId} (Type: ${executionType}):`, error);
      return false; // Ensure returns false on error
    }
  }

  // --- Party Heal Specific Logic (from V1) ---
  _shouldHealFriend(rule, gameState) {
    /* As before */
    if (!gameState?.partyMembers || rule.friendHpTriggerPercentage == null) return false;
    if (rule.requireAttackCooldown && !gameState.attackCd) return false;
    const hpTriggerPercentage = parseInt(rule.friendHpTriggerPercentage, 10);
    const partyPositionIndex = parseInt(rule.partyPosition, 10);
    if (isNaN(partyPositionIndex) || partyPositionIndex < 0 || isNaN(hpTriggerPercentage)) return false;
    if (partyPositionIndex === 0) {
      return gameState.partyMembers.some(
        (m) => m.isActive && m.hppc != null && m.hppc > 0 && m.hppc <= hpTriggerPercentage,
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
    /* As before */
    const hpTriggerPercentage = parseInt(rule.friendHpTriggerPercentage, 10);
    const partyPositionIndex = parseInt(rule.partyPosition, 10);
    if (isNaN(partyPositionIndex) || partyPositionIndex < 0 || isNaN(hpTriggerPercentage)) return null;
    if (partyPositionIndex === 0) {
      const potentialTargets = gameState.partyMembers
        .filter((m) => m.isActive && m.hppc != null && m.hppc > 0 && m.hppc <= hpTriggerPercentage)
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