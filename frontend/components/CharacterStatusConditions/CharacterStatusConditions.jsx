import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  removeCondition,
  updateCondition,
} from '../../redux/slices/ruleSlice.js';
import {
  StyledList,
  StyledListItem,
  StyledImageContainer,
  StyledCheckboxImage,
} from './CharacterStatusConditions.styled.js';

import bleeding from '../../assets/bleeding.gif';
import burning from '../../assets/burning.gif';
import cursed from '../../assets/cursed.gif';
import drowning from '../../assets/drowning.gif';
import drunk from '../../assets/drunk.gif';
import electrified from '../../assets/electrified.gif';
import eRing from '../../assets/eRing.gif';
import freezing from '../../assets/freezing.gif';
import hasted from '../../assets/hasted.gif';
import hungry from '../../assets/hungry.png';
import magicShield from '../../assets/magicShield.gif';
import paralyzed from '../../assets/paralyzed.gif';
import poisoned from '../../assets/poisoned.gif';
import strengthened from '../../assets/strengthened.gif';
import inProtectedZone from '../../assets/inProtectionZone.gif';
import inRestingArea from '../../assets/inRestingArea.png';
import rooted from '../../assets/rooted.gif';

const characterStatusImages = {
  inProtectedZone,
  hasted,
  paralyzed,
  magicShield,
  eRing,
  strengthened,
  hungry,
  inRestingArea,
  drunk,
  poisoned,
  bleeding,
  burning,
  electrified,
  cursed,
  freezing,
  drowning,
  rooted,
};

const CharacterStatusConditions = ({
  ruleId,
  onStatusConditionChange,
  className,
}) => {
  const dispatch = useDispatch();
  const statusConditions = useSelector(
    (state) => state.rules.rules.find((r) => r.id === ruleId)?.conditions || [],
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

    dispatch(
      updateCondition({ id: ruleId, condition: status, value: newValue }),
    );

    onStatusConditionChange(status, newValue);
  };

  return (
    <StyledList className={className}>
      {Object.keys(characterStatusImages).map((status) => {
        const condition = statusConditions.find((c) => c.name === status);
        const checked = condition ? condition.value : null;
        return (
          <StyledListItem
            key={status}
            checked={checked}
            onMouseDown={() => handleClick(status)}
          >
            <StyledImageContainer>
              <StyledCheckboxImage
                src={characterStatusImages[status]}
                alt={status}
              />
            </StyledImageContainer>
          </StyledListItem>
        );
      })}
    </StyledList>
  );
};

export default CharacterStatusConditions;
