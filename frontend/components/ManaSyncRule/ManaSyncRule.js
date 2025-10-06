import React, { useCallback, useState, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import keyboardKeys from '../../constants/keyboardKeys.js';
import actionBarItemsData from '../../../electron/constants/actionBarItems.js';
import CharacterStatusConditions from '../CharacterStatusConditions/CharacterStatusConditions.jsx';

import { removeRule, updateCondition, updateRule } from '../../redux/slices/ruleSlice.js';
import ConfirmDialog from '../ConfirmDialog/ConfirmDialog.jsx';
import CustomIconSelect from '../CustomIconSelect/CustomIconSelect.js';
import CustomSwitch from '../CustomSwitch/CustomSwitch.js';
import CustomSelect from '../CustomSelect/CustomSelect.js';

import { ManaSyncRuleWrapper } from './ManaSyncRule.styled.js';

const ALLOWED_POTION_KEYS = new Set([
  'manaPotion',
  'strongManaPotion',
  'greatManaPotion',
  'ultimateManaPotion',
  'greatSpiritPotion',
  'ultimateSpiritPotion',
  'transcendencePotion',
]);

const ManaSyncRule = ({ rule, className }) => {
  const [show_confirm, set_show_confirm] = useState(false);
  const [is_expanded, set_is_expanded] = useState(false);

  const dispatch = useDispatch();
  // Use the rule prop directly instead of re-selecting from Redux (optimization)
  const current_rule = rule;

  const condition_options = useMemo(() => [
    { value: '<=', label: '≤' },
    { value: '<', label: '<' },
    { value: '=', label: '=' },
    { value: '>', label: '>' },
    { value: '>=', label: '≥' },
    { value: '!=', label: '≠' },
  ], []);


  const handle_status_condition_change = (status, value) => {
    if (current_rule) {
      dispatch(updateCondition({ id: current_rule.id, condition: status, value }));
    }
  };

  const handle_remove_rule = () => {
    set_show_confirm(true);
  };

  const handle_confirm = () => {
    if (current_rule?.id) {
      dispatch(removeRule(current_rule.id));
      set_show_confirm(false);
    } else {
      set_show_confirm(false);
    }
  };

  const handle_cancel = () => {
    set_show_confirm(false);
  };

  const handle_toggle_expand = () => {
    set_is_expanded(!is_expanded);
  };

  const handle_field_change = useCallback(
    (field) => (event) => {
      let value;
      if (event.target.type === 'checkbox') {
        value = event.target.checked;
      } else {
        value = event.target.value;
      }

      if (['priority', 'hpTriggerPercentage', 'manaTriggerPercentage'].includes(field)) {
        value = Number(value);
      }
      if (current_rule?.id) {
        dispatch(updateRule({ id: current_rule.id, field, value }));
      }
    },
    [dispatch, current_rule?.id],
  );

  const grouped_potion_options = useMemo(() => {
    const categories = {
      potion: [],
    };

    Object.entries(actionBarItemsData).forEach(([key, item]) => {
      if (ALLOWED_POTION_KEYS.has(key)) {
        const option = {
          value: key,
          label: item.name,
        };
        categories.potion.push(option);
      }
    });

    categories.potion.sort((a, b) => a.label.localeCompare(b.label));

    return categories.potion.length > 0 ? { potion: categories.potion } : {};
  }, []);

  if (!current_rule) {
    return null;
  }

  const first_available_potion = grouped_potion_options.potion && grouped_potion_options.potion.length > 0
    ? grouped_potion_options.potion[0].value
    : '';

  const ensure_valid_action_item = (current_item_value) => {
    if (current_item_value && ALLOWED_POTION_KEYS.has(current_item_value)) {
      return current_item_value;
    }
    return first_available_potion;
  };

  const rule_action_item = ensure_valid_action_item(current_rule.actionItem);

  const rule_key = current_rule.key || 'F12';
  const rule_priority = current_rule.priority ?? 0;
  const rule_hp_trigger_condition = current_rule.hpTriggerCondition || '>=';
  const rule_hp_trigger_percentage = current_rule.hpTriggerPercentage ?? 1;
  const rule_mana_trigger_condition = current_rule.manaTriggerCondition || '<=';
  const rule_mana_trigger_percentage = current_rule.manaTriggerPercentage ?? 80;

  return (
    <>
      {show_confirm && (
        <ConfirmDialog
          title="Remove Rule Confirmation"
          text="Are you sure you want to delete this rule?"
          onConfirm={handle_confirm}
          onCancel={handle_cancel}
        />
      )}
      <ManaSyncRuleWrapper className={className} $running={current_rule.enabled}>
        <div className='row1'>
          <CustomSwitch
            className="rule-input-enable-checkbox__custom-checkbox"
            checked={current_rule.enabled}
            onChange={handle_field_change('enabled')}
          />
          <CustomIconSelect
            id={`mana-sync-item-select-${rule.id}`}
            value={rule_action_item}
            options={grouped_potion_options}
            allItemsData={actionBarItemsData}
            onChange={(selectedOptionValue) => {
              if (selectedOptionValue !== undefined && selectedOptionValue !== null && ALLOWED_POTION_KEYS.has(selectedOptionValue)) {
                dispatch(updateRule({ id: current_rule.id, field: 'actionItem', value: selectedOptionValue }))
              }
            }}
          />
          <CustomSelect
            className="hotkey-input h38"
            id="key"
            value={rule_key}
            options={keyboardKeys}
            onChange={handle_field_change('key')}
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

            <CharacterStatusConditions
              ruleId={rule.id}
              onStatusConditionChange={handle_status_condition_change}
              className='conditions'
            />
          </div>
        )}
      </ManaSyncRuleWrapper >
    </>
  );
};

export default ManaSyncRule;