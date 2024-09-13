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
  updateRuleHpTrigger,
  updateRuleManaTrigger,
  updateRuleMonsterNum,
  updateRulePriority,
  updateRuleDelay,
} from '../../redux/slices/healingSlice.js';
import StyledDiv from './HealingRule.styled.js';
import CustomCheckbox from '../CustomCheckbox/CustomCheckbox.js';
import ListInput from '../ListInput/ListInput.js';
import ListSelect from '../ListSelect/ListSelect.js';

const HealingRule = ({ rule, className }) => {
  const dispatch = useDispatch();
  const activePresetIndex = useSelector((state) => state.healing.activePresetIndex);
  const healing =
    useSelector((state) =>
      state.healing.presets[activePresetIndex].find((r) => r.id === rule.id),
    ) || {};

  const handleStatusConditionChange = useCallback(
    (status, value) => {
      dispatch(updateCondition({ id: healing.id, condition: status, value }));
    },
    [dispatch, healing.id],
  );

  const handleRemoveRule = useCallback(() => {
    dispatch(removeRule(healing.id));
  }, [dispatch, healing.id]);

  const handleUpdateName = useCallback(
    (event) => {
      dispatch(updateRuleName({ id: healing.id, name: event.target.value }));
    },
    [dispatch, healing.id],
  );

  const handleUpdateEnabled = useCallback(() => {
    dispatch(updateRuleEnabled({ id: healing.id, enabled: !healing.enabled }));
  }, [dispatch, healing.id, healing.enabled]);

  const handleUpdateCategory = useCallback(
    (event) => {
      dispatch(updateRuleCategory({ id: healing.id, category: event.target.value }));
    },
    [dispatch, healing.id],
  );

  const handleUpdateKey = useCallback(
    (event) => {
      dispatch(updateRuleKey({ id: healing.id, key: event.target.value }));
    },
    [dispatch, healing.id],
  );

  const handleUpdateHpTrigger = useCallback(
    (field) => (event) => {
      const payload = { id: healing.id };
      if (field === 'condition') {
        payload.condition = event.target.value;
        payload.percentage = healing.hpTriggerPercentage;
      } else {
        payload.condition = healing.hpTriggerCondition;
        payload.percentage = event.target.value;
      }
      dispatch(updateRuleHpTrigger(payload));
    },
    [dispatch, healing.id, healing.hpTriggerCondition, healing.hpTriggerPercentage],
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

  return (
    <StyledDiv className={className} $running={healing.enabled}>
      <details>
        <CharacterStatusConditions
          ruleId={rule.id}
          onStatusConditionChange={handleStatusConditionChange}
        />
        <summary>
          <CustomCheckbox checked={healing.enabled} onChange={handleUpdateEnabled} size={22} />
          <ListInput
            className="input"
            id="name"
            value={healing.name}
            onChange={handleUpdateName}
            placeholder="Rule Name"
          />
          <ListSelect
            className="input input-category select-with-arrow"
            id="category"
            value={healing.category}
            onChange={handleUpdateCategory}
          >
            <option value="Healing">Healing</option>
            <option value="Potion">Potion</option>
            <option value="Support">Support</option>
            <option value="Attack">Attack</option>
            <option value="Equip">Equip</option>
            <option value="Others">Others</option>
          </ListSelect>
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
          <ListSelect
            className="input input-percent-select"
            id="hpTriggerCondition"
            value={healing.hpTriggerCondition}
            onChange={handleUpdateHpTrigger('condition')}
          >
            <option value="<=">{'≤'}</option>
            <option value="<">{'<'}</option>
            <option value="=">{'='}</option>
            <option value=">">{'>'}</option>
            <option value=">=">{'≥'}</option>
            <option value="!=">{'≠'}</option>
          </ListSelect>
          <ListInput
            className="input-percent"
            type="number"
            min="0"
            max="100"
            step="1"
            id="hpTriggerPercentage"
            value={healing.hpTriggerPercentage}
            onChange={handleUpdateHpTrigger('percentage')}
            placeholder="0"
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
          <button
            type="button"
            className="rule-button button-expand"
            style={{ pointerEvents: 'none' }}
          >
            ▾
          </button>
        </summary>
      </details>
    </StyledDiv>
  );
};

HealingRule.propTypes = {
  rule: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    enabled: PropTypes.bool,
    key: PropTypes.string,
    conditions: PropTypes.arrayOf(PropTypes.object),
  }).isRequired,
  className: PropTypes.string,
};

export default HealingRule;
