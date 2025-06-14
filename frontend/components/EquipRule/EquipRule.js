import React, { useCallback, useState, useMemo, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import keyboardKeys from '../../constants/keyboardKeys.js';
import actionBarItemsData from '../../../electron/constants/actionBarItems.js';
import { removeRule, updateRule, updateCondition } from '../../redux/slices/ruleSlice.js';
import CharacterStatusConditions from '../CharacterStatusConditions/CharacterStatusConditions.jsx';
import ConfirmDialog from '../ConfirmDialog/ConfirmDialog.jsx';
import CustomIconSelect from '../CustomIconSelect/CustomIconSelect.js';
import CustomSwitch from '../CustomSwitch/CustomSwitch.js';
import CustomSelect from '../CustomSelect/CustomSelect.js';

import { EquipRuleWrapper } from './EquipRule.styled.js';

const EquipRule = ({ rule, className }) => {
  const [show_confirm, set_show_confirm] = useState(false);
  const [is_expanded, set_is_expanded] = useState(false);

  const dispatch = useDispatch();
  const active_preset_index = useSelector((state) => state.rules.activePresetIndex);
  const current_rule = useSelector((state) =>
    state.rules.presets[active_preset_index]?.find((r) => r.id === rule.id),
  );

  const condition_options = useMemo(() => [
    { value: '<=', label: '≤' }, { value: '<', label: '<' },
    { value: '=', label: '=' }, { value: '>', label: '>' },
    { value: '>=', label: '≥' }, { value: '!=', label: '≠' },
  ], []);


  const handle_status_condition_change = useCallback((status, value) => {
    if (current_rule) dispatch(updateCondition({ id: current_rule.id, condition: status, value }));
  }, [dispatch, current_rule]);

  const handle_remove_rule = useCallback(() => set_show_confirm(true), []);
  const handle_confirm_remove = useCallback(() => {
    if (current_rule?.id) dispatch(removeRule(current_rule.id));
    set_show_confirm(false);
  }, [dispatch, current_rule]);
  const handle_cancel_remove = useCallback(() => set_show_confirm(false), []);

  const handle_field_change = useCallback((field) => (event) => {
    let value;
    if (event.target.type === 'checkbox') {
      value = event.target.checked;
    } else {
      value = event.target.value;
    }

    if (['hpTriggerPercentage', 'manaTriggerPercentage', 'monsterNum', 'priority', 'delay'].includes(field)) {
      value = Number(value);
    }

    if (field === 'equipOnlyIfSlotIsEmpty') {
      value = !!value;
    }


    if (current_rule?.id) {
      dispatch(updateRule({ id: current_rule.id, field, value }));
    }
  }, [dispatch, current_rule?.id]);


  const handle_action_item_change = useCallback((selected_action_item_key) => {
    if (current_rule?.id && selected_action_item_key !== null) {
      dispatch(updateRule({ id: current_rule.id, field: 'actionItem', value: selected_action_item_key }));
      const item_data = actionBarItemsData[selected_action_item_key];
      const inferred_slot = item_data?.slot;
      dispatch(updateRule({ id: current_rule.id, field: 'targetSlot', value: inferred_slot || '' }));
    } else if (current_rule?.id && selected_action_item_key === null) {
      dispatch(updateRule({ id: current_rule.id, field: 'actionItem', value: '' }));
      dispatch(updateRule({ id: current_rule.id, field: 'targetSlot', value: '' }));
    }
  }, [dispatch, current_rule?.id]);

  useEffect(() => {
    if (current_rule?.actionItem &&
      (!current_rule.targetSlot || actionBarItemsData[current_rule.actionItem]?.slot !== current_rule.targetSlot)) {
      const item_data = actionBarItemsData[current_rule.actionItem];
      const inferred_slot = item_data?.slot;
      if (inferred_slot) dispatch(updateRule({ id: current_rule.id, field: 'targetSlot', value: inferred_slot }));
      else dispatch(updateRule({ id: current_rule.id, field: 'targetSlot', value: '' }));
    } else if (current_rule && !current_rule.actionItem && current_rule.targetSlot) {
      dispatch(updateRule({ id: current_rule.id, field: 'targetSlot', value: '' }));
    }
  }, [current_rule?.actionItem, current_rule?.targetSlot, current_rule?.id, dispatch]);


  const handle_toggle_expand = useCallback(() => {
    set_is_expanded(prev => !prev);
  }, []);


  const equipment_action_item_options = useMemo(() => {
    const equipment_category_key = 'equipment';
    const items_group = { [equipment_category_key]: [] };
    Object.entries(actionBarItemsData).forEach(([key, item]) => {
      if (item && item.categories && item.categories.includes(equipment_category_key) && item.slot) {
        items_group[equipment_category_key].push({ value: key, label: item.name, iconName: item.iconName });
      }
    });
    if (items_group[equipment_category_key].length > 0) items_group[equipment_category_key].sort((a, b) => a.label.localeCompare(b.label));
    return items_group[equipment_category_key].length > 0 ? items_group : {};
  }, []);

  if (!current_rule) return null;

  const rule_enabled = current_rule.enabled ?? false;
  const rule_action_item = current_rule.actionItem || '';
  const rule_key = current_rule.key || 'F1';
  const rule_target_slot = current_rule.targetSlot || actionBarItemsData[rule_action_item]?.slot || '';
  const rule_equip_only_if_slot_is_empty = current_rule.equipOnlyIfSlotIsEmpty ?? true;
  const rule_hp_trigger_condition = current_rule.hpTriggerCondition || '<=';
  const rule_hp_trigger_percentage = current_rule.hpTriggerPercentage ?? 0;
  const rule_mana_trigger_condition = current_rule.manaTriggerCondition || '>=';
  const rule_mana_trigger_percentage = current_rule.manaTriggerPercentage ?? 0;
  const rule_monster_num_condition = current_rule.monsterNumCondition || '>=';
  const rule_monster_num = current_rule.monsterNum ?? 0;
  const rule_priority = current_rule.priority ?? 0;
  const rule_delay = current_rule.delay ?? 250;

  const is_disabled_equip_checkbox = (!rule_action_item || !rule_target_slot);


  return (
    <>
      {show_confirm && (
        <ConfirmDialog
          title="Remove Rule"
          text={`Delete this Equip Rule?`}
          onConfirm={handle_confirm_remove}
          onCancel={handle_cancel_remove}
        />
      )}
      <EquipRuleWrapper className={className} $running={rule_enabled}>
        <div className='row1'>
          <CustomSwitch
            checked={rule_enabled}
            onChange={handle_field_change('enabled')}
            label="Enable"
          />

          <CustomIconSelect
            id={`equip-actionitem-${rule.id}`}
            value={rule_action_item}
            options={equipment_action_item_options}
            allItemsData={actionBarItemsData}
            onChange={handle_action_item_change}
            placeholder="Select Equipment Item"
            className="action-item-select h38"
          />

          <CustomSelect
            className="hotkey-input h38"
            id="key"
            value={rule_key}
            options={keyboardKeys}
            onChange={handle_field_change('key')}
            label="Hotkey"
          />

          <button type="button" className="button-expand" onClick={handle_toggle_expand} $is_expanded={is_expanded}>
            {is_expanded ? '▲' : '▼'}
          </button>

          <button
            className="button-remove"
            type="button"
            onClick={handle_remove_rule}
            aria-label="remove-rule"
          >
            ×
          </button>
        </div>

        {is_expanded && (
          <>
            <div className='row2'>
              <div className='input-group'>
                <label className='label-text'>HP Trigger</label>
                <div className='input-row'>
                  <CustomSelect
                    id="hpTriggerCondition"
                    value={rule_hp_trigger_condition}
                    options={condition_options}
                    onChange={handle_field_change('hpTriggerCondition')}
                    className="h38"
                  />
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    id="hpTriggerPercentage"
                    value={rule_hp_trigger_percentage}
                    onChange={handle_field_change('hpTriggerPercentage')}
                    placeholder="0"
                    className="h38 percent-input"
                  />
                </div>
              </div>

              <div className='input-group'>
                <label className='label-text'>Mana Trigger</label>
                <div className='input-row'>
                  <CustomSelect
                    id="manaTriggerCondition"
                    value={rule_mana_trigger_condition}
                    options={condition_options}
                    onChange={handle_field_change('manaTriggerCondition')}
                    className="h38"
                  />
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    id="manaTriggerPercentage"
                    value={rule_mana_trigger_percentage}
                    onChange={handle_field_change('manaTriggerPercentage')}
                    placeholder="0"
                    className="h38 percent-input"
                  />
                </div>
              </div>

              <div className='input-group'>
                <label className='label-text'>Mobs Trigger</label>
                <div className='input-row'>
                  <CustomSelect
                    id="monsterNumCondition"
                    value={rule_monster_num_condition}
                    options={condition_options}
                    onChange={handle_field_change('monsterNumCondition')}
                    className="h38"
                  />
                  <input
                    type="number"
                    min="0"
                    max="10"
                    id="monsterNum"
                    value={rule_monster_num}
                    onChange={handle_field_change('monsterNum')}
                    placeholder="0"
                    className="h38 mobs-input"
                  />
                </div>
              </div>

              <div className='input-group'>
                <label className='label-text' >Priority</label>
                <input
                  type="number"
                  min="-999"
                  max="999"
                  id="priority"
                  value={rule_priority}
                  onChange={handle_field_change('priority')}
                  placeholder="Priority"
                  className="h38 priority-input"
                />
              </div>

              <div className='input-group'>
                <label className='label-text' >Delay (ms)</label>
                <input
                  type="number"
                  min="0"
                  step="50"
                  id="delay"
                  value={rule_delay}
                  onChange={handle_field_change('delay')}
                  placeholder="0"
                  className="h38 delay-input"
                />
              </div>

              <div className='input-group'>
                <label className='label-text' >Only if slot is empty</label>
                <CustomSwitch
                  checked={rule_equip_only_if_slot_is_empty}
                  onChange={handle_field_change('equipOnlyIfSlotIsEmpty')}
                  disabled={is_disabled_equip_checkbox}
                  title={is_disabled_equip_checkbox ? "Select an item with a slot to enable this" : "Only try to equip if the target slot is currently empty"}
                />
              </div>
            </div>
            <div className='row3'>
              <CharacterStatusConditions
                ruleId={rule.id}
                onStatusConditionChange={handle_status_condition_change}
                className='conditions'
              />
            </div>
          </>
        )}
      </EquipRuleWrapper >
    </>
  );
};

export default EquipRule;