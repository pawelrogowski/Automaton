import { getStoreClient } from './redisClient.js';
import { v4 as uuidv4 } from 'uuid';

const SLICE_NAME = 'healing';

// --- Initial State Definition (copied from original store.js) ---
export const initialHealingPreset = [
  { id: `userRule${uuidv4()}`, name: `Exura`, enabled: false, category: 'Healing', key: 'F1', hpTriggerCondition: '<=', hpTriggerPercentage: 80, manaTriggerCondition: '>', manaTriggerPercentage: 5, monsterNum: 0, monsterNumCondition: '>=', priority: 10, delay: 1000, isWalking: false, conditions: [], friendHpTriggerPercentage: 0, partyPosition: '0', requireAttackCooldown: false, useRune: false },
  { id: `userRule${uuidv4()}`, name: `ManaPot`, enabled: false, category: 'Potion', key: 'F12', hpTriggerCondition: '>', hpTriggerPercentage: 0, manaTriggerCondition: '<=', manaTriggerPercentage: 15, monsterNum: 0, monsterNumCondition: '>=', priority: 10, delay: 1000, isWalking: false, conditions: [], friendHpTriggerPercentage: 0, partyPosition: '0', requireAttackCooldown: false, useRune: false },
  { id: `userRule${uuidv4()}`, name: `Mana0Mob`, enabled: false, category: 'Potion', key: 'F12', hpTriggerCondition: '>', hpTriggerPercentage: 0, manaTriggerCondition: '<=', manaTriggerPercentage: 85, monsterNum: 0, monsterNumCondition: '=', priority: 0, delay: 1000, isWalking: false, conditions: [], friendHpTriggerPercentage: 0, partyPosition: '0', requireAttackCooldown: false, useRune: false },
  { id: `userRule${uuidv4()}`, name: `Haste`, enabled: false, category: 'Support', key: 'F4', hpTriggerCondition: '>', hpTriggerPercentage: 0, manaTriggerCondition: '>=', manaTriggerPercentage: 5, monsterNum: 0, monsterNumCondition: '>=', priority: 1, delay: 1000, isWalking: true, conditions: [ { name: 'hasted', value: false }, { name: 'inProtectedZone', value: false }, ], friendHpTriggerPercentage: 0, partyPosition: '0', requireAttackCooldown: false, useRune: false },
  { id: `manaSync${uuidv4()}`, name: `ManaPot`, enabled: false, category: 'Potion', key: 'F12', hpTriggerCondition: '>=', hpTriggerPercentage: 1, manaTriggerCondition: '<=', manaTriggerPercentage: 80, monsterNum: 0, monsterNumCondition: '>=', priority: 0, delay: 1000, isWalking: false, conditions: [], friendHpTriggerPercentage: 0, partyPosition: '0', requireAttackCooldown: false, useRune: false },
  { id: `healFriend${uuidv4()}`, name: 'UH Friend', enabled: false, category: 'Healing', key: 'T', hpTriggerCondition: '>', hpTriggerPercentage: 0, manaTriggerCondition: '>', manaTriggerPercentage: 0, friendHpTriggerPercentage: 50, monsterNum: 0, monsterNumCondition: '>=', priority: 9, requireAttackCooldown: false, useRune: true, partyPosition: '0', delay: 150, isWalking: false, conditions: [] },
];
export const initialHealingState = {
  presets: Array(5).fill(null).map(() => JSON.parse(JSON.stringify(initialHealingPreset))),
  activePresetIndex: 0,
  sortOrder: {},
};


// --- Validation Helper (copied from original store.js) ---
const validateField = (field, value) => {
   switch (field) {
    case 'friendHpTriggerPercentage':
    case 'hpTriggerPercentage':
    case 'manaTriggerPercentage':
      const parsedPercent = parseInt(value, 10);
      return isNaN(parsedPercent) ? 0 : Math.max(0, Math.min(100, parsedPercent));
    case 'monsterNum':
      const parsedMonsterNum = parseInt(value, 10);
      return isNaN(parsedMonsterNum) ? 0 : Math.max(0, Math.min(10, parsedMonsterNum));
    case 'priority':
       const parsedPriority = parseInt(value, 10);
      return isNaN(parsedPriority) ? 0 : Math.max(-99, Math.min(99, parsedPriority));
    case 'delay':
      const parsedDelay = parseInt(value, 10);
      return isNaN(parsedDelay) ? 0 : Math.max(0, Math.min(86400000, parsedDelay));
    case 'partyPosition':
        const parsedPos = parseInt(value, 10);
        return isNaN(parsedPos) ? '0' : String(Math.max(0, parsedPos)); // Keep as string? Original was string
    // Booleans
    case 'enabled':
    case 'isWalking':
    case 'requireAttackCooldown':
    case 'useRune':
        return Boolean(value);
    // Strings or others
    default:
      return typeof value === 'string' ? value : (value ?? '');
  }
};

// --- Getters ---
export async function getHealingState() {
  const client = getStoreClient();
  if (!client) return null;
  try {
    const value = await client.get(SLICE_NAME);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error(`[${SLICE_NAME}Store] Error getting state:`, error);
    return null;
  }
}

// --- Setters / Updaters (Rule Manipulation - copied/adapted from original store.js) ---

export async function updateHealingRuleField(ruleId, field, value) {
   const client = getStoreClient();
   if (!client) return false;
   try {
    await client.watch(SLICE_NAME);
    const healingState = await getHealingState(); // Use own getter
     if (!healingState || !healingState.presets || healingState.activePresetIndex == null || !healingState.presets[healingState.activePresetIndex]) {
      console.error(`[${SLICE_NAME}Store] Cannot update rule field: State/preset invalid.`);
      await client.unwatch(); return false;
    }
    const newHealingState = JSON.parse(JSON.stringify(healingState));
    const ruleIndex = newHealingState.presets[newHealingState.activePresetIndex].findIndex(r => r.id === ruleId);
    if (ruleIndex === -1) {
      console.warn(`[${SLICE_NAME}Store] Rule ID ${ruleId} not found.`);
      await client.unwatch(); return false;
    }
    newHealingState.presets[newHealingState.activePresetIndex][ruleIndex][field] = validateField(field, value);

    const multi = client.multi().set(SLICE_NAME, JSON.stringify(newHealingState));
    const results = await multi.exec();
    if (results === null) { console.warn(`[${SLICE_NAME}Store] Update conflict on rule field.`); return false; }
    // console.log(`[${SLICE_NAME}Store] Updated field ${field} for rule ${ruleId}.`);
    return true;
  } catch (error) {
    console.error(`[${SLICE_NAME}Store] Error updating rule field ${ruleId}:`, error);
    await client.unwatch(); return false;
  }
}

export async function updateHealingRuleCondition(ruleId, conditionName, conditionValue) {
    const client = getStoreClient();
    if (!client) return false;
   try {
    await client.watch(SLICE_NAME);
    const healingState = await getHealingState();
     if (!healingState || !healingState.presets || healingState.activePresetIndex == null || !healingState.presets[healingState.activePresetIndex]) {
       console.error(`[${SLICE_NAME}Store] Cannot update rule condition: State/preset invalid.`);
       await client.unwatch(); return false;
     }
    const newHealingState = JSON.parse(JSON.stringify(healingState));
    const rule = newHealingState.presets[newHealingState.activePresetIndex].find(r => r.id === ruleId);
    if (!rule) { console.warn(`[${SLICE_NAME}Store] Rule ID ${ruleId} not found for condition update.`); await client.unwatch(); return false; }
    if (!rule.conditions) rule.conditions = [];
    const conditionIndex = rule.conditions.findIndex(c => c.name === conditionName);
    if (conditionIndex !== -1) {
      if (conditionValue === undefined || conditionValue === null) { rule.conditions.splice(conditionIndex, 1); }
      else { rule.conditions[conditionIndex].value = conditionValue; }
    } else if (conditionValue !== undefined && conditionValue !== null) {
      rule.conditions.push({ name: conditionName, value: conditionValue });
    } else { await client.unwatch(); return true; } // No change needed

    const multi = client.multi().set(SLICE_NAME, JSON.stringify(newHealingState));
    const results = await multi.exec();
    if (results === null) { console.warn(`[${SLICE_NAME}Store] Update conflict on rule condition.`); return false; }
    // console.log(`[${SLICE_NAME}Store] Updated condition ${conditionName} for rule ${ruleId}.`);
    return true;
  } catch (error) {
    console.error(`[${SLICE_NAME}Store] Error updating rule condition ${ruleId}:`, error);
    await client.unwatch(); return false;
  }
}

export async function addHealingRule() {
    const client = getStoreClient();
    if (!client) return null;
    const newRuleId = `userRule${uuidv4()}`;
   try {
    await client.watch(SLICE_NAME);
    const healingState = await getHealingState();
    if (!healingState || !healingState.presets || healingState.activePresetIndex == null || !healingState.presets[healingState.activePresetIndex]) {
       console.error(`[${SLICE_NAME}Store] Cannot add rule: State/preset invalid.`);
       await client.unwatch(); return null;
     }
     const newRule = { id: newRuleId, enabled: false, name: `New Rule`, category: 'Healing', key: 'F1', hpTriggerCondition: '<=', hpTriggerPercentage: 80, manaTriggerCondition: '>=', manaTriggerPercentage: 20, monsterNumCondition: '>=', monsterNum: 0, priority: 0, delay: 250, conditions: [], isWalking: false, friendHpTriggerPercentage: 0, partyPosition: '0', requireAttackCooldown: false, useRune: false };
    const newHealingState = JSON.parse(JSON.stringify(healingState));
    newHealingState.presets[newHealingState.activePresetIndex].push(newRule);

    const multi = client.multi().set(SLICE_NAME, JSON.stringify(newHealingState));
    const results = await multi.exec();
    if (results === null) { console.warn(`[${SLICE_NAME}Store] Update conflict adding rule.`); return null; }
    console.log(`[${SLICE_NAME}Store] Added rule ${newRuleId}.`);
    return newRuleId;
  } catch (error) {
    console.error(`[${SLICE_NAME}Store] Error adding rule:`, error);
    await client.unwatch(); return null;
  }
}

export async function removeHealingRule(ruleId) {
    const client = getStoreClient();
    if (!client) return false;
   try {
    await client.watch(SLICE_NAME);
    const healingState = await getHealingState();
     if (!healingState || !healingState.presets || healingState.activePresetIndex == null || !healingState.presets[healingState.activePresetIndex]) {
       console.error(`[${SLICE_NAME}Store] Cannot remove rule: State/preset invalid.`);
       await client.unwatch(); return false;
     }
    const newHealingState = JSON.parse(JSON.stringify(healingState));
    const preset = newHealingState.presets[newHealingState.activePresetIndex];
    const initialLength = preset.length;
    newHealingState.presets[newHealingState.activePresetIndex] = preset.filter(r => r.id !== ruleId);
    if (newHealingState.presets[newHealingState.activePresetIndex].length === initialLength) {
      console.warn(`[${SLICE_NAME}Store] Rule ID ${ruleId} not found for removal.`);
      await client.unwatch(); return false;
    }

    const multi = client.multi().set(SLICE_NAME, JSON.stringify(newHealingState));
    const results = await multi.exec();
    if (results === null) { console.warn(`[${SLICE_NAME}Store] Update conflict removing rule.`); return false; }
    console.log(`[${SLICE_NAME}Store] Removed rule ${ruleId}.`);
    return true;
  } catch (error) {
    console.error(`[${SLICE_NAME}Store] Error removing rule ${ruleId}:`, error);
    await client.unwatch(); return false;
  }
}

// --- Add functions for setActivePresetIndex, copyPreset etc. similarly ---
export async function setActiveHealingPresetIndex(index) {
    // Ensure index is within bounds (0-4)
    const validIndex = Math.max(0, Math.min(4, parseInt(index, 10) || 0));
    return updateStateSlice(SLICE_NAME, { activePresetIndex: validIndex });
}

// Placeholder - updateStateSlice lives in store.js now, need generic update helper or move logic
// This needs adjustment: either create a generic updateStateSlice helper accessible here
// or implement the logic directly like the other functions in this file.
// Let's implement directly for consistency within this file:
export async function setActivePresetIndex_Healing(index) {
    const client = getStoreClient();
    if (!client) return false;
    const validIndex = Math.max(0, Math.min(4, parseInt(index, 10) || 0)); // Assuming 5 presets max index 4
    try {
        await client.watch(SLICE_NAME);
        const currentState = await getHealingState();
        if (currentState === null) {
             console.error(`[${SLICE_NAME}Store] Cannot set preset index: state not found.`);
             await client.unwatch(); return false;
        }
        const newState = { ...currentState, activePresetIndex: validIndex };
        const multi = client.multi().set(SLICE_NAME, JSON.stringify(newState));
        const results = await multi.exec();
        if (results === null) { console.warn(`[${SLICE_NAME}Store] Update conflict setting preset index.`); return false; }
        console.log(`[${SLICE_NAME}Store] Set active preset index to ${validIndex}.`);
        return true;
    } catch (error) {
        console.error(`[${SLICE_NAME}Store] Error setting active preset index:`, error);
        await client.unwatch(); return false;
    }
}

// Add copyPreset, sortRulesBy similarly if needed 