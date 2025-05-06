import React, { useCallback, useState, useEffect, useMemo } from 'react';
import PropTypes from 'prop-types';
import { useSelector, useDispatch } from 'react-redux';
import keyboardKeys from '../../constants/keyboardKeys.js';
import actionBarItemsData from '../../../electron/constants/actionBarItems.js';
import CharacterStatusConditions from '../CharacterStatusConditions/CharacterStatusConditions.jsx';

import { removeRule, updateCondition, updateRule } from '../../redux/slices/healingSlice.js';
import StyledDiv from './PartyHealingRule.styled.js';
import CustomCheckbox from '../CustomCheckbox/CustomCheckbox.js';
import ListInput from '../ListInput/ListInput.js';
import ListSelect from '../ListSelect/ListSelect.js';
import ConfirmDialog from '../ConfirmDialog/ConfirmDialog.jsx';
import CustomIconSelect from '../CustomIconSelect/CustomIconSelect.js';

const PartyHealingRule = ({ rule, className }) => {
  const [showConfirm, setShowConfirm] = useState(false);

  const dispatch = useDispatch();
  const activePresetIndex = useSelector((state) => state.healing.activePresetIndex);
  const currentRule = useSelector((state) => state.healing.presets[activePresetIndex]?.find((r) => r.id === rule.id));

  const handleStatusConditionChange = (status, value) => {
    if (currentRule) {
      dispatch(updateCondition({ id: currentRule.id, condition: status, value }));
    }
  };

  const handleRemoveRule = () => {
    setShowConfirm(true);
  };

  const handleConfirm = () => {
    if (currentRule?.id) {
      dispatch(removeRule(currentRule.id));
      setShowConfirm(false);
    } else {
      console.warn("Cannot remove rule: currentRule or currentRule.id is missing.");
      setShowConfirm(false);
    }
  };

  const handleCancel = () => {
    setShowConfirm(false);
  };

  const handleFieldChange = useCallback(
    (field) => (event) => {
      let value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
      // Ensure numeric fields are stored as numbers if applicable, especially for the new select
      if (['partyPosition', 'friendHpTriggerPercentage', 'priority', 'delay'].includes(field)) {
         value = Number(value);
      }
      if (currentRule?.id) {
        dispatch(updateRule({ id: currentRule.id, field, value }));
      } else {
        console.warn("Cannot update rule: currentRule or currentRule.id is missing.");
      }
    },
    [dispatch, currentRule?.id],
  );

  const groupedIconOptions = useMemo(() => {
    const allowedItemKeys = [
        'ultimateHealingRune',
        'intenseHealingRune',
        'healFriendSpell'
    ];
    const partyHealOptions = [];

    allowedItemKeys.forEach(key => {
        if (actionBarItemsData[key]) {
            partyHealOptions.push({
                value: key,
                label: actionBarItemsData[key].name,
            });
        } else {
            console.warn(`PartyHealingRule: Action item key "${key}" not found in actionBarItemsData.`);
        }
    });

    partyHealOptions.sort((a, b) => a.label.localeCompare(b.label));

    return {
      'Party Heal Actions': partyHealOptions,
    };
  }, []);

  if (!currentRule) {
    console.warn(`PartyHealingRule: Rule with ID ${rule.id} not found in preset ${activePresetIndex}.`);
    return null;
  }

  const ruleActionItem = useMemo(() => {
      const allowedKeys = ['ultimateHealingRune', 'intenseHealingRune', 'healFriendSpell'];
      if (currentRule.actionItem && allowedKeys.includes(currentRule.actionItem)) {
         return currentRule.actionItem;
      }
      return 'ultimateHealingRune';
   }, [currentRule.actionItem]);

  const ruleKey = currentRule.key || 'F1';
  const ruleRequireAttackCooldown = currentRule.requireAttackCooldown ?? false;
  const rulePartyPosition = currentRule.partyPosition ?? 0;
  const ruleFriendHpTriggerPercentage = currentRule.friendHpTriggerPercentage ?? 50;
  const rulePriority = currentRule.priority ?? 0;
  const ruleDelay = currentRule.delay ?? 150;

  const selectedItemData = actionBarItemsData[ruleActionItem];
  const selectedItemName = selectedItemData?.name || ruleActionItem;

  return (
    <>
      {showConfirm && (
        <ConfirmDialog
          title="Remove Rule Confirmation"
          text="Are you sure you want to delete this rule?"
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
      <StyledDiv className={className} $running={currentRule.enabled}>
        <details>
          <CharacterStatusConditions ruleId={rule.id} onStatusConditionChange={handleStatusConditionChange} />
          <summary
            onKeyDown={(e) => {
              if (e.target.classList.contains('search-input')) {
                if (e.code === 'Space') e.stopPropagation();
                return;
              }
              if (e.code === 'Space' || e.code === 'Enter') {
                const isSelectTrigger = !!e.target.closest(`#${`party-action-item-select-${rule.id}`}-trigger`);
                if (!isSelectTrigger && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
                  e.preventDefault();
                }
              }
            }}
          >
            <CustomCheckbox checked={currentRule.enabled} onChange={handleFieldChange('enabled')} width={38} height={38} />

            <div className="action-item-wrapper" title={selectedItemName}>
              <CustomIconSelect
                id={`party-action-item-select-${rule.id}`}
                value={ruleActionItem}
                options={groupedIconOptions}
                allItemsData={actionBarItemsData}
                onChange={(selectedOptionValue) => {
                  if (selectedOptionValue !== undefined && selectedOptionValue !== null) {
                    dispatch(updateRule({ id: currentRule.id, field: 'actionItem', value: selectedOptionValue }))
                  } else {
                    console.warn("CustomIconSelect onChange triggered with undefined/null value.");
                  }
                }}
              />
            </div>

            <ListSelect
              className="input input-hotkey"
              id="key"
              value={ruleKey}
              onChange={handleFieldChange('key')}
            >
              {keyboardKeys.map((key) => (
                <option key={key.value} value={key.value}>
                  {key.label}
                </option>
              ))}
            </ListSelect>

            <div className="checkbox-container checkbox-require-atk" title="Wait for Attack Cooldown before executing rule">
              <CustomCheckbox
                checked={ruleRequireAttackCooldown}
                onChange={handleFieldChange('requireAttackCooldown')}
                width={83}
                height={38}
                useWaitIcon={true}
              />
            </div>

            <ListSelect
              className="input input-party-position"
              id="partyPosition"
              value={rulePartyPosition}
              onChange={handleFieldChange('partyPosition')}
              title="Party Member Index (All = All Members)"
            >
              <option value={0}>All</option>
              {Array.from({ length: 20 }, (_, i) => i + 1).map((position) => (
                <option key={position} value={position}>
                  {position}
                </option>
              ))}
            </ListSelect>

            <ListSelect className="input input-percent-select" id="hpTriggerCondition" disabled={true} value="≤" title="Friend HP must be ≤ this value">
              <option value="<=">{'≤'}</option>
            </ListSelect>
            <ListInput
              className="input input-percent"
              type="number"
              min="1"
              max="100"
              step="1"
              id="friendHpTriggerPercentage"
              value={ruleFriendHpTriggerPercentage}
              onChange={handleFieldChange('friendHpTriggerPercentage')}
              placeholder="HP %"
              title="Friend HP %"
            />

            <ListInput
              type="number"
              className="input input-priority"
              id="priority"
              value={rulePriority}
              onChange={handleFieldChange('priority')}
              min="-999"
              max="999"
              placeholder="Priority"
              title="Rule Priority"
            />

            {/* <ListInput
              type="number"
              className="input input-delay"
              id="delay"
              value={ruleDelay}
              onChange={handleFieldChange('delay')}
              placeholder="CD (ms)"
              min="25"
              step="25"
              title="Custom Cooldown (ms)"
            /> */}

            <button type="button" className="rule-button button-expand" style={{ pointerEvents: 'none' }}>
              ▾
            </button>
            <button className="remove-rule-button rule-button" type="button" onMouseDown={handleRemoveRule} aria-label="remove-rule">
              ×
            </button>
          </summary>
        </details>
      </StyledDiv>
    </>
  );
};

PartyHealingRule.propTypes = {
  rule: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    enabled: PropTypes.bool,
    actionItem: PropTypes.string,
    key: PropTypes.string,
    conditions: PropTypes.arrayOf(PropTypes.object),
    requireAttackCooldown: PropTypes.bool,
    friendHpTriggerPercentage: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    partyPosition: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    priority: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    delay: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    isWalking: PropTypes.bool,
    hpTriggerPercentage: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    manaTriggerPercentage: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    monsterNum: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  }).isRequired,
  className: PropTypes.string,
};

export default PartyHealingRule;
