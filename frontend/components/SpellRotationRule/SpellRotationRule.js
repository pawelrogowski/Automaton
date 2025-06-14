import React, { useState, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { updateRule, removeRule } from '../../redux/slices/ruleSlice.js';
import StyledSpellRotationRule from './SpellRotationRule.styled.js';
import CustomCheckbox from '../CustomCheckbox/CustomCheckbox.js';
import ListInput from '../ListInput/ListInput.js';
import ListSelect from '../ListSelect/ListSelect.js';
import ConfirmDialog from '../ConfirmDialog/ConfirmDialog.jsx';
import keyboardKeys from '../../constants/keyboardKeys.js';

const modifierKeys = [
    { value: '', label: 'None' },
    { value: 'Alt', label: 'Alt' },
    { value: 'Ctrl', label: 'Ctrl' },
    { value: 'Shift', label: 'Shift' },
    // Add more if needed, e.g., Cmd for Mac
];

// Helper to validate delay (e.g., positive integer)
const validateDelay = (value) => {
  const num = parseInt(value, 10);
  return isNaN(num) || num < 0 ? 0 : num;
};

const SpellRotationRule = ({ rule, className }) => {
  const dispatch = useDispatch();
  const [showConfirm, setShowConfirm] = useState(false);
  const activePresetIndex = useSelector((state) => state.rules.activePresetIndex);
  const currentRule = useSelector((state) =>
    state.rules.presets[activePresetIndex].find((r) => r.id === rule.id)
  ) || rule;

  // Make handlers no-op or conditionally disabled if needed, but overlay blocks interaction anyway
  const handleFieldChange = useCallback((field, value) => {
    // dispatch(updateRule({ id: currentRule.id, field, value })); // Interaction blocked by overlay
  }, [dispatch, currentRule.id]);

  const handleSequenceChange = useCallback((index, field, value) => {
    // const newSequence = [...currentRule.sequence];
    // ... validation ...
    // dispatch(updateRule({ id: currentRule.id, field: 'sequence', value: newSequence })); // Interaction blocked
  }, [dispatch, currentRule.id, currentRule.sequence]);

  const addSequenceStep = useCallback(() => {
    // const newSequence = [...currentRule.sequence, { key: 'F1', delay: 1000 }];
    // dispatch(updateRule({ id: currentRule.id, field: 'sequence', value: newSequence })); // Interaction blocked
  }, [dispatch, currentRule.id, currentRule.sequence]);

  const removeSequenceStep = useCallback((index) => {
    // if (currentRule.sequence.length <= 1) return;
    // const newSequence = currentRule.sequence.filter((_, i) => i !== index);
    // dispatch(updateRule({ id: currentRule.id, field: 'sequence', value: newSequence })); // Interaction blocked
  }, [dispatch, currentRule.id, currentRule.sequence]);

  const handleRemoveRuleClick = () => {
     setShowConfirm(true); // Allow removal even if "Coming Soon"
  };

  const handleConfirmRemove = () => {
    dispatch(removeRule(currentRule.id));
    setShowConfirm(false);
  };

  const handleCancelRemove = () => {
    setShowConfirm(false);
  };

  // Flag to control overlay/disabling - always true for now
  const isComingSoon = true; 

  return (
    <>
       {showConfirm && (
         <ConfirmDialog
           title="Remove Rotation Rule"
           text={`Are you sure you want to delete the rotation rule "${currentRule.name || 'Unnamed'}"?`}
           onConfirm={handleConfirmRemove}
           onCancel={handleCancelRemove}
         />
       )}
      <StyledSpellRotationRule className={className}>
        {/* Render the overlay */}
        {isComingSoon && (
            <div className="coming-soon-overlay">
                <span>Coming Soon</span>
            </div>
        )}

        {/* Existing UI - Controls should be visually disabled or non-interactive */}
        <div className="rule-controls-top">
           <div className="control-group" title="Enable/Disable this rotation rule">
             <CustomCheckbox
               checked={currentRule.enabled}
               // onChange={(e) => handleFieldChange('enabled', e.target.checked)} // Disabled by overlay
               disabled={isComingSoon} // Explicitly disable checkbox
               width={18}
               height={18}
               id={`enable-${currentRule.id}`}
             />
             <label htmlFor={`enable-${currentRule.id}`}>Enabled</label>
           </div>
           <ListInput
             type="text"
             value={currentRule.name}
             // onChange={(e) => handleFieldChange('name', e.target.value)} // Disabled by overlay
             placeholder="Rotation Name"
             className="rule-name-input"
             readOnly={isComingSoon} // Make inputs read-only
             disabled={isComingSoon} // Also disable if possible
           />
           <div className="hotkey-group" title="Global hotkey to toggle this rotation (optional modifier)">
                <ListSelect
                    value={currentRule.modifierKey}
                    onChange={(e) => handleFieldChange('modifierKey', e.target.value)}
                    className="modifier-key-select"
                    disabled={isComingSoon}
                >
                    {modifierKeys.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                </ListSelect>
                <span>+</span>
                <ListSelect
                    value={currentRule.activationKey}
                    onChange={(e) => handleFieldChange('activationKey', e.target.value)}
                    className="activation-key-select"
                    disabled={isComingSoon}
                >
                    {keyboardKeys.filter(k => !['Alt', 'Ctrl', 'Shift'].includes(k.label)).map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                </ListSelect>
           </div>
           <div className="control-group repeat-toggle-group" title="Repeat sequence after the last step?">
              <CustomCheckbox
                checked={currentRule.repeat}
                // onChange={(e) => handleFieldChange('repeat', e.target.checked)} // Disabled by overlay
                disabled={isComingSoon} // Explicitly disable checkbox
                width={18}
                height={18}
                id={`repeat-${currentRule.id}`}
              />
               <label htmlFor={`repeat-${currentRule.id}`}>Repeat</label>
           </div>
        </div>

        <div className="rule-col-sequence">
           {currentRule.sequence.map((step, index) => (
              <div key={index} className="sequence-step">
                  {/* Inputs/Selects/Buttons inside sequence should ideally also be disabled */}
                  <span className="step-number">{index + 1}.</span>
                 <ListSelect
                    value={step.key}
                    onChange={(e) => handleSequenceChange(index, 'key', e.target.value)}
                    className="key-select"
                    disabled={isComingSoon}
                 >
                     {keyboardKeys.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                 </ListSelect>
                  <span className="step-text">wait</span>
                 <ListInput
                    type="number"
                    value={step.delay}
                    onChange={(e) => handleSequenceChange(index, 'delay', e.target.value)}
                    min="0"
                    step="50"
                    className="delay-input"
                    readOnly={isComingSoon}
                    disabled={isComingSoon}
                 />
                  <span className="step-text">ms</span>
                  <div className="control-group left-click-group" title="Perform left mouse click after pressing the key?">
                       <CustomCheckbox
                          checked={step.leftClick}
                          onChange={(e) => handleSequenceChange(index, 'leftClick', e.target.checked)}
                          width={16}
                          height={16}
                          id={`leftClick-${currentRule.id}-${index}`}
                          disabled={isComingSoon}
                       />
                       <label htmlFor={`leftClick-${currentRule.id}-${index}`}>L.Click</label>
                   </div>
                 <button
                    className="remove-step-button rule-button"
                    type="button"
                    onClick={() => removeSequenceStep(index)}
                    disabled={currentRule.sequence.length <= 1 || isComingSoon}
                    aria-label="Remove this step"
                 >
                   ×
                 </button>
              </div>
           ))}
        </div>

         <div className="rule-actions-bottom">
            <button onClick={addSequenceStep} className="add-step-button rule-button" type="button" disabled={isComingSoon}>
              + Add Step
            </button>
           <button
             className="remove-rule-button-text rule-button"
             type="button"
             onClick={handleRemoveRuleClick}
             aria-label="Remove this spell rotation rule"
           >
             Remove Spell Rotation
           </button>
         </div>
      </StyledSpellRotationRule>
    </>
  );
};

export default SpellRotationRule; 