import React from 'react';
import PropTypes from 'prop-types';
import { StyledDiv } from './RuleListWrapper.styled.js';
import { sortRulesBy } from '../../redux/slices/ruleSlice.js';
import { useDispatch } from 'react-redux';

const RuleListWrapper = ({ children, variant }) => {
  const dispatch = useDispatch();
  // Keep variant class on main wrapper for potential non-header styling
  const variantClassName = `variant-${variant || 'default'}`;

  // Function to render the correct header structure
  const renderHeaders = () => {
    switch (variant) {
      case 'actionbar':
        return (
          <>
            {/* Action Bar Headers - Separated Mana and Monster */}
            <div className="header-item header-actionbar-enable" tooltip="Enable rule" onMouseDown={() => dispatch(sortRulesBy(['enabled', 'priority']))}>•</div>
            <div className="header-item header-actionbar-item" tooltip="Select Action Bar Item" onMouseDown={() => dispatch(sortRulesBy(['actionItem', 'priority']))}>Action</div>
            <div className="header-item header-actionbar-hk" tooltip="Edit rule hotkey" onMouseDown={() => dispatch(sortRulesBy(['key', 'priority']))}>HK</div>
            <div className="header-item header-actionbar-hp" tooltip="Your HP Percentage" onMouseDown={() => dispatch(sortRulesBy(['hpTriggerPercentage', 'priority']))}>Health %</div>
            {/* Separated Headers */}
            <div className="header-item header-actionbar-mana" tooltip="Your MP Percentage" onMouseDown={() => dispatch(sortRulesBy(['manaTriggerPercentage', 'priority']))}>Mana %</div>
            <div className="header-item header-actionbar-monster" tooltip="Number of Monsters" onMouseDown={() => dispatch(sortRulesBy(['monsterNum', 'priority']))}>Monster#</div>
            {/* End Separated Headers */}
            <div className="header-item header-actionbar-priority" tooltip="Rule priority - shared across all rules!" onMouseDown={() => dispatch(sortRulesBy(['priority']))}>Priority</div>
          </>
        );
      case 'equip':
        return (
          <>
            {/* Equip Headers - Same as Action Bar */}
            <div className="header-item header-equip-enable" tooltip="Enable rule" onMouseDown={() => dispatch(sortRulesBy(['enabled', 'priority']))}>•</div>
            <div className="header-item header-equip-item" tooltip="Select Equipment Item" onMouseDown={() => dispatch(sortRulesBy(['actionItem', 'priority']))}>Action</div>
            <div className="header-item header-equip-hk" tooltip="Edit rule hotkey" onMouseDown={() => dispatch(sortRulesBy(['key', 'priority']))}>HK</div>
            <div className="header-item header-equip-hp" tooltip="Your HP Percentage" onMouseDown={() => dispatch(sortRulesBy(['hpTriggerPercentage', 'priority']))}>Health %</div>
            <div className="header-item header-equip-mana" tooltip="Your MP Percentage" onMouseDown={() => dispatch(sortRulesBy(['manaTriggerPercentage', 'priority']))}>Mana %</div>
            <div className="header-item header-equip-monster" tooltip="Number of Monsters" onMouseDown={() => dispatch(sortRulesBy(['monsterNum', 'priority']))}>Monster#</div>
            <div className="header-item header-equip-priority" tooltip="Rule priority - shared across all rules!" onMouseDown={() => dispatch(sortRulesBy(['priority']))}>Priority</div>
          </>
        );
      case 'friends':
        return (
          <>
            {/* Friends Headers - Updated */}
            <div className="header-item header-friend-enable" tooltip="Enable rule" onMouseDown={() => dispatch(sortRulesBy(['enabled', 'priority']))}>•</div>
            {/* Changed UH to Action */}
            <div className="header-item header-friend-action" tooltip="Select Spell/Rune" onMouseDown={() => dispatch(sortRulesBy(['actionItem', 'priority']))}>Action</div>
            <div className="header-item header-friend-hk" tooltip="Edit rule hotkey" onMouseDown={() => dispatch(sortRulesBy(['key', 'priority']))}>HK</div>
            {/* Kept Wait ATK */}
            <div className="header-item header-friend-wait-atk" tooltip="Wait for Attack Cooldown" onMouseDown={() => dispatch(sortRulesBy(['requireAttackCooldown', 'priority']))}>Wait ATK</div>
            <div className="header-item header-friend-party-member" tooltip="Party member index (0 = any)" onMouseDown={() => dispatch(sortRulesBy(['partyPosition', 'priority']))}>Party Member</div>
            <div className="header-item header-friend-member-hp" tooltip="Friend HP% trigger" onMouseDown={() => dispatch(sortRulesBy(['friendHpTriggerPercentage', 'priority']))}>Friend HP%</div>
            <div className="header-item header-friend-priority" tooltip="Rule priority - shared across all rules!" onMouseDown={() => dispatch(sortRulesBy(['priority', 'friendHpTriggerPercentage']))}>Priority</div>
            {/* <div className="header-item header-friend-cd" tooltip="Rule Custom Cooldown (ms)" onMouseDown={() => dispatch(sortRulesBy(['delay', 'priority']))}>CustomCD</div> */}
             {/* Optional: Add Walking header if needed */}
             {/* <div className="header-item header-friend-running" tooltip="Trigger Rule only if character is moving" onMouseDown={() => dispatch(sortRulesBy(['isWalking', 'priority']))}><img src={runningMan} alt="isWalking" /></div> */}
          </>
        );
      case 'manasync':
        return (
          <>
            {/* ManaSync Headers - UPDATED */}
            <div className="header-item header-manasync-enable" tooltip="Enable rule" onMouseDown={() => dispatch(sortRulesBy(['enabled', 'priority']))}>•</div>
            <div className="header-item header-manasync-item" tooltip="Select Potion" onMouseDown={() => dispatch(sortRulesBy(['actionItem', 'priority']))}>Potion</div>
            <div className="header-item header-manasync-hk" tooltip="Edit rule hotkey" onMouseDown={() => dispatch(sortRulesBy(['key', 'priority']))}>HK</div>
            <div className="header-item header-manasync-hp" tooltip="Your HP Percentage" onMouseDown={() => dispatch(sortRulesBy(['hpTriggerPercentage', 'priority']))}>Health %</div>
            <div className="header-item header-manasync-mana" tooltip="Your MP Percentage" onMouseDown={() => dispatch(sortRulesBy(['manaTriggerPercentage', 'priority']))}>Mana %</div>
            {/* Added Priority Header Back */}
            <div className="header-item header-manasync-priority" tooltip="Rule priority" onMouseDown={() => dispatch(sortRulesBy(['priority']))}>Priority</div>
            {/* Removed Monster, Delay, Walking */}
          </>
        );
      // Default handles 'userRule' or any unspecified variant
      default:
        return (
          <>
            {/* Default/UserRule Headers - UPDATED */}
            <div className="header-item header-default-enable" tooltip="Enable rule" onMouseDown={() => dispatch(sortRulesBy(['enabled', 'priority']))}>•</div>
            <div className="header-item header-default-name" tooltip="Edit rule name" onMouseDown={() => dispatch(sortRulesBy(['name', 'priority']))}>Name</div>
            <div className="header-item header-default-category" tooltip="Edit rule category" onMouseDown={() => dispatch(sortRulesBy(['category', 'priority']))}>CD Group</div>
            <div className="header-item header-default-hk" tooltip="Edit rule hotkey" onMouseDown={() => dispatch(sortRulesBy(['key', 'priority']))}>HK</div>
            <div className="header-item header-default-hp" tooltip="Your HP Percentage" onMouseDown={() => dispatch(sortRulesBy(['hpTriggerPercentage', 'priority']))}>Health %</div>
            <div className="header-item header-default-mana" tooltip="Your MP Percentage" onMouseDown={() => dispatch(sortRulesBy(['manaTriggerPercentage', 'priority']))}>Mana %</div>
            <div className="header-item header-default-monster" tooltip="Number of Monsters" onMouseDown={() => dispatch(sortRulesBy(['monsterNum', 'priority']))}>Monster#</div>
            <div className="header-item header-default-priority" tooltip="Rule priority - shared across all rules!" onMouseDown={() => dispatch(sortRulesBy(['priority', 'hpTriggerPercentage']))}>Priority</div>
            {/* REMOVED CustomCD Header */}
            {/* <div className="header-item header-default-cd" tooltip="Rule Custom Cooldown (ms)" onMouseDown={() => dispatch(sortRulesBy(['delay', 'priority']))}>CustomCD</div> */}
            {/* REMOVED Walking Header */}
            {/* <div className="header-item header-default-running" tooltip="Trigger Rule only if character is moving" onMouseDown={() => dispatch(sortRulesBy(['isWalking', 'priority']))}><img src={runningMan} alt="isWalking" /></div> */}
          </>
        );
    }
  };

  return (
    <StyledDiv className={variantClassName}>
      <div className="header">
        {renderHeaders()} {/* Render the correct headers */}
        <div className="header-item header-placeholder">-</div> {/* Placeholder remains */}
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
