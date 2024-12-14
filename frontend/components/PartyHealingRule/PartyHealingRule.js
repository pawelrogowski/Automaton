import React, { useCallback } from 'react';
import PropTypes from 'prop-types';
import { useSelector, useDispatch } from 'react-redux';
import keyboardKeys from '../../constants/keyboardKeys.js';
import CharacterStatusConditions from '../CharacterStatusConditions/CharacterStatusConditions.jsx';

import {
  removeRule,
  updateCondition,
  updateRuleName,
  updateRuleEnabled,
  updateRuleCategory,
  updateRuleKey,
  updateRuleManaTrigger,
  updateRuleMonsterNum,
  updateRulePriority,
  updateRuleDelay,
  toggleManaShieldRequired,
  toggleUseRune,
  toggleAttackCooldownRequired,
  updateRuleFriendHpTrigger,
} from '../../redux/slices/healingSlice.js';
import StyledDiv from './PartyHealingRule.styled.js';
import CustomCheckbox from '../CustomCheckbox/CustomCheckbox.js';
import ListInput from '../ListInput/ListInput.js';
import ListSelect from '../ListSelect/ListSelect.js';

const PartyHealingRule = ({ rule, className }) => {
  const dispatch = useDispatch();
  const activePresetIndex = useSelector((state) => state.healing.activePresetIndex);
  const healing =
    useSelector((state) =>
      state.healing.presets[activePresetIndex].find((r) => r.id === rule.id),
    ) || {};

  const handleRemoveRule = useCallback(() => {
    const confirmDelete = window.confirm('Are you sure you want to delete this rule?');

    if (confirmDelete) {
      dispatch(removeRule(healing.id));
    }
  }, [dispatch, healing.id]);

  const handleUpdateEnabled = useCallback(() => {
    dispatch(updateRuleEnabled({ id: healing.id, enabled: !healing.enabled }));
  }, [dispatch, healing.id, healing.enabled]);

  const handleUpdateKey = useCallback(
    (event) => {
      dispatch(updateRuleKey({ id: healing.id, key: event.target.value }));
    },
    [dispatch, healing.id],
  );

  const handleUpdatePriority = useCallback(
    (event) => {
      dispatch(updateRulePriority({ id: healing.id, priority: event.target.value }));
    },
    [dispatch, healing.id],
  );

  const handleUpdateDelay = useCallback(
    (event) => {
      dispatch(updateRuleDelay({ id: healing.id, delay: event.target.value }));
    },
    [dispatch, healing.id],
  );

  const handleToggleManaShieldRequired = useCallback(() => {
    dispatch(toggleManaShieldRequired());
  }, [dispatch]);

  const handleToggleUseRune = useCallback(() => {
    dispatch(toggleUseRune());
  }, [dispatch]);

  const handleToggleAttackCooldownRequired = useCallback(() => {
    dispatch(toggleAttackCooldownRequired());
  }, [dispatch]);

  const handleUpdateFriendHpTrigger = useCallback(
    (event) => {
      const payload = {
        id: healing.id,
        friendHpTriggerPercentage: event.target.value,
      };
      dispatch(updateRuleFriendHpTrigger(payload));
    },
    [dispatch, healing.id],
  );

  const handleUpdateManaTrigger = useCallback(
    (field) => (event) => {
      const payload = { id: healing.id };
      if (field === 'condition') {
        payload.condition = event.target.value;
        payload.percentage = healing.manaTriggerPercentage;
      } else {
        payload.condition = healing.manaTriggerCondition;
        payload.percentage = event.target.value;
      }
      dispatch(updateRuleManaTrigger(payload));
    },
    [dispatch, healing.id, healing.manaTriggerCondition, healing.manaTriggerPercentage],
  );

  const handleUpdateMonsterNum = useCallback(
    (field) => (event) => {
      const payload = { id: healing.id };
      if (field === 'condition') {
        payload.condition = event.target.value;
        payload.num = healing.monsterNum;
      } else {
        payload.condition = healing.monsterNumCondition;
        payload.num = event.target.value;
      }
      dispatch(updateRuleMonsterNum(payload));
    },
    [dispatch, healing.id, healing.monsterNumCondition, healing.monsterNum],
  );

  return (
    <StyledDiv className={className} $running={healing.enabled}>
      <details>
        <summary>
          <CustomCheckbox
            checked={healing.enabled}
            onChange={handleUpdateEnabled}
            width={22}
            height={22}
          />

          <ListSelect
            className="input input-hotkey"
            id="key"
            value={healing.key}
            onChange={handleUpdateKey}
            placeholder="F1"
          >
            {keyboardKeys.map((key) => (
              <option key={key.value} value={key.value}>
                {key.label}
              </option>
            ))}
          </ListSelect>

          <div className="checkbox-group">
            <div>
              <CustomCheckbox
                checked={healing.requireManaShield}
                onChange={handleToggleManaShieldRequired}
                width={55}
                height={22}
                label="Require Mana Shield"
              />
            </div>
            <div>
              <CustomCheckbox
                checked={healing.useRune}
                onChange={handleToggleUseRune}
                width={35}
                height={22}
                label="Use Rune"
              />
            </div>
            <div>
              <CustomCheckbox
                checked={healing.requireAttackCooldown}
                onChange={handleToggleAttackCooldownRequired}
                width={85}
                height={22}
                label="Require Attack Cooldown"
              />
            </div>
          </div>

          <ListSelect
            className="input input-percent-select"
            id="hpTriggerCondition"
            disabled="true"
            value="≤"
          >
            <option value="<=">{'≤'}</option>
          </ListSelect>
          <ListInput
            className="input-percent"
            type="number"
            min="0"
            max="100"
            step="1"
            id="friendHpTriggerPercentage"
            value={healing.friendHpTriggerPercentage}
            onChange={handleUpdateFriendHpTrigger}
            placeholder="80"
          />

          <ListSelect
            className="input input-percent-select"
            id="manaTriggerCondition"
            value={healing.manaTriggerCondition}
            onChange={handleUpdateManaTrigger('condition')}
          >
            <option value="<=">{'≤'}</option>
            <option value="<">{'<'}</option>
            <option value="=">{'='}</option>
            <option value=">">{'>'}</option>
            <option value=">=">{'≥'}</option>
            <option value="!=">{'≠'}</option>
          </ListSelect>
          <ListInput
            type="number"
            min="0"
            max="100"
            step="1"
            className="input input-percent"
            id="manaTriggerPercentage"
            value={healing.manaTriggerPercentage}
            onChange={handleUpdateManaTrigger('percentage')}
            placeholder="0"
          />
          <ListSelect
            className="input input-monster-num-condition"
            id="monsterNumCondition"
            value={healing.monsterNumCondition}
            onChange={handleUpdateMonsterNum('condition')}
          >
            <option value="<">{'<'}</option>
            <option value="<=">{'≤'}</option>
            <option value="=">{'='}</option>
            <option value=">">{'>'}</option>
            <option value=">=">{'≥'}</option>
          </ListSelect>
          <ListInput
            type="number"
            className="input input-monster-num"
            id="monsterNum"
            value={healing.monsterNum}
            onChange={handleUpdateMonsterNum('num')}
            min="0"
            max="10"
            placeholder="0"
          />
          <ListInput
            type="number"
            className="input input-priority"
            id="priority"
            value={healing.priority}
            onChange={handleUpdatePriority}
            min="-999"
            max="999"
            placeholder="Priority"
          />
          <ListInput
            type="number"
            className="input-delay"
            id="delay"
            value={healing.delay}
            onChange={handleUpdateDelay}
            placeholder="5"
            min="0"
            step="25"
          />

          <button
            className="remove-rule-button rule-button"
            type="button"
            onMouseDown={handleRemoveRule}
            aria-label="remove-rule"
          >
            ×
          </button>
        </summary>
      </details>
    </StyledDiv>
  );
};

PartyHealingRule.propTypes = {
  rule: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    enabled: PropTypes.bool,
    key: PropTypes.string,
    conditions: PropTypes.arrayOf(PropTypes.object),
    requireManaShield: PropTypes.bool,
    useRune: PropTypes.bool,
    requireAttackCooldown: PropTypes.bool,
    friendHpTriggerPercentage: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  }).isRequired,
  className: PropTypes.string,
  variant: PropTypes.string,
};

export default PartyHealingRule;
