import React, { useCallback, useState, useEffect, useMemo } from 'react';
import PropTypes from 'prop-types';
import { useSelector, useDispatch } from 'react-redux';
import keyboardKeys from '../../constants/keyboardKeys.js';
import actionBarItemsData from '../../../electron/constants/actionBarItems.js';
import fallback_frame_icon from '../../assets/actionBarItems/Tile_Highlight_Effect.gif';
import { removeRule, updateRule, updateCondition } from '../../redux/slices/ruleSlice.js';
import CharacterStatusConditions from '../CharacterStatusConditions/CharacterStatusConditions.jsx';
import StyledDiv from './ActionBarRule.styled.js';
import CustomCheckbox from '../CustomCheckbox/CustomCheckbox.js';
import ListInput from '../ListInput/ListInput.js';
import ListSelect from '../ListSelect/ListSelect.js';
import ConfirmDialog from '../ConfirmDialog/ConfirmDialog.jsx';
import CustomIconSelect from '../CustomIconSelect/CustomIconSelect.js';

const ROW_HEIGHT_NUM = 38;
const CHECKBOX_SIZE = 38;

const ActionBarRule = ({ rule, className }) => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [groupedActionItems, setGroupedActionItems] = useState({});
  const [isConditionsVisible, setIsConditionsVisible] = useState(false);

  const dispatch = useDispatch();
  const activePresetIndex = useSelector((state) => state.rules.activePresetIndex);
  const currentRule = useSelector((state) =>
    state.rules.presets[activePresetIndex]?.find((r) => r.id === rule.id),
  );

  const conditionOptions = [
    { value: '<=', label: '≤' },
    { value: '<', label: '<' },
    { value: '=', label: '=' },
    { value: '>', label: '>' },
    { value: '>=', label: '≥' },
    { value: '!=', label: '≠' },
  ];

  const handleStatusConditionChange = (status, value) => {
    if (currentRule) {
      dispatch(updateCondition({ id: currentRule.id, condition: status, value }));
    }
  };

  useEffect(() => {
    const groups = {};
    Object.entries(actionBarItemsData).forEach(([key, item]) => {
      const category = item.categories && item.categories.length > 0 ? item.categories[0] : 'Other';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push({
        value: key,
        label: item.name,
      });
    });
    for (const category in groups) {
      groups[category].sort((a, b) => a.label.localeCompare(b.label));
    }
    const sortedGroups = Object.keys(groups)
      .sort((a, b) => {
        if (a === 'Other') return 1;
        if (b === 'Other') return -1;
        return a.localeCompare(b);
      })
      .reduce((acc, key) => {
        acc[key] = groups[key];
        return acc;
      }, {});
    setGroupedActionItems(sortedGroups);
  }, []);

  const handleRemoveRule = () => {
    setShowConfirm(true);
  };

  const handleToggleConditions = () => {
    setIsConditionsVisible(prev => !prev);
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
      const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
      if (currentRule?.id) {
        dispatch(updateRule({ id: currentRule.id, field, value }));
      } else {
        console.warn("Cannot update rule: currentRule or currentRule.id is missing.");
      }
    },
    [dispatch, currentRule?.id],
  );

  if (!currentRule) {
    console.warn(`ActionBarRule: Rule with ID ${rule.id} not found in preset ${activePresetIndex}.`);
    return null;
  }

  const firstItemValue = Object.keys(groupedActionItems).length > 0 && groupedActionItems[Object.keys(groupedActionItems)[0]].length > 0
    ? groupedActionItems[Object.keys(groupedActionItems)[0]][0].value
    : '';
  const ruleActionItem = currentRule.actionItem || firstItemValue;
  const ruleKey = currentRule.key || 'F1';
  const rulePriority = currentRule.priority ?? 0;
  const ruleDelay = currentRule.delay ?? 3000;
  const ruleHpTriggerCondition = currentRule.hpTriggerCondition || '<=';
  const ruleHpTriggerPercentage = currentRule.hpTriggerPercentage ?? 80;
  const ruleManaTriggerCondition = currentRule.manaTriggerCondition || '>=';
  const ruleManaTriggerPercentage = currentRule.manaTriggerPercentage ?? 20;
  const ruleMonsterNumCondition = currentRule.monsterNumCondition || '>=';
  const ruleMonsterNum = currentRule.monsterNum ?? 0;

  const selectedItemData = actionBarItemsData[ruleActionItem];
  const selectedItemName = selectedItemData?.name || ruleActionItem;

  const groupedIconOptions = useMemo(() => {
    const categories = {
      attack: [],
      support: [],
      healing: [],
      potion: [],
      equipment: [],
    };

    Object.entries(actionBarItemsData).forEach(([key, item]) => {
      if (item.categories && Array.isArray(item.categories)) {
        const option = {
          value: key,
          label: item.name,
        };
        item.categories.forEach(category => {
          if (categories[category]) {
            categories[category].push(option);
          } else {
            if (!categories.uncategorized) categories.uncategorized = [];
            categories.uncategorized.push(option);
          }
        });
      }
    });

    Object.values(categories).forEach(itemList => {
        itemList.sort((a, b) => a.label.localeCompare(b.label));
    });

    const filteredCategories = {};
    Object.entries(categories).forEach(([cat, items]) => {
        if(items.length > 0) {
            filteredCategories[cat] = items;
        }
    });

    return filteredCategories;
  }, []);

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
        <div className="rule-content">
           <CustomCheckbox
              checked={currentRule.enabled}
              onChange={handleFieldChange('enabled')}
              width={CHECKBOX_SIZE}
              height={CHECKBOX_SIZE}
           />

           <div className="action-item-wrapper" title={selectedItemName}>
              <CustomIconSelect
                 id={`action-item-select-${rule.id}`}
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

           <ListSelect className="input input-hotkey" id="key" value={ruleKey} onChange={handleFieldChange('key')}>
             {keyboardKeys.map((key) => (<option key={key.value} value={key.value}>{key.label}</option>))}
           </ListSelect>

           <ListSelect className="input input-percent-select" id="hpTriggerCondition" value={ruleHpTriggerCondition} onChange={handleFieldChange('hpTriggerCondition')}>
              {conditionOptions.map((option) => (<option key={option.value} value={option.value}>{option.label}</option>))}
           </ListSelect>
           <ListInput className="input input-percent" type="number" min="0" max="100" step="1" id="hpTriggerPercentage" value={ruleHpTriggerPercentage} onChange={handleFieldChange('hpTriggerPercentage')} placeholder="0"/>

           <ListSelect className="input input-percent-select" id="manaTriggerCondition" value={ruleManaTriggerCondition} onChange={handleFieldChange('manaTriggerCondition')}>
             {conditionOptions.map((option) => (<option key={option.value} value={option.value}>{option.label}</option>))}
           </ListSelect>
           <ListInput type="number" min="0" max="100" step="1" className="input input-percent" id="manaTriggerPercentage" value={ruleManaTriggerPercentage} onChange={handleFieldChange('manaTriggerPercentage')} placeholder="0"/>

           <ListSelect className="input input-monster-num-condition" id="monsterNumCondition" value={ruleMonsterNumCondition} onChange={handleFieldChange('monsterNumCondition')}>
             {conditionOptions.map((option) => (<option key={option.value} value={option.value}>{option.label}</option>))}
           </ListSelect>
           <ListInput type="number" min="0" max="10" className="input input-monster-num" id="monsterNum" value={ruleMonsterNum} onChange={handleFieldChange('monsterNum')} placeholder="0"/>

           <ListInput type="number" min="-999" max="999" className="input input-priority" id="priority" value={rulePriority} onChange={handleFieldChange('priority')} placeholder="Priority"/>

           <div className="checkbox-container">
              <CustomCheckbox checked={!!currentRule.isWalking} onChange={handleFieldChange('isWalking')} width={38} height={38} useRunningIcon={true}/>
           </div>

           <button
              type="button"
              className="rule-button button-toggle-conditions"
              onClick={handleToggleConditions}
              title="Toggle Status Conditions"
              aria-expanded={isConditionsVisible}
           >
                ▾
           </button>

           <button
              className="remove-rule-button rule-button"
              type="button"
              onClick={handleRemoveRule}
              aria-label="remove-rule"
            >
             ×
           </button>
        </div>

        {isConditionsVisible && (
           <div className="conditions-container">
             <CharacterStatusConditions
               ruleId={rule.id}
               onStatusConditionChange={handleStatusConditionChange}
             />
           </div>
        )}
      </StyledDiv>
    </>
  );
};

ActionBarRule.propTypes = {
  rule: PropTypes.shape({
    id: PropTypes.string.isRequired,
    enabled: PropTypes.bool,
    actionItem: PropTypes.string,
    key: PropTypes.string,
    priority: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    delay: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    hpTriggerCondition: PropTypes.string,
    hpTriggerPercentage: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    manaTriggerCondition: PropTypes.string,
    manaTriggerPercentage: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    monsterNumCondition: PropTypes.string,
    monsterNum: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    conditions: PropTypes.arrayOf(PropTypes.object),
    isWalking: PropTypes.bool,
  }).isRequired,
  className: PropTypes.string,
};

export default ActionBarRule;