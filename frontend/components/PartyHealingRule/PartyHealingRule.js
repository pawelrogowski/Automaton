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

import { PartyHealingRuleWrapper } from './PartyHealingRule.styled.js';

const PartyHealingRule = ({ rule, className }) => {
  const [show_confirm, set_show_confirm] = useState(false);
  const [is_expanded, set_is_expanded] = useState(false);

  const dispatch = useDispatch();
  const active_preset_index = useSelector((state) => state.rules.activePresetIndex);
  const current_rule = useSelector((state) => state.rules.presets[active_preset_index]?.find((r) => r.id === rule.id));

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

      if (['partyPosition', 'friendHpTriggerPercentage', 'priority'].includes(field)) {
        value = Number(value);
      }
      if (current_rule?.id) {
        dispatch(updateRule({ id: current_rule.id, field, value }));
      }
    },
    [dispatch, current_rule?.id],
  );

  const condition_options = [
    { value: '<=', label: '≤' },
    { value: '<', label: '<' },
    { value: '=', label: '=' },
    { value: '>', label: '>' },
    { value: '>=', label: '≥' },
    { value: '!=', label: '≠' },
  ];

  const party_position_options = useMemo(() => {
    const options = [{ value: 0, label: 'All' }];
    for (let i = 1; i <= 20; i++) {
      options.push({ value: i, label: `${i}` });
    }
    return options;
  }, []);


  const grouped_icon_options = useMemo(() => {
    const allowed_item_keys = [
      'ultimateHealingRune',
      'intenseHealingRune',
      'healFriendSpell',
      'exuraSio',
      'exuraGranSio',
      'exuraGranMasRes'
    ];
    const party_heal_options = [];

    allowed_item_keys.forEach(key => {
      if (actionBarItemsData[key]) {
        party_heal_options.push({
          value: key,
          label: actionBarItemsData[key].name,
        });
      }
    });

    party_heal_options.sort((a, b) => a.label.localeCompare(b.label));

    return {
      'Party Heal Actions': party_heal_options,
    };
  }, []);

  if (!current_rule) {
    return null;
  }

  const rule_action_item = current_rule.actionItem || 'ultimateHealingRune';
  const rule_key = current_rule.key || 'F1';
  const rule_party_position = current_rule.partyPosition ?? 0;
  const rule_friend_hp_trigger_condition = current_rule.friendHpTriggerCondition || '<=';
  const rule_friend_hp_trigger_percentage = current_rule.friendHpTriggerPercentage ?? 50;
  const rule_priority = current_rule.priority ?? 0;
  const rule_require_attack_cooldown = !!current_rule.requireAttackCooldown;


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
      <PartyHealingRuleWrapper className={className} $running={current_rule.enabled}>
        <div className='row1'>
          <CustomSwitch
            className="rule-input-enable-checkbox__custom-checkbox"
            checked={current_rule.enabled}
            onChange={handle_field_change('enabled')}
          />
          <CustomIconSelect
            id={`party-action-item-select-${rule.id}`}
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

          <CustomSelect
            className="party-position-select h38"
            id="partyPosition"
            value={rule_party_position}
            options={party_position_options}
            onChange={handle_field_change('partyPosition')}
            title="Party Member Index (All = All Members)"
          />

          <CustomSwitch
            label="Wait ATK"
            checked={rule_require_attack_cooldown}
            onChange={handle_field_change('requireAttackCooldown')}
            title="Wait for Attack Cooldown before executing"
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
              <label className='label-text'>Friend HP Trigger</label>
              <div className='input-row'>
                <CustomSelect
                  id="friendHpTriggerCondition"
                  value={rule_friend_hp_trigger_condition}
                  options={condition_options}
                  onChange={handle_field_change('friendHpTriggerCondition')}
                  className="h38"
                />
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  id="friendHpTriggerPercentage"
                  value={rule_friend_hp_trigger_percentage}
                  onChange={handle_field_change('friendHpTriggerPercentage')}
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


      </PartyHealingRuleWrapper >
    </>
  );
};

export default PartyHealingRule;