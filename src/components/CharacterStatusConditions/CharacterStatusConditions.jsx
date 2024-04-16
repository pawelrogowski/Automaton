import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { removeCondition, updateCondition } from '../../redux/slices/healingSlice.js';
import {
  StyledList,
  StyledListItem,
  StyledImageContainer,
  StyledCheckboxImage,
} from './CharacterStatusConditions.styled.js';
import characterStatusImages from '../../constants/characterStatusImages.js';

const CharacterStatusConditions = ({ ruleId, onStatusConditionChange }) => {
  const dispatch = useDispatch();
  const statusConditions = useSelector(
    (state) => state.healing.find((r) => r.id === ruleId)?.conditions || [],
  );

  const handleClick = (status) => {
    const conditionIndex = statusConditions.findIndex((c) => c.name === status);
    let newValue;

    if (conditionIndex !== -1) {
      const currentValue = statusConditions[conditionIndex].value;
      if (currentValue === true) {
        newValue = false;
      } else if (currentValue === false) {
        dispatch(removeCondition({ id: ruleId, condition: status }));
        return;
      }
    } else {
      newValue = true;
    }

    dispatch(updateCondition({ id: ruleId, condition: status, value: newValue }));

    onStatusConditionChange(status, newValue);
  };

  return (
    <StyledList>
      {Object.keys(characterStatusImages).map((status) => {
        const condition = statusConditions.find((c) => c.name === status);
        const checked = condition ? condition.value : null;
        return (
          <StyledListItem key={status} checked={checked} onClick={() => handleClick(status)}>
            <StyledImageContainer>
              <StyledCheckboxImage src={characterStatusImages[status]} alt={status} />
            </StyledImageContainer>
          </StyledListItem>
        );
      })}
    </StyledList>
  );
};

export default CharacterStatusConditions;
