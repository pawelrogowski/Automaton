import React from 'react';
import PropTypes from 'prop-types';
import { StyledDiv } from './RuleListWrapper.styled.js';
import { sortRulesBy } from '../../redux/slices/healingSlice.js';
import { useDispatch } from 'react-redux';
import runningMan from '../../assets/running-man.png';
const RuleListWrapper = ({ children, variant, tooltip }) => {
  const dispatch = useDispatch();

  const showNameAndCDGroup = variant !== 'friends';
  const showFriendOptions = variant === 'friends';

  return (
    <StyledDiv tooltip={tooltip}>
      <div className="header">
        <div className="header-item header-item_1" tooltip="enable rule" onMouseDown={() => dispatch(sortRulesBy(['enabled', 'priority']))}>
          •
        </div>
        {showNameAndCDGroup && (
          <>
            <div
              className="header-item header-item_2"
              tooltip="Edit rule name"
              onMouseDown={() => dispatch(sortRulesBy(['name', 'priority']))}
            >
              Name
            </div>
            <div
              className="header-item header-item_3"
              tooltip="Edit rule category"
              onMouseDown={() => dispatch(sortRulesBy(['category', 'priority']))}
            >
              CD Group
            </div>
          </>
        )}
        <div
          className="header-item header-item_4"
          tooltip="Edit rule hotkey"
          onMouseDown={() => dispatch(sortRulesBy(['key', 'priority']))}
        >
          HK
        </div>
        {showFriendOptions && (
          <>
            <div
              className="header-item header-item_10"
              tooltip="Use UH instead of Exura Sio, remember to use UH hotkey with croshair"
              onMouseDown={() => dispatch(sortRulesBy(['useRune', 'priority']))}
            >
              UH
            </div>
            <div
              className="header-item header-item_wait-atk"
              tooltip="Wait for AttackCooldown before triggering rule - this way you can use ava/sd and still uh every turn"
              onMouseDown={() => dispatch(sortRulesBy(['requireAttackCooldown', 'priority']))}
            >
              Wait ATK
            </div>
            <div
              className="header-item header-item_party-member"
              tooltip="Number of party member to target - setting 0 will make it react to all members(usefull for uh or mas res)"
              onMouseDown={() => dispatch(sortRulesBy(['partyPosition', 'priority']))}
            >
              Party Member
            </div>
            <div
              className="header-item header-item_member-hp"
              tooltip="Friend HP percentage below which the heal will occur"
              onMouseDown={() => dispatch(sortRulesBy(['friendHpTriggerPercentage', 'priority']))}
            >
              Party Member HP%
            </div>
            <div
              className="header-item header-item_7"
              tooltip="Rule priority - the priority is shared between ALL RULES AND CATEGORIES!!!"
              onMouseDown={() => dispatch(sortRulesBy(['priority', 'hpTriggerPercentage']))}
            >
              Priority
            </div>
            <div
              className="header-item header-item_8"
              tooltip="Rule Custom Cooldown - by default categories have set cooldowns, but you can overwrite it here if you want"
              onMouseDown={() => dispatch(sortRulesBy(['delay', 'priority']))}
            >
              CustomCD
            </div>
          </>
        )}
        {!showFriendOptions && (
          <>
            <div
              className="header-item header-item_5"
              tooltip="Your HP Percentage"
              onMouseDown={() => dispatch(sortRulesBy(['hpTriggerPercentage', 'priority']))}
            >
              Health %
            </div>
            <div
              className="header-item header-item_6"
              tooltip="Your MP Percentage"
              onMouseDown={() => dispatch(sortRulesBy(['manaTriggerPercentage', 'priority']))}
            >
              Mana %
            </div>
            <div
              className="header-item header-item_6"
              tooltip="Number of Monsters"
              onMouseDown={() => dispatch(sortRulesBy(['monsterNum', 'priority']))}
            >
              Monster#
            </div>
            <div
              className="header-item header-item_7"
              tooltip="Rule priority - the priority is shared between ALL RULES AND CATEGORIES!!!"
              onMouseDown={() => dispatch(sortRulesBy(['priority', 'hpTriggerPercentage']))}
            >
              Priority
            </div>
            <div
              className="header-item header-item_8"
              tooltip="Rule Custom Cooldown - by default categories have set cooldowns, but you can overwrite it here if you want"
              onMouseDown={() => dispatch(sortRulesBy(['delay', 'priority']))}
            >
              CustomCD
            </div>
            <div
              className="header-item header-item_running"
              tooltip="Trigger Rule only if character is moving(usefull for haste)"
              onMouseDown={() => dispatch(sortRulesBy(['isWalking', 'priority']))}
            >
              <img src={runningMan} alt="isWalking" tooltip="Require to be in movement during casting(last 1 second)" className=""></img>
            </div>
          </>
        )}

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
