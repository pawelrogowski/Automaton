import React from 'react';
import {useSelector } from 'react-redux';
import HealingRule from '../components/HealingRule/HealingRule.js';
import StyledMain from './Healing.styled.js';
import { StyledSection } from '../components/SectionBlock/SectionBlock.styled.js';
import RuleListWrapper from '../components/RuleListWrapper/RuleListWrapper.js';
import { StatBars } from '../components/StatBars.js/StatBars.js';
import HighWrapper from '../components/HighWrapper/HighWrapper.js';
import { useLocation } from 'react-router-dom';
import PartyHealingRule from '../components/PartyHealingRule/PartyHealingRule.js';
import ActionBarRule from '../components/ActionBarRule/ActionBarRule.js';
import ManaSyncRule from '../components/ManaSyncRule/ManaSyncRule.js';
import SpellRotationRule from '../components/SpellRotationRule/SpellRotationRule.js';

export const Healing = () => {
  const activePresetIndex = useSelector((state) => state.healing.activePresetIndex);
  const rules = useSelector((state) => state.healing.presets[activePresetIndex]);
  const { hpPercentage, manaPercentage } = useSelector((state) => state.gameState);
  const location = useLocation();
  const hash = location.hash;

  const manaSyncRules = rules.filter((rule) => rule.id.includes('manaSync'));
  const actionBarRules = rules.filter((rule) => rule.id.includes('actionBarItem'));
  const healFriendRules = rules.filter((rule) => rule.id.includes('healFriend'));
  const rotationRules = rules.filter((rule) => rule.id.includes('rotationRule'));
  const userRules = rules.filter(
    (rule) =>
      !rule.id.includes('manaSync') &&
      !rule.id.includes('actionBarItem') &&
      !rule.id.includes('healFriend') &&
      !rule.id.includes('rotationRule'),
  );

  // Function to get the tooltip based on rule type
  const getTooltipForRuleType = (ruleType) => {
    switch (ruleType) {
      case 'userRule':
        return 'Customize Rules For Conditional Execution - Potions, Spells, Dishes etc.';
      case 'actionBarItem':
        return 'Customize Rules For Action Bar Items';
      case 'manaSync':
        return 'Rules that synchronize with your attack cooldowns.';
      case 'party':
        return "Party healing rules to manage your allies' health.";
      case 'equip':
        return 'Equipment-related rules';
      case 'rotationRule':
        return 'Define sequences of key presses with delays.';
      default:
        return 'Customize rules for conditional execution';
    }
  };

  const renderRules = (rulesToRender) => {
    return rulesToRender.map((rule, index) => {
      // console.log('Rendering rule with ID:', rule.id, 'for hash:', hash); // More detailed log if needed
      const className = index % 2 === 0 ? 'list-bg' : '';

      let RuleComponent;
      let ruleType = 'userRule'; // Default

      // Determine component based on rule ID structure
      if (rule.id.includes('manaSync')) {
        RuleComponent = ManaSyncRule;
        ruleType = 'manaSync';
      } else if (rule.id.includes('actionBarItem')) {
        RuleComponent = ActionBarRule;
        ruleType = 'actionBarItem';
      } else if (rule.id.includes('healFriend')) {
        RuleComponent = PartyHealingRule;
        ruleType = 'party';
      } else if (rule.id.includes('rotationRule')) {
        RuleComponent = SpellRotationRule;
        ruleType = 'rotationRule';
      } else {
        // Default to HealingRule for any other type (e.g., userRule)
        RuleComponent = HealingRule;
        ruleType = 'userRule';
      }

      const tooltip = getTooltipForRuleType(ruleType);

      // Add a check to ensure the component exists before rendering
      if (!RuleComponent) {
         console.error(`No component determined for rule ID: ${rule.id}`);
         return null; // Don't render if component is missing
      }

      return (
        // Pass tooltip to the rule component if it accepts it, otherwise wrap or ignore
        <RuleComponent key={rule.id} rule={rule} className={className} tooltip={tooltip}>
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

    // Determine rule type from hash for tooltip (can be simplified)
    const sectionRuleType = hashKey.substring(1).replace('rules', 'Rule');

    return (
      hash === hashKey && (
        <HighWrapper title={title} className="healing-rules-box">
          <div>
            <RuleListWrapper
               tooltip={getTooltipForRuleType(sectionRuleType)} // Use hash for section tooltip
               variant={variant || (hashKey === '#actionbar' ? 'actionbar' : hashKey === '#rotations' ? 'rotations' : null)}
            >
               {/* Call renderRules directly with the filtered list */}
               {renderRules(rulesToRender)}
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

        {/* Sections now pass the filtered rules directly */}
        {renderSection(
          '#userrules',
          'Rules',
          userRules
          // Default variant uses 'default' headers
        )}

        {renderSection(
          '#actionbar',
          'Action Bar Rules',
          actionBarRules,
          'actionbar' // Pass 'actionbar' variant
        )}

        {renderSection(
          '#manasync',
          'Attack-Sync Rules',
          manaSyncRules,
          'manasync' // --- Pass 'manasync' variant ---
        )}

        {renderSection(
          '#party',
          'Party Heal Rules',
          healFriendRules,
          'friends' // Pass 'friends' variant
        )}

        {renderSection(
          '#rotations',
          'Spell Rotation Rules',
          rotationRules,
          'rotations'
        )}

        {renderSection('#equip', 'Equipment Rules', [])}
      </StyledSection>
    </StyledMain>
  );
};

export default Healing;
