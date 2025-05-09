import { createSlice } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';
import actionBarItemsData from '../../../electron/constants/actionBarItems.js'; // Import for defaults
import equippedItems from '../../../electron/constants/equippedItems.js'; // Import for equipped items

// Define the allowed potion keys for ManaSync rules (can be shared or redefined)
const ALLOWED_POTION_KEYS = new Set([
    'healthPotion', 'strongHealthPotion', 'greatHealthPotion', 'ultimateHealthPotion',
    'supremeHealthPotion', 'smallHealthPotion', 'manaPotion', 'strongManaPotion',
    'greatManaPotion', 'ultimateManaPotion', 'greatSpiritPotion', 'ultimateSpiritPotion',
]);

// Find a default potion actionItem key (e.g., the first one in the set)
const getDefaultPotionActionItem = () => {
    for (const key of ALLOWED_POTION_KEYS) {
        // Check if it exists in the main data just in case
        if (actionBarItemsData[key]) {
            return key;
        }
    }
    return ''; // Fallback if no valid default is found
};

const DEFAULT_POTION_ACTION_ITEM = getDefaultPotionActionItem();

// Find a default action bar item for equip rules (e.g., stoneSkinAmulet if available)
const getDefaultEquipActionItem = () => {
    const itemWithSlot = Object.keys(actionBarItemsData).find(key => actionBarItemsData[key].slot && actionBarItemsData[key].categories?.includes('equipment'));
    if (itemWithSlot) return itemWithSlot;
    const firstActionItem = Object.keys(actionBarItemsData)[0];
    return firstActionItem || '';
};
const DEFAULT_EQUIP_ACTION_ITEM = getDefaultEquipActionItem();
const DEFAULT_INFERRED_SLOT_FOR_EQUIP = actionBarItemsData[DEFAULT_EQUIP_ACTION_ITEM]?.slot || 'amulet';

// Get a default item name from equippedItems (e.g., emptyAmuletSlot)
const getDefaultSlotMustBeItem = () => {
    if (actionBarItemsData.emptyAmuletSlot) return 'emptyAmuletSlot'; // Assuming equippedItems might have this, or use a known key
    const firstEquippedItemKey = Object.keys(equippedItems).find(key => key.toLowerCase().includes('empty')); // Prioritize an "empty" state
    return firstEquippedItemKey || Object.keys(equippedItems)[0] || '';
}
const DEFAULT_SLOT_MUST_BE_ITEM = getDefaultSlotMustBeItem();

// Default for slotMustBeItemName in equipRule template
const DEFAULT_SLOT_CONDITION = '_ANY_'; // Represents "Don't care"

// Helper to validate delay (e.g., positive integer)
const validateDelay = (value) => {
  const num = parseInt(value, 10);
  return isNaN(num) || num < 0 ? 0 : num;
};

const initialPreset = [
  // {
  //   id: `userRule${uuidv4()}`,
  //   name: `Exura`,
  //   enabled: false,
  //   category: 'Healing',
  //   key: 'F1',
  //   hpTriggerCondition: '<=',
  //   hpTriggerPercentage: 80,
  //   manaTriggerCondition: '>',
  //   manaTriggerPercentage: 5,
  //   monsterNum: 0,
  //   monsterNumCondition: '>=',
  //   priority: 10,
  //   delay: 1000,
  //   isWalking: false,
  //   conditions: [],
  // },
  // {
  //   id: `userRule${uuidv4()}`,
  //   name: `ManaPot`,
  //   enabled: false,
  //   category: 'Potion',
  //   key: 'F12',
  //   hpTriggerCondition: '>',
  //   hpTriggerPercentage: 0,
  //   manaTriggerCondition: '<=',
  //   manaTriggerPercentage: 15,
  //   monsterNum: 0,
  //   monsterNumCondition: '>=',
  //   priority: 10,
  //   delay: 1000,
  //   isWalking: false,
  //   conditions: [],
  // },
  // {
  //   id: `userRule${uuidv4()}`,
  //   name: `Mana0Mob`,
  //   enabled: false,
  //   category: 'Potion',
  //   key: 'F12',
  //   hpTriggerCondition: '>',
  //   hpTriggerPercentage: 0,
  //   manaTriggerCondition: '<=',
  //   manaTriggerPercentage: 85,
  //   monsterNum: 0,
  //   monsterNumCondition: '=',
  //   priority: 0,
  //   delay: 1000,
  //   isWalking: false,
  //   conditions: [],
  // },
  // {
  //   id: `userRule${uuidv4()}`,
  //   name: `Haste`,
  //   enabled: false,
  //   category: 'Support',
  //   key: 'F4',
  //   hpTriggerCondition: '>',
  //   hpTriggerPercentage: 0,
  //   manaTriggerCondition: '>=',
  //   manaTriggerPercentage: 5,
  //   monsterNum: 0,
  //   monsterNumCondition: '>=',
  //   priority: 1,
  //   delay: 1000,
  //   isWalking: true,
  //   conditions: [
  //     {
  //       name: 'hasted',
  //       value: false,
  //     },
  //     {
  //       name: 'inProtectedZone',
  //       value: false,
  //     },
  //   ],
  // },
  // {
  //   id: `actionBarItem${uuidv4()}`,
  //   name: `ActionBarRule${uuidv4()}`,
  //   enabled: false,
  //   actionItem: "exuraVita",
  //   key: 'F4',
  //   hpTriggerCondition: '>',
  //   hpTriggerPercentage: 0,
  //   manaTriggerCondition: '>=',
  //   manaTriggerPercentage: 5,
  //   monsterNum: 0,
  //   monsterNumCondition: '>=',
  //   priority: 0,
  //   isWalking: false,
  //   conditions: [
  //   ],
  // },
  // {
  //   id: `manaSync${uuidv4()}`,
  //   name: `ManaPot`,
  //   category: "Potion",
  //   enabled: false,
  //   key: 'F12',
  //   hpTriggerCondition: '>=',
  //   hpTriggerPercentage: 1,
  //   manaTriggerCondition: '<=',
  //   manaTriggerPercentage: 80,
  //   monsterNum: 0,
  //   monsterNumCondition: '>=',
  //   priority: 0,
  //   conditions: [],
  // },
  // {
  //   id: `healFriend${uuidv4()}`,
  //   name: 'UH Friend',
  //   enabled: false,
  //   actionItem: 'ultimateHealingRune',
  //   key: 'T',
  //   friendHpTriggerPercentage: '50',
  //   priority: '9',
  //   requireAttackCooldown: false,
  //   partyPosition: '0',
  //   conditions: [],
  // },
  // {
  //   id: `rotationRule${uuidv4()}`,
  //   name: 'Example Rotation',
  //   enabled: false,
  //   repeat: true,
  //   modifierKey: '',
  //   activationKey: 'F1',
  //   priority: 0,
  //   conditions: [],
  //   sequence: [
  //     { key: 'F1', delay: 1000, leftClick: false },
  //     { key: 'F2', delay: 1500, leftClick: false },
  //   ],
  // },
  // {
  //   id: `equipRule${uuidv4()}`,
  //   name: 'New Equip Rule',
  //   enabled: false,
  //   actionItem: DEFAULT_EQUIP_ACTION_ITEM,
  //   key: 'F5',
  //   targetSlot: DEFAULT_INFERRED_SLOT_FOR_EQUIP,
  //   equipOnlyIfSlotIsEmpty: true,
  //   hpTriggerCondition: '<=',
  //   hpTriggerPercentage: 60,
  //   manaTriggerCondition: '>',
  //   manaTriggerPercentage: 0,
  //   monsterNum: 0,
  //   monsterNumCondition: '>=',
  //   priority: 5,
  //   delay: 250,
  //   conditions: [],
  // },
];

const initialState = {
  presets: [initialPreset, initialPreset, initialPreset, initialPreset, initialPreset],
  activePresetIndex: 0,
  sortBy: ['priority'],
  sortOrder: { priority: 'desc' },
};

const sortingCriteriaMap = {
  enabled: { key: 'enabled', type: 'boolean' },
  name: { key: 'name', type: 'string' },
  category: { key: 'category', type: 'string' },
  key: { key: 'key', type: 'string' },
  priority: { key: 'priority', type: 'number' },
  monsterNum: { key: 'monsterNum', type: 'number' },
  hpTriggerPercentage: { key: 'hpTriggerPercentage', type: 'number' },
  manaTriggerPercentage: { key: 'manaTriggerPercentage', type: 'number' },
  friendHpTriggerPercentage: { key: 'friendHpTriggerPercentage', type: 'number' },
  partyPosition: { key: 'partyPosition', type: 'number' },
  requireAttackCooldown: { key: 'requireAttackCooldown', type: 'boolean' },
  actionItem: { key: 'actionItem', type: 'string' },
  targetSlot: { key: 'targetSlot', type: 'string' },
  equipOnlyIfSlotIsEmpty: { key: 'equipOnlyIfSlotIsEmpty', type: 'boolean' },
};

const sortPresetRules = (state) => {
  const { sortBy, sortOrder } = state;
  if (!sortBy || sortBy.length === 0) return;

  const compareValues = (a, b, type, isAscending) => {
    let comparison;
    if (type === 'number') {
      comparison = (Number(a) || 0) - (Number(b) || 0);
    } else if (type === 'string') {
      comparison = String(a || '').localeCompare(String(b || ''));
    } else if (type === 'boolean') {
      comparison = a === b ? 0 : a ? -1 : 1;
    } else {
      return 0;
    }
    return isAscending ? comparison : -comparison;
  };

  state.presets[state.activePresetIndex].sort((a, b) => {
    for (const criterion of sortBy) {
      const criteriaDefinition = sortingCriteriaMap[criterion];
      if (!criteriaDefinition) {
        console.warn(`Sorting criterion "${criterion}" not found.`);
        continue;
      }
      const { key, type } = criteriaDefinition;
      const isAscending = sortOrder[criterion] !== 'desc';
      const valueA = a && typeof a === 'object' && a.hasOwnProperty(key) ? a[key] : undefined;
      const valueB = b && typeof b === 'object' && b.hasOwnProperty(key) ? b[key] : undefined;

      if (valueA === undefined || valueA === null) {
        return (valueB === undefined || valueB === null) ? 0 : (isAscending ? 1 : -1);
      }
      if (valueB === undefined || valueB === null) {
        return isAscending ? -1 : 1;
      }

      const comparison = compareValues(valueA, valueB, type, isAscending);
      if (comparison !== 0) return comparison;
    }
    return 0;
  });
};

const validateField = (field, value) => {
  switch (field) {
    case 'friendHpTriggerPercentage':
    case 'hpTriggerPercentage':
    case 'manaTriggerPercentage':
      return Math.max(0, Math.min(100, parseInt(value, 10) || 0));
    case 'monsterNum':
      return Math.max(0, Math.min(10, parseInt(value, 10) || 0));
    case 'priority':
      return Math.max(-999, Math.min(999, parseInt(value, 10) || 0));
    case 'partyPosition':
      return Math.max(0, Math.min(10, parseInt(value, 10) || 0));
    default:
      return value;
  }
};

const validateRule = (rule) => {
  // Start with common validations
  const validated = {
    ...rule,
    modifierKey: rule.modifierKey ?? '',
    activationKey: rule.activationKey ?? 'F1',
    friendHpTriggerPercentage: Math.max(0, Math.min(100, parseInt(rule.friendHpTriggerPercentage, 10) || 80)),
    hpTriggerPercentage: Math.max(0, Math.min(100, parseInt(rule.hpTriggerPercentage, 10) || 0)),
    manaTriggerPercentage: Math.max(0, Math.min(100, parseInt(rule.manaTriggerPercentage, 10) || 0)),
    monsterNum: Math.max(0, Math.min(10, parseInt(rule.monsterNum, 10) || 0)),
    priority: Math.max(-99, Math.min(99, parseInt(rule.priority, 10) || 0)),
    delay: Math.max(0, Math.min(86400000, parseInt(rule.delay, 10) || 0)),
  };
  // Clean up potentially obsolete fields
  delete validated.useRune;
  delete validated.slotMustBeItemName; 

  // --- Rule Type Specific Validation ---

  if (rule.id.startsWith('equipRule')) {
    const itemData = actionBarItemsData[rule.actionItem];
    validated.actionItem = (itemData && itemData.categories?.includes('equipment') && itemData.slot) ? rule.actionItem : '';
    const inferredSlotFromActionItem = actionBarItemsData[validated.actionItem]?.slot;
    validated.key = rule.key || 'F5';
    validated.targetSlot = inferredSlotFromActionItem || rule.targetSlot || DEFAULT_INFERRED_SLOT_FOR_EQUIP;
    validated.equipOnlyIfSlotIsEmpty = typeof rule.equipOnlyIfSlotIsEmpty === 'boolean' ? rule.equipOnlyIfSlotIsEmpty : true;
    delete validated.isWalking; // Explicitly remove isWalking for equipRule
    delete validated.category; // Equip rules don't use category

  } else if (rule.id.startsWith('userRule')) {
      // Ensure userRule keeps its category and isWalking
      validated.category = rule.category || 'Healing'; // Default category if missing
      validated.isWalking = typeof rule.isWalking === 'boolean' ? rule.isWalking : false; // Ensure boolean, default false

  } else if (rule.id.startsWith('actionBarItem')) {
      // Ensure actionBarItem keeps its isWalking
      validated.actionItem = rule.actionItem || ''; // Default actionItem if missing
      validated.isWalking = typeof rule.isWalking === 'boolean' ? rule.isWalking : false; // Ensure boolean, default false
      delete validated.category; // Action bar rules don't use category

  } else if (rule.id.startsWith('healFriend')) {
      validated.actionItem = rule.actionItem || 'ultimateHealingRune'; // Default actionItem
      validated.requireAttackCooldown = typeof rule.requireAttackCooldown === 'boolean' ? rule.requireAttackCooldown : false;
      validated.partyPosition = String(validateField('partyPosition', rule.partyPosition ?? '0')); // Ensure string after validation
      delete validated.category; // Heal friend rules don't use category
      delete validated.isWalking; // Heal friend rules don't use isWalking

  } else if (rule.id.startsWith('manaSync')) {
      validated.actionItem = rule.actionItem || DEFAULT_POTION_ACTION_ITEM; // Default actionItem
      delete validated.category; // Mana sync rules don't use category
      delete validated.isWalking; // Mana sync rules don't use isWalking
      delete validated.delay;
      delete validated.monsterNum;
      delete validated.monsterNumCondition;

  } else if (rule.id.startsWith('rotationRule')) {
      validated.repeat = typeof rule.repeat === 'boolean' ? rule.repeat : true;
      delete validated.category; // Rotation rules don't use category
      delete validated.isWalking; // Rotation rules don't use isWalking
      delete validated.delay; // Delay is per-step
      delete validated.key;   // Key is per-step
  }
  // --- End Rule Type Specific Validation ---

  // Sequence validation (applies only if sequence exists, e.g., for rotationRule)
  if (validated.sequence && Array.isArray(validated.sequence)) {
      validated.sequence = validated.sequence.map(step => ({
          key: step.key || 'F1', // Default key
          delay: validateDelay(step.delay ?? 1000), // Validate and default delay
          leftClick: typeof step.leftClick === 'boolean' ? step.leftClick : false // Ensured boolean
      }));
  }

  return validated;
};

const healingSlice = createSlice({
  name: 'healing',
  initialState,
  reducers: {
    addRule: (state, action) => {
      const ruleId = action.payload;
      let newRule;

      if (ruleId && typeof ruleId === 'string' && ruleId.startsWith('manaSync')) {
        newRule = {
          id: ruleId, enabled: true, name: `Mana Sync Rule`,
          actionItem: DEFAULT_POTION_ACTION_ITEM, key: 'F12',
          hpTriggerCondition: '>=', hpTriggerPercentage: 1,
          manaTriggerCondition: '<=', manaTriggerPercentage: 80,
          priority: 0,
          conditions: [],
        };
      } else if (ruleId && typeof ruleId === 'string' && ruleId.startsWith('healFriend')) {
         newRule = {
            id: ruleId, enabled: false, name: 'New Party Heal',
            actionItem: 'ultimateHealingRune', key: 'T',
            hpTriggerCondition: '>', hpTriggerPercentage: 0,
            manaTriggerCondition: '>', manaTriggerPercentage: 0,
            friendHpTriggerPercentage: '50',
            priority: 9, requireAttackCooldown: false, partyPosition: '0',
            conditions: [],
         };
      } else if (ruleId && typeof ruleId === 'string' && ruleId.startsWith('actionBarItem')) {
          newRule = {
              id: ruleId, enabled: false, name: `New Action Rule`,
              actionItem: "", key: 'F1',
              hpTriggerCondition: '<=', hpTriggerPercentage: 90,
              manaTriggerCondition: '>=', manaTriggerPercentage: 0,
              monsterNumCondition: '>=', monsterNum: 0,
              priority: 0, delay: 0,
              isWalking: false,
              conditions: [],
          };
      } else if (ruleId && typeof ruleId === 'string' && ruleId.startsWith('rotationRule')) {
          newRule = {
              id: ruleId,
              name: 'New Rotation',
              enabled: false,
              repeat: true,
              modifierKey: '',
              activationKey: 'F1',
              priority: 0,
              conditions: [],
              sequence: [
                  { key: 'F1', delay: 1000, leftClick: false },
                  { key: 'F2', delay: 1000, leftClick: false },
                  { key: 'F3', delay: 1000, leftClick: false },
                  { key: 'F4', delay: 1000, leftClick: false },
                  { key: 'F5', delay: 1000, leftClick: false },
                  { key: 'F6', delay: 1000, leftClick: false },
              ],
          };
      } else if (ruleId && typeof ruleId === 'string' && ruleId.startsWith('equipRule')) {
        const defaultActionItem = DEFAULT_EQUIP_ACTION_ITEM;
        const defaultInferredSlot = actionBarItemsData[defaultActionItem]?.slot || 'amulet';
        newRule = {
            id: ruleId,
            name: 'New Equip Rule',
            enabled: false,
            actionItem: defaultActionItem,
            key: 'F5',
            targetSlot: defaultInferredSlot,
            equipOnlyIfSlotIsEmpty: true,
            hpTriggerCondition: '<=',
            hpTriggerPercentage: 60,
            manaTriggerCondition: '>',
            manaTriggerPercentage: 0,
            monsterNumCondition: '>=',
            monsterNum: 0,
            priority: 5,
            delay: 250,
            conditions: [],
        };
      } else {
        newRule = {
          id: ruleId || `userRule${uuidv4()}`, enabled: false, name: `New Rule`,
          category: 'Healing',
          key: 'F1',
          hpTriggerCondition: '<=', hpTriggerPercentage: 80,
          manaTriggerCondition: '>=', manaTriggerPercentage: 20,
          monsterNumCondition: '>=', monsterNum: 0,
          priority: 0,
          delay: 1000,
          isWalking: false,
          conditions: [],
        };
      }

      if (newRule) {
         state.presets[state.activePresetIndex].push(validateRule(newRule));
         sortPresetRules(state);
      } else {
         console.warn("No rule type matched for ID:", ruleId);
      }
    },

    removeRule: (state, action) => {
      state.presets[state.activePresetIndex] = state.presets[state.activePresetIndex].filter((rule) => rule.id !== action.payload);
    },
    updateRule: (state, action) => {
      const { id, field, value } = action.payload;

      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);

      if (ruleIndex !== -1) {
        let actualValue = value;
        const booleanFields = ['enabled', 'equipOnlyIfSlotIsEmpty', 'isWalking', 'requireAttackCooldown', 'repeat'];
        if (booleanFields.includes(field)) {
            actualValue = (value === 'true' || value === true);
        }



        state.presets[state.activePresetIndex][ruleIndex][field] = validateField(field, actualValue);



        state.presets[state.activePresetIndex][ruleIndex] = validateRule(state.presets[state.activePresetIndex][ruleIndex]);


        
        sortPresetRules(state);
      } 
      
    },

    updateCondition: (state, action) => {
      const { id, condition, value } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);

      if (ruleIndex !== -1) {
        const rule = state.presets[state.activePresetIndex][ruleIndex];
        if (!rule.conditions) {
            rule.conditions = [];
        }
        const conditionIndex = rule.conditions.findIndex((c) => c.name === condition);

        if (conditionIndex !== -1) {
          if (value === undefined) {
            rule.conditions.splice(conditionIndex, 1);
          } else {
            rule.conditions[conditionIndex].value = value;
          }
        } else if (value !== undefined) {
          rule.conditions.push({ name: condition, value });
        }
      }
    },

    removeCondition: (state, action) => {
      const { id, condition } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);

      if (ruleIndex !== -1 && state.presets[state.activePresetIndex][ruleIndex].conditions) {
        state.presets[state.activePresetIndex][ruleIndex].conditions = state.presets[state.activePresetIndex][ruleIndex].conditions.filter(
          (c) => c.name !== condition,
        );
      }
    },

    loadRules: (state, action) => {
      state.presets[state.activePresetIndex] = action.payload.map(rule => validateRule(rule));
      sortPresetRules(state);
    },

    setActivePresetIndex: (state, action) => {
      const newIndex = parseInt(action.payload, 10);
      if (!isNaN(newIndex) && newIndex >= 0 && newIndex < state.presets.length) {
        state.activePresetIndex = newIndex;
        sortPresetRules(state);
      }
    },
    setState: (state, action) => {
      const loadedState = action.payload;
      // Apply validateRule during load/set state to clean up/migrate old states
      const cleanPreset = (preset) => (preset && Array.isArray(preset) ? preset.map(rule => validateRule(rule)) : []);

      if (loadedState && typeof loadedState === 'object') {
        if (!Array.isArray(loadedState.presets)) {
          state.presets = [cleanPreset(loadedState.presets || initialPreset)];
          state.activePresetIndex = 0;
        } else {
          state.presets = loadedState.presets.map((preset) => cleanPreset(preset));
          state.activePresetIndex = Math.max(0, Math.min((state.presets?.length || 1) - 1, parseInt(loadedState.activePresetIndex, 10) || 0));
        }
        state.sortBy = loadedState.sortBy || initialState.sortBy;
        state.sortOrder = loadedState.sortOrder || initialState.sortOrder;
        sortPresetRules(state);
      } else {
        Object.assign(state, initialState);
        sortPresetRules(state);
      }
    },
    sortRulesBy: (state, action) => {
      const newSortByRaw = action.payload;
      const newSortBy = Array.isArray(newSortByRaw) ? newSortByRaw : [newSortByRaw];

      if (newSortBy.length === 0 || !sortingCriteriaMap[newSortBy[0]]) {
        console.warn("Invalid sort criteria provided:", newSortByRaw);
        return;
      }

      const primaryCriterion = newSortBy[0];

      if (state.sortBy && state.sortBy[0] === primaryCriterion) {
        state.sortOrder[primaryCriterion] = state.sortOrder[primaryCriterion] === 'desc' ? 'asc' : 'desc';
      } else {
        state.sortOrder = { [primaryCriterion]: sortingCriteriaMap[primaryCriterion].type === 'number' || primaryCriterion === 'priority' ? 'desc' : 'asc' };
      }

      state.sortBy = newSortBy;

      newSortBy.slice(1).forEach(criterion => {
        if (!state.sortOrder[criterion] && sortingCriteriaMap[criterion]) {
          state.sortOrder[criterion] = sortingCriteriaMap[criterion].type === 'number' ? 'desc' : 'asc';
        }
      });
      sortPresetRules(state);
    },
    copyPreset: (state, action) => {
      const { sourceIndex, targetIndex } = action.payload;
      if (sourceIndex !== targetIndex && sourceIndex >= 0 && sourceIndex < state.presets.length && targetIndex >= 0 && targetIndex < state.presets.length) {
        state.presets[targetIndex] = JSON.parse(JSON.stringify(state.presets[sourceIndex]));
        if (targetIndex === state.activePresetIndex) {
          sortPresetRules(state);
        }
      }
    },
  },
});

export const {
  addRule,
  removeRule,
  updateRule,
  updateCondition,
  removeCondition,
  loadRules,
  setActivePresetIndex,
  setState,
  sortRulesBy,
  copyPreset,
} = healingSlice.actions;

export default healingSlice;
