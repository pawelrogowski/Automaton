// screenMonitor/ruleProcessor.js
import parseMathCondition from '../../utils/parseMathCondition.js';
import areCharStatusConditionsMet from '../../utils/areStatusConditionsMet.js';
import { keyPress, keyPressManaSync } from '../../keyboardControll/keyPress.js';
import useItemOnCoordinates from '../../mouseControll/useItemOnCoordinates.js';
import { getRandomNumber } from '../../utils/getRandomNumber.js';
import { OPTIONS } from './constants.js'; // Assuming OPTIONS contains categoryDelays and cooldownStateMapping
import { config } from './modules/config.js'; // Assuming config contains logging flags

class RuleProcessor {
  constructor() {
    // --- State Tracking ---
    this.lastRuleExecutionTimes = {}; // { ruleId: timestamp } - Tracks when a rule's delay *starts* (after confirmation or immediate for non-item rules)
    this.lastSuccessfulRuleActionTime = {}; // { ruleId: timestamp } - Tracks when the action was last *successfully triggered* (keypress/click sent), used for delay calc
    this.lastCategoryExecutionTime = {}; // { categoryName: timestamp } - Tracks the last time *any* rule in a category was successfully triggered
    this.lastPartyHealActionTime = 0; // Timestamp of the last successfully initiated PartyHeal action
    this.lastAttackCooldownState = false; // Was attack CD active in the previous cycle?
    this.attackCooldownStartTime = null; // Timestamp when the current attack CD started
    this.lastKeypressTime = 0; // Timestamp of the last physical keypress/click sent globally
    this.effectiveCooldownEndTime = 0; // Timestamp until which the next non-priority action is blocked

    // --- ManaSync Specific State ---
    this.manaSyncWatchList = new Map();
    this.executedManaSyncThisCooldown = new Set(); // Tracks normal/watched ManaSync
    this.forcedManaSyncExecutedThisCooldown = new Set(); // Tracks forced ManaSync

    // --- Action Item Confirmation State ---
    this.pendingActionConfirmations = new Map();

    // --- NEW STATE FOR ATTACK COOLDOWN EXCLUSIVITY ---
    this.actionTakenThisAttackCooldown = false; // True if ManaSync OR HealFriend (rune) executed
    this.healFriendRuneExecutionsThisAttackCooldown = 0; // Counter for HealFriend (rune)
    // --- END NEW STATE ---

    // --- Constants ---
    this.KEYPRESS_COOLDOWN_MS = 50; // Min time between non-priority keypress commands
    this.PARTY_HEAL_MIN_INTERVAL_MS = 50; // Min time between any PartyHeal action
    this.MANASYNC_FORCED_EXECUTION_DELAY_MS = 740; // Delay after CD start to *begin* forced ManaSync window
    this.MANASYNC_FORCED_EXECUTION_WINDOW_MS = 100; // Duration of the forced execution window
    this.MANA_SYNC_WATCH_DURATION_MS = 800; // How long to watch for a mana sync item
    this.ACTION_CONFIRMATION_TIMEOUT_MS = 300; // How long to wait for confirmation

    // --- Rule Type Identifiers ---
    this.RULE_PREFIX = {
      USER: 'userRule',
      ACTION_BAR: 'actionBarItem',
      MANA_SYNC: 'manaSync',
      PARTY_HEAL: 'healFriend',
    };

    // Set of actionItem names that trigger 'useItemOnCoordinates' for PartyHeal rules
    this.PARTY_HEAL_RUNE_ITEMS = new Set([
      'ultimateHealingRune',
      'intenseHealingRune',
      // Add other rune item names if needed
    ]);
  }

  // --- Public Entry Point ---

  /**
   * Processes all rules based on the current game state.
   * Ensures at most ONE rule action is executed per call.
   * @param {Array<object>} activePreset - The array of rule objects for the current preset.
   * @param {object} gameState - The current state snapshot from screenMonitor.
   * @param {object} globalConfig - Global settings (e.g., windowId).
   */
  async processRules(activePreset, gameState, globalConfig) {
    const logSteps = config.logging.logRuleProcessingSteps;
    const logExec = config.logging.logRuleExecutionDetails;
    const now = Date.now(); // Use a single timestamp for the cycle

    if (logSteps) console.log(`[RuleProc] --- Cycle Start (Time: ${now}) ---`);

    // 1. Detect Attack Cooldown Changes & Handle ManaSync Init/Cleanup
    const attackCdChanged = this._handleAttackCooldownTransitions(now, gameState, activePreset, globalConfig);
    let manaSyncRuleExecutedImmediately = attackCdChanged.executed;

    // 2. Process Ongoing ManaSync Watch (if Attack CD is active and no exclusive action taken)
    let manaSyncRuleExecutedFromWatch = false;
    if (!manaSyncRuleExecutedImmediately && gameState.attackCdActive && this.manaSyncWatchList.size > 0 && !this.actionTakenThisAttackCooldown) {
      manaSyncRuleExecutedFromWatch = this._processManaSyncWatch(now, gameState, activePreset, globalConfig);
    }

    // 2b. Process Forced ManaSync Execution (if Attack CD is active and no exclusive action taken)
    let manaSyncRuleForcedExecution = false;
    if (gameState.attackCdActive && !this.actionTakenThisAttackCooldown) {
       manaSyncRuleForcedExecution = this._processForcedManaSyncExecution(now, gameState, activePreset, globalConfig);
    }

    // 3. Process Pending Action Confirmations (does not affect exclusivity logic directly)
    this._processActionConfirmations(now, gameState);

    // Determine if an action that *should block others this cycle* was triggered.
    // This includes ManaSync (which sets actionTakenThisAttackCooldown)
    // or a standard rule that sets effectiveCooldownEndTime.
    let ruleActionTriggeredThisCycle = manaSyncRuleExecutedImmediately || manaSyncRuleExecutedFromWatch || manaSyncRuleForcedExecution;

    // 4. If no ManaSync action (which would set actionTakenThisAttackCooldown) was triggered,
    //    evaluate non-ManaSync rules (including HealFriend runes which also check actionTakenThisAttackCooldown).
    if (!ruleActionTriggeredThisCycle) {
       if (logSteps) console.log("[RuleProc] Evaluating non-ManaSync rules for execution...");
       // _filterEligibleRules will now also check actionTakenThisAttackCooldown for HealFriend runes
       const nonManaSyncPreset = activePreset.filter(r => !r.id.startsWith(this.RULE_PREFIX.MANA_SYNC));
       const eligibleRules = this._filterEligibleRules(now, nonManaSyncPreset, gameState);

       if (eligibleRules.length > 0) {
          const ruleToExecute = eligibleRules[0];
          if (logExec) console.log(`[RuleProc] Attempting highest priority eligible rule: ${ruleToExecute.id} (Prio: ${ruleToExecute.priority})`);
          // _attemptExecutionAndHandleOutcome will set actionTakenThisAttackCooldown for HealFriend runes
          const nonManaSyncActionSuccess = this._attemptExecutionAndHandleOutcome(now, ruleToExecute, gameState, globalConfig);
          if (nonManaSyncActionSuccess) {
            ruleActionTriggeredThisCycle = true; // Mark that a standard rule action happened
          }
       } else {
          if (logExec) console.log("[RuleProc] No non-ManaSync rules met all conditions.");
       }
    } else {
        if (logSteps) console.log("[RuleProc] Skipping non-ManaSync evaluation as a ManaSync rule executed or is pending confirmation.");
    }

    if (logSteps) console.log(`[RuleProc] --- Cycle End (Action Triggered This Cycle: ${ruleActionTriggeredThisCycle}, Exclusive Action This CD: ${this.actionTakenThisAttackCooldown}, HealFriendRuneCount: ${this.healFriendRuneExecutionsThisAttackCooldown}) ---`);
  }


  // --- Private Helper Methods ---

  //region Filtering and Eligibility Checks

  /**
   * Filters the preset down to rules that are potentially executable *now*, sorted by priority.
   * Checks: Enabled, Delay (Individual & Category), Cooldowns, Walking State, Basic Conditions,
   * Item Availability, Party Heal Interval, Rule-Specific Conditions.
   * Sorts by priority as the LAST step.
   * @param {number} now - Current timestamp.
   * @param {Array<object>} rules - The list of rules to filter (PRE-FILTERED to exclude ManaSync).
   * @param {object} gameState - Current game state.
   * @returns {Array<object>} - Filtered and sorted list of executable rules.
   */
  _filterEligibleRules(now, rules, gameState) {
    const logSteps = config.logging.logRuleProcessingSteps;
    const logExec = config.logging.logRuleExecutionDetails;
    if (logSteps) console.log(`[RuleProc] Filtering ${rules.length} non-ManaSync rules...`);

    let eligibleRules = rules
        .filter(rule => rule.enabled);
    if (logSteps) console.log(` -> Enabled: ${eligibleRules.length}`);

    eligibleRules = this._filterRulesByActiveCooldowns(eligibleRules, gameState);
    if (logSteps) console.log(` -> Off Category Cooldown: ${eligibleRules.length}`);

    eligibleRules = this._filterRulesNotOnDelay(now, eligibleRules);
    if (logSteps) console.log(` -> Individual/Category Delay Met: ${eligibleRules.length}`);

    eligibleRules = eligibleRules.filter(rule => {
      if (rule.id.startsWith(this.RULE_PREFIX.PARTY_HEAL)) {
        const timeSinceLastHeal = now - this.lastPartyHealActionTime;
        const intervalMet = timeSinceLastHeal >= this.PARTY_HEAL_MIN_INTERVAL_MS;
        if (!intervalMet && logExec) {
          console.log(`[RuleProc] Delay Fail (PartyHeal Interval): ${rule.id} - ${timeSinceLastHeal.toFixed(0)}ms < ${this.PARTY_HEAL_MIN_INTERVAL_MS}ms`);
        }
        return intervalMet;
      }
      return true;
    });
    if (logSteps) console.log(` -> Party Heal Interval Met: ${eligibleRules.length}`);

    // --- NEW FILTER STEP for HealFriend (Rune) Exclusivity and Limits ---
    eligibleRules = eligibleRules.filter(rule => {
      if (rule.id.startsWith(this.RULE_PREFIX.PARTY_HEAL) && this.PARTY_HEAL_RUNE_ITEMS.has(rule.actionItem)) {
        // This is a HealFriend RUNE rule
        // Check only if attack CD is active, as these flags are relevant to it
        if (gameState.attackCdActive) {
            if (this.actionTakenThisAttackCooldown) {
              if (logExec) console.log(`[RuleProc] Filter Fail (HealFriend Rune ${rule.id}): Exclusive action (ManaSync or another Heal Rune) already taken this attack cooldown.`);
              return false;
            }
            if (this.healFriendRuneExecutionsThisAttackCooldown >= 2) {
              if (logExec) console.log(`[RuleProc] Filter Fail (HealFriend Rune ${rule.id}): Max 2 executions reached this attack cooldown (${this.healFriendRuneExecutionsThisAttackCooldown}).`);
              return false;
            }
        }
      }
      return true; // Pass if not a HealFriend Rune rule or if checks pass
    });
    if (logSteps) console.log(` -> HealFriend (Rune) Exclusivity/Limits Met: ${eligibleRules.length}`);
    // --- END NEW FILTER STEP ---

    eligibleRules = this._filterRulesByWalkingState(eligibleRules, gameState);
    if (logSteps) console.log(` -> Walking State OK: ${eligibleRules.length}`);

    eligibleRules = this._filterRulesByBasicConditions(eligibleRules, gameState);
    if (logSteps) console.log(` -> Basic Conditions Met: ${eligibleRules.length}`);

    eligibleRules = this._filterRulesByItemAvailability(eligibleRules, gameState);
    if (logSteps) console.log(` -> Action Item Available: ${eligibleRules.length}`);

    eligibleRules = eligibleRules.filter(rule => {
      if (rule.id.startsWith(this.RULE_PREFIX.PARTY_HEAL)) {
        const friendHpMet = this._shouldHealFriend(rule, gameState);
        if (!friendHpMet && logExec) {
          console.log(`[RuleProc] Final Condition Fail (PartyHeal ${rule.id}): _shouldHealFriend returned false.`);
        }
        return friendHpMet;
      }
      return true;
    });
    if (logSteps) console.log(` -> Final Conditions Met: ${eligibleRules.length}`);

    eligibleRules.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    if (logSteps && eligibleRules.length > 0) {
      console.log(` -> Final Eligible & Sorted: ${eligibleRules.length} (Highest Prio: ${eligibleRules[0].id} P${eligibleRules[0].priority})`);
    } else if (logSteps) {
      console.log(` -> Final Eligible & Sorted: 0`);
    }

    return eligibleRules;
  }

  /** Filters rules based on mapped category cooldowns (only applies to userRule here) */
  _filterRulesByActiveCooldowns(rules, gameState) {
    return rules.filter((rule) => {
      // userRule is the only type using category cooldowns here (ManaSync already excluded)
      if (rule.id.startsWith(this.RULE_PREFIX.USER)) {
        const cooldownStateKey = rule.category ? OPTIONS.cooldownStateMapping?.[rule.category] : null;
        // Pass if no category/mapping OR if the relevant cooldown is NOT active
        return !cooldownStateKey || !gameState[cooldownStateKey];
      }
      // ActionBarItem and HealFriend ignore category cooldowns
      return true;
    });
  }

  /** Filters rules based on individual and category delays */
  _filterRulesNotOnDelay(now, rules) {
    const logExec = config.logging.logRuleExecutionDetails;
    return rules.filter((rule) => {
      const ruleId = rule.id;
      const ruleDelay = rule.delay ?? 0;
      const category = rule.category;

      const timeSinceLastTrigger = now - (this.lastSuccessfulRuleActionTime[ruleId] || 0);
      const individualDelayMet = timeSinceLastTrigger >= ruleDelay;

      if (!individualDelayMet && logExec) {
        console.log(`[RuleProc] Delay Fail (Individual): ${ruleId} - ${timeSinceLastTrigger.toFixed(0)}ms < ${ruleDelay}ms (Last Trigger: ${this.lastSuccessfulRuleActionTime[ruleId] || 0})`);
        return false;
      }

      if (rule.id.startsWith(this.RULE_PREFIX.USER) && category) {
        const categoryDelay = OPTIONS.categoryDelays?.[category] ?? 0;
        if (categoryDelay > 0) {
          const timeSinceCategoryLastTrigger = now - (this.lastCategoryExecutionTime[category] || 0);
          const categoryDelayMet = timeSinceCategoryLastTrigger >= categoryDelay;

          if (!categoryDelayMet && logExec) {
            console.log(`[RuleProc] Delay Fail (Category ${category}): ${ruleId} - ${timeSinceCategoryLastTrigger.toFixed(0)}ms < ${categoryDelay}ms (Last Trigger: ${this.lastCategoryExecutionTime[category] || 0})`);
            return false;
          }
        }
      }
      return true;
    });
  }

  /** Filters rules based on walking state (applies to userRule/actionBarItem) */
  _filterRulesByWalkingState(rules, gameState) {
    // Only userRules and actionBarRules have the 'isWalking' property check
    return rules.filter((rule) => {
        if (rule.id.startsWith(this.RULE_PREFIX.USER) || rule.id.startsWith(this.RULE_PREFIX.ACTION_BAR)) {
            // Pass if rule doesn't care about walking OR if rule requires walking and character IS walking
            return !rule.isWalking || (rule.isWalking && gameState.isWalking);
        }
        // HealFriend rules ignore walking state
        return true;
    });
  }

  /** Filters rules based on HP, Mana, Monster Count, and Status conditions. */
  _filterRulesByBasicConditions(rules, gameState) {
    const logExec = config.logging.logRuleExecutionDetails;
    return rules.filter((rule) => {
      const hpMet = parseMathCondition(rule.hpTriggerCondition, parseInt(rule.hpTriggerPercentage, 10), gameState.hpPercentage);
      const manaMet = parseMathCondition(rule.manaTriggerCondition, parseInt(rule.manaTriggerPercentage, 10), gameState.manaPercentage);
      const statusMet = areCharStatusConditionsMet(rule, gameState); // Checks rule.conditions array

      let monsterMet = true;
      // Monster count applies to userRule and actionBarItem rules
      if (rule.id.startsWith(this.RULE_PREFIX.USER) || rule.id.startsWith(this.RULE_PREFIX.ACTION_BAR)) {
        // Ensure monsterNum and condition exist before parsing
        if (rule.monsterNumCondition != null && rule.monsterNum != null) {
            monsterMet = parseMathCondition(rule.monsterNumCondition, parseInt(rule.monsterNum, 10), gameState.monsterNum);
        } else {
            monsterMet = true; // Default to true if fields are missing
        }
      }

      const allMet = hpMet && manaMet && statusMet && monsterMet;

      if (!allMet && logExec) {
        console.log(`[RuleProc] Basic Condition Fail: ${rule.id} (HP=${hpMet}, Mana=${manaMet}, Status=${statusMet}, Monster=${monsterMet})`);
      }
      return allMet;
    });
  }

  /** Filters rules based on the current visibility of their required actionItem (for Action/Party types) */
  _filterRulesByItemAvailability(rules, gameState) {
    const logExec = config.logging.logRuleExecutionDetails;
    return rules.filter(rule => {
      // Check only rules that require an actionItem
      if (rule.id.startsWith(this.RULE_PREFIX.ACTION_BAR) || rule.id.startsWith(this.RULE_PREFIX.PARTY_HEAL)) {
        const requiredItem = rule.actionItem;
        // Rule MUST have an actionItem defined
        if (!requiredItem) {
           console.warn(`[RuleProc] Item Availability Fail: Rule ${rule.id} is missing required 'actionItem' field.`);
           return false;
        }
        // Check if the item is currently active in the game state
        const itemIsActive = !!gameState.activeActionItems?.[requiredItem];
        if (!itemIsActive && logExec) {
            console.log(`[RuleProc] Item Availability Fail: ${rule.id} requires item '${requiredItem}' which is NOT active.`);
        }
        return itemIsActive; // Keep rule only if item is active
      }
      // If the rule doesn't use actionItem (like userRule), it passes this filter
      return true;
    });
  }

  //endregion

  //region ManaSync Logic

  /**
   * Handles state changes related to the attack cooldown for ManaSync rules.
   * Sets/Resets attackCooldownStartTime. Clears BOTH execution sets on CD end.
   * On CD start, evaluates rules for immediate execution or watching (uses executedManaSyncThisCooldown).
   * @returns {object} { changed: boolean, executed: boolean }
   */
   _handleAttackCooldownTransitions(now, gameState, activePreset, globalConfig) {
    const logExec = config.logging.logRuleExecutionDetails;
    const attackCdIsCurrentlyActive = gameState.attackCdActive;
    const attackCdJustStarted = attackCdIsCurrentlyActive && !this.lastAttackCooldownState;
    const attackCdJustEnded = !attackCdIsCurrentlyActive && this.lastAttackCooldownState;
    let executedManaSyncNow = false;

    if (attackCdJustEnded) {
      if (logExec) {
        const clearingWatch = this.manaSyncWatchList.size > 0;
        const clearingExecuted = this.executedManaSyncThisCooldown.size > 0;
        const clearingForced = this.forcedManaSyncExecutedThisCooldown.size > 0;
        if (clearingWatch || clearingExecuted || clearingForced) {
          console.log(`[RuleProc] Attack CD Ended. Clearing Watch (${this.manaSyncWatchList.size}), Executed (${this.executedManaSyncThisCooldown.size}), Forced (${this.forcedManaSyncExecutedThisCooldown.size}). Resetting CD Start Time.`);
        } else {
          console.log(`[RuleProc] Attack CD Ended. Resetting CD Start Time.`);
        }
      }
      this.manaSyncWatchList.clear();
      this.executedManaSyncThisCooldown.clear();
      this.forcedManaSyncExecutedThisCooldown.clear();
      this.attackCooldownStartTime = null;
      // Exclusivity flags are reset on CD start.
    }

    if (attackCdJustStarted) {
      if (logExec) console.log(`[RuleProc] Attack CD Started at ${now}. Evaluating immediate ManaSync rules...`);
      this.attackCooldownStartTime = now;
      this.manaSyncWatchList.clear();
      this.executedManaSyncThisCooldown.clear();
      this.forcedManaSyncExecutedThisCooldown.clear();
      this.actionTakenThisAttackCooldown = false; // RESET
      this.healFriendRuneExecutionsThisAttackCooldown = 0; // RESET

      const manaSyncRules = activePreset.filter(r => r.enabled && r.id.startsWith(this.RULE_PREFIX.MANA_SYNC));
      manaSyncRules.sort((a, b) => (b.priority || 0) - (a.priority || 0));

      for (const rule of manaSyncRules) {
        if (executedManaSyncNow) break; // Only one ManaSync of any type per CD

        // If an exclusive action (another ManaSync or HealFriend rune) has already happened this CD, stop.
        if (this.actionTakenThisAttackCooldown) {
          if (logExec) console.log(`[RuleProc] --> ManaSync ${rule.id} immediate execution SKIPPED: Exclusive action already taken this attack cooldown.`);
          continue;
        }

        const conditionsMet = this._checkManaSyncConditions(rule, gameState);
        const itemIsActive = !!gameState.activeActionItems?.[rule.actionItem];

        if (logExec) console.log(`[RuleProc] ManaSync Initial Eval (${rule.id}, Prio ${rule.priority || 0}): ConditionsMet=${conditionsMet.all}, ItemActive=${itemIsActive}`);

        if (conditionsMet.all) {
          if (!rule.actionItem) {
            console.warn(`[RuleProc] ManaSync Rule ${rule.id} is missing 'actionItem'. Cannot execute or watch.`);
            continue;
          }

          if (itemIsActive) {
            const manaSyncPrio = rule.priority || 0;
            // _hasHigherPriorityEligibleHealFriend now also respects actionTakenThisAttackCooldown & limits
            if (this._hasHigherPriorityEligibleHealFriend(gameState, activePreset, manaSyncPrio, now)) {
              if (logExec) console.log(`[RuleProc] --> ManaSync ${rule.id} immediate execution BLOCKED by higher priority HealFriend.`);
            } else {
              if (logExec) console.log(`[RuleProc] --> ManaSync ${rule.id} attempting IMMEDIATE execution.`);
              const keypressSent = this._tryExecuteAction(now, rule, gameState, globalConfig, 'normal');
              if (keypressSent) {
                this.executedManaSyncThisCooldown.add(rule.id); // Track which ManaSync rule fired
                this.actionTakenThisAttackCooldown = true; // SET EXCLUSIVITY FLAG
                executedManaSyncNow = true;
                if (logExec) console.log(`[RuleProc] --> ManaSync ${rule.id} IMMEDIATE execution SUCCEEDED.`);
              } else {
                if (logExec) console.log(`[RuleProc] --> ManaSync ${rule.id} IMMEDIATE execution FAILED (Rate Limit?).`);
              }
            }
          } else {
            if (logExec) console.log(`[RuleProc] --> ManaSync ${rule.id} conditions met, item unavailable. Adding to watch list.`);
            this.manaSyncWatchList.set(rule.id, { startTime: now, checkedConditions: conditionsMet });
          }
        }
      }
    }

    this.lastAttackCooldownState = attackCdIsCurrentlyActive;
    return { changed: attackCdJustStarted || attackCdJustEnded, executed: executedManaSyncNow };
}


  /**
   * Processes rules currently in the ManaSync watch list during an active attack cooldown.
   * Uses executedManaSyncThisCooldown for tracking.
   * @returns {boolean} - True if a watched ManaSync rule was successfully executed.
   */
  _processManaSyncWatch(now, gameState, activePreset, globalConfig) {
    const logExec = config.logging.logRuleExecutionDetails;
    if (this.manaSyncWatchList.size === 0) return false;

    // If an exclusive action has already happened this CD, don't process watch.
    if (this.actionTakenThisAttackCooldown) {
      if (logExec) console.log(`[RuleProc] Skipping ManaSync watch processing: Exclusive action already taken this attack cooldown.`);
      return false;
    }

    if (logExec) console.log(`[RuleProc] Processing ${this.manaSyncWatchList.size} watched ManaSync rules...`);

    let executedFromWatch = false;
    const rulesToRemoveFromWatch = [];
    const sortedWatchKeys = Array.from(this.manaSyncWatchList.keys()).sort((aKey, bKey) => {
      const ruleA = activePreset.find(r => r.id === aKey);
      const ruleB = activePreset.find(r => r.id === bKey);
      return (ruleB?.priority || 0) - (ruleA?.priority || 0);
    });

    for (const ruleId of sortedWatchKeys) {
      if (executedFromWatch) break; // Only one ManaSync of any type per CD

      // Redundant check if outer one is reliable, but safe
      if (this.actionTakenThisAttackCooldown) {
        if (logExec) console.log(`[RuleProc] --> Watched ManaSync ${ruleId} SKIPPED (in loop): Exclusive action taken this attack cooldown.`);
        rulesToRemoveFromWatch.push(ruleId);
        continue;
      }

      const watchData = this.manaSyncWatchList.get(ruleId);
      const rule = activePreset.find(r => r.id === ruleId);

      if (!rule || !rule.actionItem || this.executedManaSyncThisCooldown.has(ruleId)) {
        if (logExec && this.executedManaSyncThisCooldown.has(ruleId)) {
          console.log(`[RuleProc] --> Skipping watched check for ${ruleId}: Already executed normally this CD.`);
        }
        rulesToRemoveFromWatch.push(ruleId); continue;
      }
      if (now - watchData.startTime > this.MANA_SYNC_WATCH_DURATION_MS) {
        rulesToRemoveFromWatch.push(ruleId);
        if (logExec) console.log(`[RuleProc] --> ManaSync Watch TIMEOUT for ${ruleId}.`);
        continue;
      }

      const itemIsNowActive = !!gameState.activeActionItems?.[rule.actionItem];

      if (itemIsNowActive) {
        if (logExec) console.log(`[RuleProc] --> Watched ManaSync ${ruleId} item now ACTIVE. Re-checking conditions...`);
        const conditionsStillMet = this._checkManaSyncConditions(rule, gameState);

        if (conditionsStillMet.all) {
          const manaSyncPrio = rule.priority || 0;
          if (this._hasHigherPriorityEligibleHealFriend(gameState, activePreset, manaSyncPrio, now)) {
            if (logExec) console.log(`[RuleProc] --> Watched ManaSync ${rule.id} execution BLOCKED by higher priority HealFriend.`);
            rulesToRemoveFromWatch.push(ruleId); // Remove if blocked, so it doesn't get stuck
          } else {
            if (logExec) console.log(`[RuleProc] --> Watched ManaSync ${ruleId} conditions still MET. Attempting execution.`);
            const keypressSent = this._tryExecuteAction(now, rule, gameState, globalConfig, 'normal');
            if (keypressSent) {
              this.executedManaSyncThisCooldown.add(ruleId);
              this.actionTakenThisAttackCooldown = true; // SET EXCLUSIVITY FLAG
              rulesToRemoveFromWatch.push(ruleId);
              executedFromWatch = true;
              if (logExec) console.log(`[RuleProc] --> Watched ManaSync ${ruleId} execution SUCCEEDED.`);
            } else {
              if (logExec) console.log(`[RuleProc] --> Watched ManaSync ${ruleId} execution FAILED (Rate Limit?).`);
              rulesToRemoveFromWatch.push(ruleId); // Remove even on failure
            }
          }
        } else {
          if (logExec) console.log(`[RuleProc] --> Watched ManaSync ${ruleId} item appeared, but conditions FAILED NOW. Removing from watch.`);
          rulesToRemoveFromWatch.push(ruleId);
        }
      }
    }

    rulesToRemoveFromWatch.forEach(id => this.manaSyncWatchList.delete(id));
    return executedFromWatch;
  }

  /** Checks HP, Mana, and Status conditions specifically for a ManaSync rule. */
  _checkManaSyncConditions(rule, gameState) {
      // Ensure conditions exist before parsing, providing safe defaults
      const hpCondition = rule.hpTriggerCondition ?? '>=';
      const hpPercent = rule.hpTriggerPercentage ?? 0;
      const manaCondition = rule.manaTriggerCondition ?? '<=';
      const manaPercent = rule.manaTriggerPercentage ?? 100;

      const hpMet = parseMathCondition(hpCondition, parseInt(hpPercent, 10), gameState.hpPercentage);
      const manaMet = parseMathCondition(manaCondition, parseInt(manaPercent, 10), gameState.manaPercentage);
      const statusMet = areCharStatusConditionsMet(rule, gameState); // Checks rule.conditions array
      return { hpMet, manaMet, statusMet, all: hpMet && manaMet && statusMet };
  }

  /**
   * Checks if there's any enabled, higher-priority HealFriend rule
   * (with requireAttackCooldown=true) that currently meets its core _shouldHealFriend condition.
   * @param {object} gameState - Current game state.
   * @param {Array<object>} activePreset - The full list of rules.
   * @param {number} manaSyncPriority - The priority of the ManaSync rule currently being considered.
   * @returns {boolean} - True if a higher-priority, potentially eligible HealFriend exists.
   */
  _hasHigherPriorityEligibleHealFriend(gameState, activePreset, manaSyncPriority, now) {
    const logExec = config.logging.logRuleExecutionDetails;

    if (this.actionTakenThisAttackCooldown) {
        if (logExec) console.log(`[RuleProc] Check Higher Prio HealFriend: SKIPPED, actionTakenThisAttackCooldown is true (ManaSync or Heal Rune already acted).`);
        return false;
    }

    const competingHealFriends = activePreset.filter(rule =>
      rule.enabled &&
      rule.id.startsWith(this.RULE_PREFIX.PARTY_HEAL) &&
      rule.requireAttackCooldown === true &&
      (rule.priority || 0) > manaSyncPriority
    );

    if (competingHealFriends.length === 0) {
      return false;
    }

    for (const healRule of competingHealFriends) {
      let canThisHealRuleRunDueToLimits = true;
      if (this.PARTY_HEAL_RUNE_ITEMS.has(healRule.actionItem)) {
        if (this.healFriendRuneExecutionsThisAttackCooldown >= 2) {
          if (logExec) console.log(`[RuleProc] Check Higher Prio HealFriend (${healRule.id}): SKIPPED for ManaSync block, rune execution limit (${this.healFriendRuneExecutionsThisAttackCooldown}) reached.`);
          canThisHealRuleRunDueToLimits = false;
        }
      }

      if (!canThisHealRuleRunDueToLimits) continue;

      const ruleDelay = healRule.delay ?? 0;
      const timeSinceLastTrigger = now - (this.lastSuccessfulRuleActionTime[healRule.id] || 0);
      const individualDelayMet = timeSinceLastTrigger >= ruleDelay;

      if (!individualDelayMet) {
          if(logExec) console.log(`[RuleProc] Check Higher Prio HealFriend (${healRule.id}): SKIPPED for ManaSync block, heal rule on individual delay.`);
          continue;
      }

      // Check core heal condition.
      // For the purpose of ManaSync deferral, we assume the item *would be* available if conditions are met.
      // The actual item availability check for the healRule itself happens later in _filterRulesByItemAvailability.
      if (this._shouldHealFriend(healRule, gameState)) {
        // We also need to ensure the healRule itself has an actionItem defined, otherwise it can't block.
        if (!healRule.actionItem) {
            if (logExec) console.log(`[RuleProc] Higher Prio HealFriend (${healRule.id}) is missing 'actionItem', cannot evaluate for ManaSync block.`);
            continue;
        }
        // If all other conditions for the heal rule are met (HP, status, delays, rune limits),
        // then ManaSync should defer to it, regardless of the heal item's current screen visibility.
        if (logExec) console.log(`[RuleProc] Found HIGHER PRIORITY eligible HealFriend (${healRule.id}, Prio ${healRule.priority}) whose core conditions are met, blocking ManaSync (Prio ${manaSyncPriority}). Item availability for HealFriend will be checked if/when it tries to execute.`);
        return true;
      }
    }
    return false;
  }

  /**
   * Attempts to execute a ManaSync rule if the current time falls within the forced
   * execution window (MANASYNC_FORCED_EXECUTION_DELAY_MS to DELAY + WINDOW_MS)
   * after the attack CD started, regardless of item visibility, provided other conditions are met.
   * Uses forcedManaSyncExecutedThisCooldown for tracking per-cooldown execution.
   * Ensures only ONE such rule executes per *cycle*.
   * @returns {boolean} - True if a forced ManaSync rule was successfully executed in this cycle.
   */
  _processForcedManaSyncExecution(now, gameState, activePreset, globalConfig) {
    const logExec = config.logging.logRuleExecutionDetails;

    if (!gameState.attackCdActive || !this.attackCooldownStartTime) return false;

    // If an exclusive action has already happened this CD, don't process forced.
    if (this.actionTakenThisAttackCooldown) {
      if (logExec) console.log(`[RuleProc] Skipping FORCED ManaSync processing: Exclusive action already taken this attack cooldown.`);
      return false;
    }

    const timeSinceCdStart = now - this.attackCooldownStartTime;
    const forcedWindowStartTime = this.attackCooldownStartTime + this.MANASYNC_FORCED_EXECUTION_DELAY_MS;
    const forcedWindowEndTime = forcedWindowStartTime + this.MANASYNC_FORCED_EXECUTION_WINDOW_MS;
    const isInForcedWindow = now >= forcedWindowStartTime && now <= forcedWindowEndTime;

    if (!isInForcedWindow) return false;

    if (logExec) console.log(`[RuleProc] In FORCED ManaSync window (${timeSinceCdStart.toFixed(0)}ms since CD start). Checking rules...`);

    const manaSyncRules = activePreset.filter(r => r.enabled && r.id.startsWith(this.RULE_PREFIX.MANA_SYNC));
    manaSyncRules.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    let forcedActionTakenThisCycle = false;

    for (const rule of manaSyncRules) {
      if (forcedActionTakenThisCycle) break; // Only one ManaSync of any type per CD

      // Redundant check if outer is reliable
      if (this.actionTakenThisAttackCooldown) {
        if (logExec) console.log(`[RuleProc] --> FORCED ManaSync ${rule.id} SKIPPED (in loop): Exclusive action taken this attack cooldown.`);
        continue;
      }

      const ruleId = rule.id;
      // A forced rule shouldn't run if any mana sync already ran this CD
      if (this.forcedManaSyncExecutedThisCooldown.has(ruleId) || this.executedManaSyncThisCooldown.has(ruleId)) {
        if (logExec) console.log(`[RuleProc] --> Skipping FORCED check for ${ruleId}: Already executed (normal/forced) this CD cycle.`);
        continue;
      }

      const conditionsMet = this._checkManaSyncConditions(rule, gameState);
      if (logExec) console.log(`[RuleProc] --> FORCED ManaSync Eval (${ruleId}, Prio ${rule.priority || 0}): ConditionsMet=${conditionsMet.all}`);

      if (conditionsMet.all) {
        const manaSyncPrio = rule.priority || 0;
        if (this._hasHigherPriorityEligibleHealFriend(gameState, activePreset, manaSyncPrio, now)) {
          if (logExec) console.log(`[RuleProc] --> FORCED ManaSync ${ruleId} execution BLOCKED by higher priority HealFriend.`);
          continue;
        }

        if (logExec) console.log(`[RuleProc] --> FORCED ManaSync ${ruleId} attempting execution (item presence ignored).`);
        const keypressSent = this._tryExecuteAction(now, rule, gameState, globalConfig, 'forced');

        if (keypressSent) {
          this.forcedManaSyncExecutedThisCooldown.add(ruleId); // Track forced execution
          this.actionTakenThisAttackCooldown = true; // SET EXCLUSIVITY FLAG
          if (logExec) console.log(`[RuleProc] --> FORCED ManaSync ${ruleId} execution SUCCEEDED.`);
          forcedActionTakenThisCycle = true;
          return true; // Only ONE forced action per cycle, even if others eligible
        } else {
          if (logExec) console.log(`[RuleProc] --> FORCED ManaSync ${ruleId} execution FAILED (Rate Limit?).`);
        }
      }
    }
    return forcedActionTakenThisCycle;
  }

  //endregion

  //region Action Execution and Confirmation

  /** Checks rules waiting for their action item to disappear and handles timeouts. */
   _processActionConfirmations(now, gameState) {
    const logExec = config.logging.logRuleExecutionDetails;
    if (this.pendingActionConfirmations.size === 0) return;

    if (logExec) console.log(`[RuleProc] Checking ${this.pendingActionConfirmations.size} pending action confirmations...`);
    const ruleIdsToRemoveFromPending = [];

    for (const [ruleId, confirmData] of this.pendingActionConfirmations.entries()) {
        // Check if the specific item required by *this* rule is active
        const itemIsNowActive = !!gameState.activeActionItems?.[confirmData.actionItem];
        const timeSinceAttempt = now - confirmData.attemptTimestamp;

        if (!itemIsNowActive) {
            // CONFIRMED: Item disappeared
            this.lastRuleExecutionTimes[ruleId] = now; // Start delay timer *now*
            ruleIdsToRemoveFromPending.push(ruleId);
            if (logExec) console.log(`[RuleProc] --> Action CONFIRMED (Item ${confirmData.actionItem} Disappeared): ${ruleId}. Delay timer started. UI update took ~${timeSinceAttempt.toFixed(0)}ms.`);
        } else if (timeSinceAttempt > this.ACTION_CONFIRMATION_TIMEOUT_MS) {
            // TIMEOUT: Item still active after threshold
            ruleIdsToRemoveFromPending.push(ruleId);
            // Don't update lastRuleExecutionTimes - treat as if it didn't happen or UI is stuck
            console.warn(`[RuleProc] --> Action Confirmation TIMEOUT: ${ruleId}. Item ${confirmData.actionItem} still active after ${timeSinceAttempt.toFixed(0)}ms. Check UI responsiveness or rule logic.`);
        } else {
             // Action confirmation still pending - Log removed for less noise
        }
    }

    ruleIdsToRemoveFromPending.forEach(id => this.pendingActionConfirmations.delete(id));
}


  /**
   * Attempts to execute the action for the given rule (which has already passed all checks)
   * and handles the outcome (starting confirmation or delay, updating timers).
   * @param {number} now - Current timestamp.
   * @param {object} ruleToExecute - The single rule object to execute.
   * @param {object} gameState - Current game state.
   * @param {object} globalConfig - Global settings.
   * @returns {boolean} - True if an action was successfully initiated.
   */
  _attemptExecutionAndHandleOutcome(now, ruleToExecute, gameState, globalConfig) {
    const logExec = config.logging.logRuleExecutionDetails;
    const ruleId = ruleToExecute.id;
    const targetsActionItem = typeof ruleToExecute.actionItem === 'string' && ruleToExecute.actionItem.length > 0;

    if (this.pendingActionConfirmations.has(ruleId)) {
      if (logExec) console.log(`[RuleProc] Skipping Rule ${ruleId}: Still awaiting confirmation.`);
      return false;
    }

    if (logExec) console.log(`[RuleProc] --> Attempting action for pre-validated rule ${ruleId}...`);
    
    const actionSuccess = this._tryExecuteAction(now, ruleToExecute, gameState, globalConfig, 'standard');

    if (actionSuccess) {
      this.lastSuccessfulRuleActionTime[ruleId] = now;

      if (ruleToExecute.category && ruleId.startsWith(this.RULE_PREFIX.USER)) {
        this.lastCategoryExecutionTime[ruleToExecute.category] = now;
        if (logExec) console.log(`[RuleProc] --> Updated Category ${ruleToExecute.category} last trigger time.`);
      }

      if (ruleId.startsWith(this.RULE_PREFIX.PARTY_HEAL)) {
        this.lastPartyHealActionTime = now; 
        if (logExec) console.log(`[RuleProc] --> Updated PartyHeal last action time to ${now}.`);

        if (this.PARTY_HEAL_RUNE_ITEMS.has(ruleToExecute.actionItem) && gameState.attackCdActive) {
          this.actionTakenThisAttackCooldown = true; 
          this.healFriendRuneExecutionsThisAttackCooldown++; 
          if (logExec) console.log(`[RuleProc] --> HealFriend (Rune) ${ruleId} EXECUTED during Attack CD. actionTakenThisAttackCooldown=true, runeExecutions=${this.healFriendRuneExecutionsThisAttackCooldown}.`);
        } else if (this.PARTY_HEAL_RUNE_ITEMS.has(ruleToExecute.actionItem) && logExec) {
             console.log(`[RuleProc] --> HealFriend (Rune) ${ruleId} EXECUTED (Attack CD NOT active). Exclusivity flags not set.`);
        }
      }

      if (targetsActionItem) {
        this.pendingActionConfirmations.set(ruleId, { attemptTimestamp: now, actionItem: ruleToExecute.actionItem });
        if (logExec) console.log(`[RuleProc] --> Action initiated for ${ruleId}. Added to PENDING confirmation.`);
      } else {
        this.lastRuleExecutionTimes[ruleId] = now;
        if (logExec) console.log(`[RuleProc] --> Action initiated for ${ruleId}. Individual Delay timer started (no confirmation needed).`);
      }
      return true;
    } else {
      if (logExec) console.log(`[RuleProc] --> Action FAILED TO INITIATE for ${ruleId} (Rate Limit/Cooldown?).`);
      return false;
    }
  }


  /**
   * Attempts to perform the action associated with a rule (keypress or useItemOnCoordinates).
   * Checks the global effective cooldown and ensures rule has a key.
   * Updates effectiveCooldownEndTime based on the rule type executed.
   * Added executionType parameter for ManaSync differentiation.
   * @param {string} [executionType='standard'] - Indicates the context ('normal', 'forced', 'standard').
   * @returns {boolean} - True if the action command was successfully sent.
   */
   _tryExecuteAction(now, rule, gameState, globalConfig, executionType = 'standard') {
    const logExec = config.logging.logRuleExecutionDetails;
    const ruleId = rule.id;
    const isPriorityRuleForCooldown = ruleId.startsWith(this.RULE_PREFIX.MANA_SYNC) ||
                                     (ruleId.startsWith(this.RULE_PREFIX.PARTY_HEAL) &&
                                      this.PARTY_HEAL_RUNE_ITEMS.has(rule.actionItem) &&
                                      gameState.attackCdActive); 

    const SHORT_COOLDOWN_MS = 25;

    if (!isPriorityRuleForCooldown && now < this.effectiveCooldownEndTime) {
      if (logExec) console.log(`[RuleProc] Execute REJECTED (Global Cooldown Active until ${this.effectiveCooldownEndTime}) for standard rule ${ruleId}`);
      return false;
    } else if (isPriorityRuleForCooldown && logExec && now < this.effectiveCooldownEndTime) {
      console.log(`[RuleProc] Priority rule ${ruleId} bypassing global cooldown (Active until ${this.effectiveCooldownEndTime}, ${(now - this.lastKeypressTime).toFixed(0)}ms since last press).`);
    }

    if (!rule.key) {
      console.warn(`[RuleProc] Cannot execute rule ${ruleId}: Missing 'key' property.`);
      return false;
    }

    try {
      let actionSent = false;
      if (ruleId.startsWith(this.RULE_PREFIX.PARTY_HEAL) && this.PARTY_HEAL_RUNE_ITEMS.has(rule.actionItem)) {
        const targetMember = this._findPartyHealTarget(rule, gameState);
        if (targetMember?.uhCoordinates) {
          if (logExec) console.log(`[RuleProc] Executing PartyHeal Rune (${rule.actionItem}) on target ${targetMember.id} via useItemOnCoordinates (Key: ${rule.key})`);
          useItemOnCoordinates(
            globalConfig.windowId,
            targetMember.uhCoordinates.x + getRandomNumber(0, 130),
            targetMember.uhCoordinates.y + getRandomNumber(0, 11),
            rule.key
          );
          actionSent = true;
        } else {
          console.warn(`[RuleProc] PartyHeal Rune execution failed for ${ruleId}: Could not find valid target member or coordinates.`);
          actionSent = false;
        }
      } else if (ruleId.startsWith(this.RULE_PREFIX.MANA_SYNC)) {
        const pressNumber = executionType === 'forced' ? 1 : 1;
        if (logExec) console.log(`[RuleProc] Executing ManaSync keypress for ${ruleId} (${rule.key}), Type: ${executionType}, Presses: ${pressNumber}`);
        keyPressManaSync(globalConfig.windowId, rule.key, pressNumber);
        actionSent = true;
      } else {
        if (logExec) console.log(`[RuleProc] Executing Standard keypress for ${ruleId} (${rule.key})`);
        keyPress(globalConfig.windowId, [rule.key], rule);
        actionSent = true;
      }

      if (actionSent) {
        this.lastKeypressTime = now;
        if (isPriorityRuleForCooldown) {
          this.effectiveCooldownEndTime = now + SHORT_COOLDOWN_MS;
          if (logExec) console.log(`[RuleProc] --> Action SENT for priority rule ${ruleId}. Setting short cooldown (until ${this.effectiveCooldownEndTime}).`);
        } else {
          this.effectiveCooldownEndTime = now + this.KEYPRESS_COOLDOWN_MS;
          if (logExec) console.log(`[RuleProc] --> Action SENT for standard rule ${ruleId}. Setting standard cooldown (until ${this.effectiveCooldownEndTime}).`);
        }
      }
      return actionSent;

    } catch (error) {
      console.error(`[RuleProcessor] Error during action execution for rule ${ruleId}:`, error);
      return false;
    }
}


  //endregion

  //region Party Heal Specific Logic

  /** Checks if the conditions for healing a friend are met (HP% and checks requireAttackCooldown if applicable). */
  _shouldHealFriend(rule, gameState) {
    // Basic checks
    if (!gameState?.partyMembers || rule.friendHpTriggerPercentage == null) return false;

    // Check Attack Cooldown *only if* required by the rule
    if (rule.requireAttackCooldown && !gameState.attackCdActive) {
        return false; // Attack CD required but not active
    }

    const hpTriggerPercentage = parseInt(rule.friendHpTriggerPercentage, 10);
    // 0 = Any, 1 = First, 2 = Second, etc. (adjust if your UI uses 0 for first)
    const partyPositionIndex = parseInt(rule.partyPosition, 10);

    if (isNaN(partyPositionIndex) || partyPositionIndex < 0 || isNaN(hpTriggerPercentage)) {
       console.warn(`[RuleProc] Invalid partyPosition ('${rule.partyPosition}') or friendHpTriggerPercentage ('${rule.friendHpTriggerPercentage}') for rule ${rule.id}.`);
       return false;
    }

    if (partyPositionIndex === 0) { // Heal ANY party member below threshold
      return gameState.partyMembers.some(
        // Ensure HP is valid (not null/undefined, > 0) before comparing
        (member) => member.isActive && member.hpPercentage != null && member.hpPercentage > 0 && member.hpPercentage <= hpTriggerPercentage
      );
    } else { // Heal SPECIFIC party member
      const targetIndex = partyPositionIndex - 1;
      const targetMember = gameState.partyMembers?.[targetIndex];

      // Check if member exists, is active, and meets HP threshold (ensure HP is valid and > 0)
      return !!targetMember && targetMember.isActive && targetMember.hpPercentage != null && targetMember.hpPercentage > 0 && targetMember.hpPercentage <= hpTriggerPercentage;
    }
  }

  /** Finds the specific party member to target for rune healing based on the rule. */
  _findPartyHealTarget(rule, gameState) {
      const hpTriggerPercentage = parseInt(rule.friendHpTriggerPercentage, 10);
      const partyPositionIndex = parseInt(rule.partyPosition, 10);

      if (isNaN(partyPositionIndex) || partyPositionIndex < 0 || isNaN(hpTriggerPercentage)) {
          return null; // Basic validation failed
      }

      if (partyPositionIndex === 0) { // Target ANY member below threshold
          // Sort by HP percentage ascending to prioritize lowest health first
          const potentialTargets = gameState.partyMembers
              .filter(member => member.isActive && member.hpPercentage != null && member.hpPercentage > 0 && member.hpPercentage <= hpTriggerPercentage)
              .sort((a, b) => a.hpPercentage - b.hpPercentage);
          return potentialTargets[0] || null; // Return the lowest HP member or null
      } else { // Target SPECIFIC member
          const targetIndex = partyPositionIndex - 1;
          const targetMember = gameState.partyMembers?.[targetIndex];
          // Check if target exists and meets criteria (HP > 0)
          if (targetMember && targetMember.isActive && targetMember.hpPercentage != null && targetMember.hpPercentage > 0 && targetMember.hpPercentage <= hpTriggerPercentage) {
              return targetMember;
          }
          return null; // Target not found or doesn't meet criteria
      }
  }

  //endregion
}

export default RuleProcessor;