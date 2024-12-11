import React from 'react';
import PropTypes from 'prop-types';
import { StyledDiv } from './RuleListWrapper.styled.js';
import { sortRulesBy } from '../../redux/slices/healingSlice.js';
import { useDispatch } from 'react-redux';

const RuleListWrapper = ({ children, variant, tooltip }) => {
  const dispatch = useDispatch();

  const showNameAndCDGroup = variant !== 'friends';
  const showFriendOptions = variant === 'friends';

  return (
    <StyledDiv tooltip={tooltip}>
      <div className="header">
        <div
          className="header-item header-item_1"
          onMouseDown={() => dispatch(sortRulesBy(['enabled', 'priority']))}
        >
          •
        </div>
        {showNameAndCDGroup && (
          <>
            <div
              className="header-item header-item_2"
              onMouseDown={() => dispatch(sortRulesBy(['name', 'priority']))}
            >
              Name
            </div>
            <div
              className="header-item header-item_3"
              onMouseDown={() => dispatch(sortRulesBy(['category', 'priority']))}
            >
              CD Group
            </div>
          </>
        )}
        <div
          className="header-item header-item_4"
          onMouseDown={() => dispatch(sortRulesBy(['key', 'priority']))}
        >
          HK
        </div>{' '}
        {showFriendOptions && (
          <>
            <div
              className="header-item header-item_9"
              onMouseDown={() => dispatch(sortRulesBy(['requireManaShield', 'priority']))}
            >
              Utamo
            </div>
            <div
              className="header-item header-item_10"
              onMouseDown={() => dispatch(sortRulesBy(['useRune', 'priority']))}
            >
              UH
            </div>
            <div
              className="header-item header-item_11"
              onMouseDown={() => dispatch(sortRulesBy(['requireAttackCooldown', 'priority']))}
            >
              Wait ATK
            </div>
          </>
        )}
        <div
          className="header-item header-item_5"
          onMouseDown={() => dispatch(sortRulesBy(['hpTriggerPercentage', 'priority']))}
        >
          Health %
        </div>
        <div
          className="header-item header-item_6"
          onMouseDown={() => dispatch(sortRulesBy(['manaTriggerPercentage', 'priority']))}
        >
          Mana %
        </div>
        <div
          className="header-item header-item_6"
          onMouseDown={() => dispatch(sortRulesBy(['monsterNum', 'priority']))}
        >
          Monster#
        </div>
        <div
          className="header-item header-item_7"
          onMouseDown={() => dispatch(sortRulesBy(['priority', 'hpTriggerPercentage']))}
        >
          Priority
        </div>
        <div
          className="header-item header-item_8"
          onMouseDown={() => dispatch(sortRulesBy(['delay', 'priority']))}
        >
          CustomCD
        </div>
        <div className="header-item header-placeholder">-</div>
      </div>
      <div className="rules">{children}</div>
    </StyledDiv>
  );
};

RuleListWrapper.propTypes = {
  children: PropTypes.node.isRequired,
  variant: PropTypes.string,
};

export default RuleListWrapper;
