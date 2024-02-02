import React, { useState } from 'react';
import {
  StyledList,
  StyledListItem,
  StyledImageContainer,
  StyledCheckboxImage,
} from './CharacterStatusConditions.styled.js';
import characterStatusImages from '../../constants/characterStatusImages.js';

const CharacterStatusConditions = ({ statusConditions, onStatusConditionChange }) => {
  const [localStatusConditions, setLocalStatusConditions] = useState(
    Object.keys(characterStatusImages).reduce((acc, status) => {
      acc[status] = null;
      return acc;
    }, {}),
  );

  const handleClick = (status) => {
    let newState;
    switch (statusConditions[status]) {
      case null:
        newState = true;
        break;
      case true:
        newState = false;
        break;
      case false:
        newState = null;
        break;
      default:
        newState = true; // This should never happen if the state is correctly managed
    }
    onStatusConditionChange(status, newState);
  };

  return (
    <StyledList>
      {Object.keys(characterStatusImages).map((status) => (
        <StyledListItem key={status}>
          <StyledImageContainer>
            <StyledCheckboxImage
              className={
                localStatusConditions[status] === true
                  ? 'checked'
                  : localStatusConditions[status] === false
                    ? 'unchecked'
                    : ''
              }
              src={characterStatusImages[status]}
              alt={status}
              onClick={() => handleClick(status)}
            />
          </StyledImageContainer>
        </StyledListItem>
      ))}
    </StyledList>
  );
};

export default CharacterStatusConditions;
