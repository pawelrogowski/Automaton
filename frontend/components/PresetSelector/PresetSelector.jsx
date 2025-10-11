import React, { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { setActivePresetIndex, copyPreset } from '../../redux/slices/ruleSlice';
import styled from 'styled-components';
import { PresetButton } from '../PresetButton/PresetButton';
import ConfirmDialog from '../ConfirmDialog/ConfirmDialog.jsx';

const PresetSelectorWrapper = styled.div`
  display: flex;
  justify-content: space-evenly;
  width: 100%;
  min-width: 100%;
  max-width: 100%;
`;

const PresetSelector = () => {
  const dispatch = useDispatch();
  const activePresetIndex = useSelector(
    (state) => state.rules.activePresetIndex,
  );
  const presets = useSelector((state) => state.rules.presets);

  // State for managing the confirmation dialog
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingCopyIndex, setPendingCopyIndex] = useState(null);

  // Function to handle mouse down event
  const handlePresetAction = (index, event) => {
    if (event.shiftKey) {
      // Show confirmation dialog before copying preset
      setPendingCopyIndex(index);
      setShowConfirm(true);
    } else {
      // Normal click: switch to preset immediately
      dispatch(setActivePresetIndex(index));
    }
  };

  // Confirm the copy action
  const handleConfirm = () => {
    if (pendingCopyIndex !== null) {
      dispatch(
        copyPreset({
          sourceIndex: pendingCopyIndex,
          targetIndex: activePresetIndex,
        }),
      );
    }
    setShowConfirm(false);
    setPendingCopyIndex(null);
  };

  // Cancel the copy action
  const handleCancel = () => {
    setShowConfirm(false);
    setPendingCopyIndex(null);
  };

  return (
    <>
      {showConfirm && (
        <ConfirmDialog
          title="Copy Preset Confirmation"
          text={`Are you sure you want to copy preset ${pendingCopyIndex + 1} to preset ${activePresetIndex + 1}?`}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
      <PresetSelectorWrapper>
        {presets.map((_, index) => (
          <PresetButton
            key={index}
            active={index === activePresetIndex}
            onMouseDown={(e) => handlePresetAction(index, e)}
          >
            {index + 1}
          </PresetButton>
        ))}
      </PresetSelectorWrapper>
    </>
  );
};

export default PresetSelector;
