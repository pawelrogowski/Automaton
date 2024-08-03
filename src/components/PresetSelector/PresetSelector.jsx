import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { setActivePresetIndex } from '../../redux/slices/healingSlice';
import styled from 'styled-components';
import { PresetButton } from '../PresetButton/PresetButton';

const PresetSelectorWrapper = styled.div`
  display: flex;
  justify-content: center;
`;

const PresetSelector = () => {
  const dispatch = useDispatch();
  const activePresetIndex = useSelector((state) => state.healing.activePresetIndex);
  const presets = useSelector((state) => state.healing.presets);

  const handlePresetChange = (index) => {
    dispatch(setActivePresetIndex(index));
  };

  return (
    <PresetSelectorWrapper>
      {presets.map((_, index) => (
        <PresetButton
          key={index}
          active={index === activePresetIndex}
          onMouseDown={() => handlePresetChange(index)}
        >
          {index + 1}
        </PresetButton>
      ))}
    </PresetSelectorWrapper>
  );
};

export default PresetSelector;
