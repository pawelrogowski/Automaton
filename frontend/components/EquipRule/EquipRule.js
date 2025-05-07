import React, { useCallback, useState, useMemo, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import { useSelector, useDispatch } from 'react-redux';
import keyboardKeys from '../../constants/keyboardKeys.js';
import actionBarItemsData from '../../../electron/constants/actionBarItems.js';
import { removeRule, updateRule, updateCondition } from '../../redux/slices/healingSlice.js';
import CharacterStatusConditions from '../CharacterStatusConditions/CharacterStatusConditions.jsx';
import StyledDiv from './EquipRule.styled.js';
import CustomCheckbox from '../CustomCheckbox/CustomCheckbox.js';
import ListInput from '../ListInput/ListInput.js';
import ListSelect from '../ListSelect/ListSelect.js';
import ConfirmDialog from '../ConfirmDialog/ConfirmDialog.jsx';
import CustomIconSelect from '../CustomIconSelect/CustomIconSelect.js';

const EquipRule = ({ rule, className }) => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const detailsRef = useRef(null);
  const dispatch = useDispatch();

  const activePresetIndex = useSelector((state) => state.healing.activePresetIndex);
  const currentRule = useSelector((state) =>
    state.healing.presets[activePresetIndex]?.find((r) => r.id === rule.id),
  );

  const conditionOptions = useMemo(() => [
    { value: '<=', label: '≤' }, { value: '<', label: '<' },
    { value: '=', label: '=' }, { value: '>', label: '>' },
    { value: '>=', label: '≥' }, { value: '!=', label: '≠' },
  ], []);

  const handleStatusConditionChange = useCallback((status, value) => {
    if (currentRule) dispatch(updateCondition({ id: currentRule.id, condition: status, value }));
  }, [dispatch, currentRule]);

  const handleRemoveRule = useCallback(() => setShowConfirm(true), []);
  const handleConfirmRemove = useCallback(() => {
    if (currentRule?.id) dispatch(removeRule(currentRule.id));
    setShowConfirm(false);
  }, [dispatch, currentRule]);
  const handleCancelRemove = useCallback(() => setShowConfirm(false), []);

  const handleFieldChange = useCallback((field, value) => {
    if (currentRule?.id) {
      let finalValue = value;
      if (field === 'enabled' || field === 'equipOnlyIfSlotIsEmpty') {
        finalValue = (value === 'true' || value === true);
      }
      dispatch(updateRule({ id: currentRule.id, field, value: finalValue }));
    } else {
      console.error("EquipRule: Cannot update rule, currentRule.id is missing.");
    }
  }, [dispatch, currentRule?.id]);
  
  const handleSelectOrInputChange = useCallback((field) => (event) => {
      handleFieldChange(field, event.target.value);
  }, [handleFieldChange]);

  const handleStandardCheckboxChange = useCallback((field) => (event) => {
    handleFieldChange(field, event.target.checked);
  }, [handleFieldChange]);

  const handleActionItemChange = useCallback((selectedActionItemKey) => {
    if (currentRule?.id && selectedActionItemKey !== null) {
      dispatch(updateRule({ id: currentRule.id, field: 'actionItem', value: selectedActionItemKey }));
      const itemData = actionBarItemsData[selectedActionItemKey];
      const inferredSlot = itemData?.slot;
      if (inferredSlot) {
        dispatch(updateRule({ id: currentRule.id, field: 'targetSlot', value: inferredSlot }));
      } else {
        dispatch(updateRule({ id: currentRule.id, field: 'targetSlot', value: '' })); 
        if (selectedActionItemKey) { /* console.warn */ }
      }
    }
  }, [dispatch, currentRule?.id]);

  useEffect(() => {
    if (currentRule && currentRule.actionItem && 
        (!currentRule.targetSlot || actionBarItemsData[currentRule.actionItem]?.slot !== currentRule.targetSlot) ) {
        const itemData = actionBarItemsData[currentRule.actionItem];
        const inferredSlot = itemData?.slot;
        if (inferredSlot) dispatch(updateRule({ id: currentRule.id, field: 'targetSlot', value: inferredSlot }));
    }
  }, [currentRule?.actionItem, currentRule?.targetSlot, currentRule?.id, dispatch]);

  const handleToggleDetails = useCallback(() => {
      setIsDetailsOpen(prev => !prev);
  }, []);

  const equipmentActionItemOptions = useMemo(() => {
    const equipmentCategoryKey = 'equipment';
    const itemsGroup = { [equipmentCategoryKey]: [] };
    let foundItems = 0;
    Object.entries(actionBarItemsData).forEach(([key, item]) => {
      if (item && item.categories && item.categories.includes(equipmentCategoryKey) && item.slot) {
        itemsGroup[equipmentCategoryKey].push({ value: key, label: item.name, iconName: item.iconName });
        foundItems++;
      }
    });
    if (foundItems > 0) itemsGroup[equipmentCategoryKey].sort((a, b) => a.label.localeCompare(b.label));
    return itemsGroup;
  }, []);

  if (!currentRule) return null; 
  
  const {
    enabled, 
    name,
    actionItem = '', key = 'F1',
    targetSlot = actionBarItemsData[actionItem]?.slot || '', 
    equipOnlyIfSlotIsEmpty = true,
    hpTriggerCondition = '<=', hpTriggerPercentage = '0',
    manaTriggerCondition = '>=', 
    monsterNumCondition = '>=', monsterNum = '0',
    priority = '0', delay = '250',
  } = currentRule;
  
  const currentManaPercentage = currentRule.manaTriggerPercentage ?? '0';
  const selectedActionItemData = actionBarItemsData[actionItem];
  const displayRuleName = name || "Equip Rule"; 
  const selectedActionItemName = selectedActionItemData?.name || (actionItem || 'Select Equipment');
  const isDisabled_EquipCheckbox = (!targetSlot && !actionItem);

  return (
    <>
      {showConfirm && ( <ConfirmDialog title="Remove Rule" text={`Delete "${displayRuleName}"?`} onConfirm={handleConfirmRemove} onCancel={handleCancelRemove} /> )}
      <StyledDiv className={className} $running={enabled} $detailsOpen={isDetailsOpen}>
        <div className="rule-content">
          <div 
            className="enable-checkbox-wrapper" 
            onClick={(e) => e.stopPropagation()} 
            title={enabled ? "Disable Rule" : "Enable Rule"} 
            aria-label={enabled ? "Disable Rule" : "Enable Rule"} 
            role="button"
          >
              <CustomCheckbox 
                  checked={enabled} 
                  onChange={(e) => handleFieldChange('enabled', e.target.checked)}
                  width={38} 
                  height={38} 
              />
          </div>
          
          <div className="action-item-wrapper" title={`${selectedActionItemName} ${targetSlot ? '- Target Slot: ' + targetSlot : ''}`}>
            <CustomIconSelect
              id={`equip-actionitem-${rule.id}`}
              value={actionItem}
              options={equipmentActionItemOptions}
              allItemsData={actionBarItemsData}
              onChange={handleActionItemChange}
              placeholder="Select Equipment Item"
            />
          </div>

          <ListSelect className="input input-hotkey" id={`key-${rule.id}`} value={key} onChange={handleSelectOrInputChange('key')}>
            {keyboardKeys.map((k) => (<option key={k.value} value={k.value}>{k.label}</option>))}
          </ListSelect>
          
          <ListSelect className="input input-percent-select" id={`hpCond-${rule.id}`} value={hpTriggerCondition} onChange={handleSelectOrInputChange('hpTriggerCondition')}>
            {conditionOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </ListSelect>
          <ListInput className="input input-percent" type="number" min="0" max="100" step="1" id={`hpPerc-${rule.id}`} value={hpTriggerPercentage} onChange={handleSelectOrInputChange('hpTriggerPercentage')} />

          <ListSelect className="input input-percent-select" id={`manaCond-${rule.id}`} value={manaTriggerCondition} onChange={handleSelectOrInputChange('manaTriggerCondition')}>
            {conditionOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </ListSelect>
          <ListInput className="input input-percent" type="number" min="0" max="100" step="1" id={`manaPerc-${rule.id}`} value={currentManaPercentage} onChange={handleSelectOrInputChange('manaTriggerPercentage')} />
          
          <ListSelect 
            className="input input-monster-num-condition" 
            id={`monsterCond-${rule.id}`} 
            value={monsterNumCondition} 
            onChange={handleSelectOrInputChange('monsterNumCondition')}
            title="Monster #"
          >
            {conditionOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </ListSelect>
          <ListInput 
            type="number" 
            className="input input-monster-num" 
            id={`monsterNum-${rule.id}`} 
            value={monsterNum} 
            onChange={handleSelectOrInputChange('monsterNum')} 
            min="0" max="10" 
            title="Monster #"
          />

          <ListInput type="number" className="input input-priority" id={`priority-${rule.id}`} value={priority} onChange={handleSelectOrInputChange('priority')} min="-99" max="99" />
          
          <button 
            type="button" 
            className="rule-button button-expand" 
            onClick={handleToggleDetails} 
            title={isDetailsOpen ? "Collapse Details" : "Expand Details"}
            aria-expanded={isDetailsOpen}
          >
            {isDetailsOpen ? '▴' : '▾'}
          </button>
          <button
            className="remove-rule-button rule-button"
            type="button"
            onClick={(e) => { 
                e.stopPropagation();
                handleRemoveRule(); 
            }} 
            title="Remove Rule"
          >×</button>
        </div>

        {isDetailsOpen && (
          <div className="details-content-wrapper">
             <div className="details-row">
                <label htmlFor={`delay-${rule.id}`}>Delay (ms):</label>
                <ListInput type="number" className="input input-delay" id={`delay-${rule.id}`} value={delay} onChange={handleSelectOrInputChange('delay')} min="0" step="50" />
            </div>

            <div className="details-row">
                <label htmlFor={`equipOnlyIfEmpty-${rule.id}`}>ONLY if slot is empty:</label>
                 <div className="checkbox-equip-empty-wrapper">
                    <input
                        type="checkbox"
                        id={`equipOnlyIfEmpty-${rule.id}`}
                        checked={equipOnlyIfSlotIsEmpty}
                        onChange={handleStandardCheckboxChange('equipOnlyIfSlotIsEmpty')}
                        disabled={isDisabled_EquipCheckbox}
                        title={isDisabled_EquipCheckbox ? "Select an action item to enable this" : "Only try to equip if the target slot is currently empty"}
                        style={{ width: '22px', height: '22px', cursor: isDisabled_EquipCheckbox ? 'not-allowed' : 'pointer', margin: '0' }}
                    />
                 </div>
            </div>
            <CharacterStatusConditions ruleId={rule.id} onStatusConditionChange={handleStatusConditionChange} />
          </div>
        )}
      </StyledDiv>
    </>
  );
};

EquipRule.propTypes = {
  rule: PropTypes.shape({
    id: PropTypes.string.isRequired,
    enabled: PropTypes.bool,
    name: PropTypes.string, // Still exists in state, just not edited here
    actionItem: PropTypes.string,
    key: PropTypes.string,
    targetSlot: PropTypes.string,
    equipOnlyIfSlotIsEmpty: PropTypes.bool,
    hpTriggerCondition: PropTypes.string,
    hpTriggerPercentage: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    manaTriggerCondition: PropTypes.string,
    manaTriggerPercentage: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    monsterNumCondition: PropTypes.string,
    monsterNum: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    priority: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    delay: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    conditions: PropTypes.array,
  }).isRequired,
  className: PropTypes.string,
};

EquipRule.defaultProps = { className: '' };

export default EquipRule;