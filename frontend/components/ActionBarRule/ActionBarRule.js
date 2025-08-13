import React, { useCallback, useState, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import keyboardKeys from '../../constants/keyboardKeys.js';
import actionBarItemsData from '../../../electron/shared/constants/actionBarItems.js';
import { removeRule, updateRule, updateCondition } from '../../redux/slices/ruleSlice.js';
import CharacterStatusConditions from '../CharacterStatusConditions/CharacterStatusConditions.jsx';
import {
  ActionBarItemRuleWrapper,
} from './ActionBarRule.styled.js';
import CustomSwitch from '../CustomSwitch/CustomSwitch.js';
import CustomSelect from '../CustomSelect/CustomSelect.js';
import ConfirmDialog from '../ConfirmDialog/ConfirmDialog.jsx';
import CustomIconSelect from '../CustomIconSelect/CustomIconSelect.js';


const ActionBarRule = ({ rule, className }) => {
  const [show_confirm, set_show_confirm] = useState(false);
  const [is_expanded, set_is_expanded] = useState(false);


  const dispatch = useDispatch();
  const active_preset_index = useSelector((state) => state.rules.activePresetIndex);
  const current_rule = useSelector((state) =>
    state.rules.presets[active_preset_index]?.find((r) => r.id === rule.id),
  );

  const condition_options = [
    { value: '<=', label: '≤' },
    { value: '<', label: '<' },
    { value: '=', label: '=' },
    { value: '>', label: '>' },
    { value: '>=', label: '≥' },
    { value: '!=', label: '≠' },
  ];

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
      const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
      if (current_rule?.id) {
        dispatch(updateRule({ id: current_rule.id, field, value }));
      }
    },
    [dispatch, current_rule?.id],
  );

  const rule_action_item = current_rule.actionItem;
  const rule_key = current_rule.key || 'F1';
  const rule_priority = current_rule.priority ?? 0;
  const rule_hp_trigger_condition = current_rule.hpTriggerCondition || '<=';
  const rule_hp_trigger_percentage = current_rule.hpTriggerPercentage ?? 80;
  const rule_mana_trigger_condition = current_rule.manaTriggerCondition || '>=';
  const rule_mana_trigger_percentage = current_rule.manaTriggerPercentage ?? 20;
  const rule_monster_num_condition = current_rule.monsterNumCondition || '>=';
  const rule_monster_num = current_rule.monsterNum ?? 0;

  const selected_item_data = actionBarItemsData[rule_action_item];
  const selected_item_name = selected_item_data?.name || rule_action_item;

  const grouped_icon_options = useMemo(() => {
    const categories = {
      attack: [],
      support: [],
      healing: [],
      potion: [],
      equipment: [],
      uncategorized: [],
    };

    Object.entries(actionBarItemsData).forEach(([key, item]) => {
      const option = { value: key, label: item.name };
      if (item.categories && Array.isArray(item.categories) && item.categories.length > 0) {
        item.categories.forEach(category => {
          if (categories[category]) {
            categories[category].push(option);
          } else {
            categories.uncategorized.push(option);
          }
        });
      } else {
        categories.uncategorized.push(option);
      }
    });

    Object.values(categories).forEach(item_list => {
      item_list.sort((a, b) => a.label.localeCompare(b.label));
    });

    const filtered_categories = {};
    Object.entries(categories).forEach(([cat, items]) => {
      if (items.length > 0) {
        filtered_categories[cat] = items;
      }
    });

    return filtered_categories;
  }, []);

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
      <ActionBarItemRuleWrapper className={className} $running={current_rule.enabled}>
        <div className='row1'>
          <CustomSwitch
            className="rule-input-enable-checkbox__custom-checkbox"
            checked={current_rule.enabled}
            onChange={handle_field_change('enabled')}
          />
          <CustomIconSelect
            id={`action-item-select-${rule.id}`}
            value={rule_action_item}
            options={grouped_icon_options}
            allItemsData={actionBarItemsData}
            onChange={(selectedOptionValue) => {
              dispatch(updateRule({ id: current_rule.id, field: 'actionItem', value: selectedOptionValue }))
            }}
          />
          <CustomSelect
            className="hotkey-input h38"
            id="key"
            value={rule_key}
            options={keyboardKeys}
            onChange={handle_field_change('key')}
          />
          <CustomSwitch checked={!!current_rule.isWalking} onChange={handle_field_change('isWalking')} label="Running" />

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
        <div className='row2'>

          {is_expanded && (
            <>

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
                    className="h38"
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
                    className="h38"
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
                    className="h38"
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
                  className="h38"
                />
              </div>
              <CharacterStatusConditions
                ruleId={rule.id}
                onStatusConditionChange={handle_status_condition_change}
                className='conditions'
              />
            </>
          )}
        </div>


      </ActionBarItemRuleWrapper >
    </>
  );
};

export default ActionBarRule;