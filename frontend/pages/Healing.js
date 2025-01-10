import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import HealingRule from '../components/HealingRule/HealingRule.js';
import StyledMain from './Healing.styled.js';
import { StyledSection } from '../components/SectionBlock/SectionBlock.styled.js';
import RuleListWrapper from '../components/RuleListWrapper/RuleListWrapper.js';
import { StatBars } from '../components/StatBars.js/StatBars.js';
import HighWrapper from '../components/HighWrapper/HighWrapper.js';
import { useLocation } from 'react-router-dom';
import PartyHealingRule from '../components/PartyHealingRule/PartyHealingRule.js';

export const Healing = () => {
  const activePresetIndex = useSelector((state) => state.healing.activePresetIndex);
  const rules = useSelector((state) => state.healing.presets[activePresetIndex]);
  const { hpPercentage, manaPercentage } = useSelector((state) => state.gameState);
  const location = useLocation();
  const hash = location.hash;

  const manaSyncRules = rules.filter((rule) => rule.id.includes('manaSync'));
  const healFriendRules = rules.filter((rule) => rule.id.includes('healFriend'));

  // Function to get the tooltip based on rule type
  const getTooltipForRuleType = (ruleType) => {
    switch (ruleType) {
      case 'userRule':
        return 'Customize Rules For Conditional Execution - Potions, Spells, Dishes etc.';
      case 'manaSync':
        return 'Rules that synchronize with your attack cooldowns.';
      case 'party':
        return "Party healing rules to manage your allies' health.";
      case 'equip':
        return 'Equipment-related rules';
      default:
        return 'Customize rules for conditional execution';
    }
  };

  const renderRules = (rules, isParty = false) => {
    return rules.map((rule, index) => {
      console.log('Rendering rule with ID:', rule.id);
      const className = index % 2 === 0 ? 'list-bg' : '';

      const RuleComponent = isParty ? PartyHealingRule : HealingRule;

      // Determine the tooltip based on the rule type
      const tooltip = getTooltipForRuleType(
        rule.id.includes('manaSync') ? 'manaSync' : rule.id.includes('healFriend') ? 'party' : 'userRule',
      );

      return (
        <RuleComponent key={rule.id} rule={rule} className={className}>
          <RuleListWrapper tooltip={tooltip}>{/* Render the actual rule content */}</RuleListWrapper>
        </RuleComponent>
      );
    });
  };

  const renderSection = (hashKey, title, rulesToRender, variant = null) => {
    if (hashKey === '#equip') {
      return (
        hash === hashKey && (
          <HighWrapper title={title} className="healing-rules-box">
            <div>
              <span style={{ color: '#fafafa', fontSize: '24px' }}>Coming Soon</span>
            </div>
          </HighWrapper>
        )
      );
    }

    return (
      hash === hashKey && (
        <HighWrapper title={title} className="healing-rules-box">
          <div>
            <RuleListWrapper tooltip="Customize rules for conditional execution" variant={variant}>
              {renderRules(rulesToRender, hashKey === '#party')}
            </RuleListWrapper>
          </div>
        </HighWrapper>
      )
    );
  };

  return (
    <StyledMain>
      <StyledSection>
        <StatBars hpPercentage={hpPercentage} manaPercentage={manaPercentage} />

        {renderSection(
          '#userrules',
          'Rules',
          rules.filter((rule) => rule.id.includes('userRule')),
        )}

        {renderSection('#manasync', 'Attack-Sync Rules', manaSyncRules)}

        {renderSection('#party', 'Party Heal Rules', healFriendRules, 'friends')}

        {renderSection('#equip', 'Equipment Rules', [])}
      </StyledSection>
    </StyledMain>
  );
};

export default Healing;
