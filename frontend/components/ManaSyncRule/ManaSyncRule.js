import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import { useSelector, useDispatch } from 'react-redux';
import keyboardKeys from '../../constants/keyboardKeys.js';
import actionBarItemsData from '../../../electron/constants/actionBarItems.js'; // Use the full list
import { removeRule, updateRule, updateCondition } from '../../redux/slices/healingSlice.js';
import CharacterStatusConditions from '../CharacterStatusConditions/CharacterStatusConditions.jsx';
import StyledDiv from './ManaSyncRule.styled.js'; // Use new styled component
import CustomCheckbox from '../CustomCheckbox/CustomCheckbox.js';
import ListInput from '../ListInput/ListInput.js';
import ListSelect from '../ListSelect/ListSelect.js';
import ConfirmDialog from '../ConfirmDialog/ConfirmDialog.jsx';
import CustomIconSelect from '../CustomIconSelect/CustomIconSelect.js';

const ROW_HEIGHT_NUM = 38;
const CHECKBOX_SIZE = 38;

// Define the allowed potion keys for ManaSync rules
const ALLOWED_POTION_KEYS = new Set([
  'healthPotion',
  'strongHealthPotion',
  'greatHealthPotion',
  'ultimateHealthPotion',
  'supremeHealthPotion',
  'smallHealthPotion',
  'manaPotion',
  'strongManaPotion',
  'greatManaPotion',
  'ultimateManaPotion',
  'greatSpiritPotion',
  'ultimateSpiritPotion',
  // Add any other specific keys if needed, e.g., 'magicShieldPotion' if desired
]);

// Renamed component
const ManaSyncRule = ({ rule, className }) => {
  const [showConfirm, setShowConfirm] = useState(false);

  const dispatch = useDispatch();
  const activePresetIndex = useSelector((state) => state.healing.activePresetIndex);
  const currentRule = useSelector((state) =>
    state.healing.presets[activePresetIndex]?.find((r) => r.id === rule.id),
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

  // Removed handleActionItemChange as it's handled directly in CustomIconSelect onChange

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

  // --- Filter action items for ALLOWED potions only ---
  const groupedPotionOptions = useMemo(() => {
    const categories = {
      potion: [], // Keep the 'potion' category structure for CustomIconSelect grouping
    };

    Object.entries(actionBarItemsData).forEach(([key, item]) => {
      // Check if the item key is in our allowed set
      if (ALLOWED_POTION_KEYS.has(key)) {
        const option = {
          value: key,
          label: item.name,
          // Keep iconName if CustomIconSelect uses it directly from options
          iconName: item.iconName,
        };
        // Add to the potion category
        categories.potion.push(option);
      }
    });

    // Sort the potion items alphabetically by label
    categories.potion.sort((a, b) => a.label.localeCompare(b.label));

    // Return the categories object, even if empty, CustomIconSelect should handle it
    return categories;
  }, []); // Dependency on imported actionBarItemsData constant

  if (!currentRule) {
    console.warn(`ManaSyncRule: Rule with ID ${rule.id} not found in preset ${activePresetIndex}.`);
    return null;
  }

  // --- Set default actionItem if none exists or is invalid ---
  const firstAvailablePotion = groupedPotionOptions.potion.length > 0
    ? groupedPotionOptions.potion[0].value
    : ''; // Fallback if no allowed potions are defined in constants

  const ensureValidActionItem = (currentItemValue) => {
    if (currentItemValue && ALLOWED_POTION_KEYS.has(currentItemValue)) {
      return currentItemValue;
    }
    // If current item is invalid or missing, assign the first available default
    return firstAvailablePotion;
  };

  // Ensure the rule's actionItem is valid before using it
  const ruleActionItem = ensureValidActionItem(currentRule.actionItem);
  // --- End Default Action Item Logic ---

  // Apply defaults if values are missing from the rule object
  const ruleKey = currentRule.key || 'F12';
  const rulePriority = currentRule.priority ?? 0;
  const ruleHpTriggerCondition = currentRule.hpTriggerCondition || '>=';
  const ruleHpTriggerPercentage = currentRule.hpTriggerPercentage ?? 1;
  const ruleManaTriggerCondition = currentRule.manaTriggerCondition || '<=';
  const ruleManaTriggerPercentage = currentRule.manaTriggerPercentage ?? 80;

  // Get selected item details safely
  const selectedItemData = actionBarItemsData[ruleActionItem];
  const selectedItemName = selectedItemData?.name || ruleActionItem || 'Select Potion';

  // --- Add Ref for the details element ---
  const detailsRef = useRef(null);

  // --- Handler to toggle details ---
  const handleToggleDetails = (event) => {
    // Prevent the button's default action
    event.preventDefault();
    // Stop the click event from bubbling up to the summary, which would also toggle
    event.stopPropagation();

    // Toggle the 'open' attribute of the details element
    if (detailsRef.current) {
      detailsRef.current.open = !detailsRef.current.open;
    }
  };

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
        <details ref={detailsRef}>
          <summary>
            <div className="rule-content">
              <CustomCheckbox checked={currentRule.enabled} onChange={handleFieldChange('enabled')} width={38} height={38} />

              <div className="action-item-wrapper" title={selectedItemName}>
                 <CustomIconSelect id={`mana-sync-item-select-${rule.id}`} value={ruleActionItem} options={groupedPotionOptions} allItemsData={actionBarItemsData} onChange={(v) => { if (v !== null && ALLOWED_POTION_KEYS.has(v)) { dispatch(updateRule({ id: currentRule.id, field: 'actionItem', value: v }))} }} />
              </div>

              <ListSelect className="input input-hotkey" id="key" value={ruleKey} onChange={handleFieldChange('key')}>
                {keyboardKeys.map((k) => (<option key={k.value} value={k.value}>{k.label}</option>))}
              </ListSelect>

              <ListSelect className="input input-percent-select" id="hpTriggerCondition" value={ruleHpTriggerCondition} onChange={handleFieldChange('hpTriggerCondition')}>
                {conditionOptions.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </ListSelect>
              <ListInput className="input input-percent" type="number" min="0" max="100" step="1" id="hpTriggerPercentage" value={ruleHpTriggerPercentage} onChange={handleFieldChange('hpTriggerPercentage')} placeholder="0" />

              <ListSelect className="input input-percent-select" id="manaTriggerCondition" value={ruleManaTriggerCondition} onChange={handleFieldChange('manaTriggerCondition')}>
                {conditionOptions.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </ListSelect>
              <ListInput type="number" min="0" max="100" step="1" className="input input-percent" id="manaTriggerPercentage" value={ruleManaTriggerPercentage} onChange={handleFieldChange('manaTriggerPercentage')} placeholder="0" />

              <ListInput
                 type="number" className="input input-priority"
                 id={`priority-${rule.id}`} value={rulePriority}
                 onChange={handleFieldChange('priority')}
                 min="-999" max="999" placeholder="Priority"
              />

              {/* Expand Button - Add onClick handler */}
              <button
                  type="button"
                  className="rule-button button-expand"
                  onClick={handleToggleDetails}
              >
                  ▾
              </button>
              <button
                  className="remove-rule-button rule-button"
                  type="button"
                  onMouseDown={handleRemoveRule}
                  aria-label="remove-rule"
              >
                  ×
              </button>
            </div>
          </summary>

          {/* --- Details Content Area (Only Conditions - appears BELOW summary) --- */}
          <CharacterStatusConditions
            ruleId={rule.id}
            onStatusConditionChange={handleStatusConditionChange}
          />

        </details>
      </StyledDiv>
    </>
  );
};

// Update PropTypes for ManaSyncRule
ManaSyncRule.propTypes = {
  rule: PropTypes.shape({
    id: PropTypes.string.isRequired,
    enabled: PropTypes.bool,
    // actionItem is crucial for manaSync
    actionItem: PropTypes.string, // Should be one of the ALLOWED_POTION_KEYS
    key: PropTypes.string,
    priority: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    hpTriggerCondition: PropTypes.string,
    hpTriggerPercentage: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    manaTriggerCondition: PropTypes.string,
    manaTriggerPercentage: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    // Category is less relevant now, can be optional or removed from props if not used
    // category: PropTypes.string,
  }).isRequired,
  className: PropTypes.string,
};

ManaSyncRule.defaultProps = {
    className: '',
};

export default ManaSyncRule; 