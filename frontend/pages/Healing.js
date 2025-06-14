import React from 'react';
import { useSelector } from 'react-redux';
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
import EquipRule from '../components/EquipRule/EquipRule.js';

export const Healing = () => {
  const active_preset_index = useSelector((state) => state.rules.activePresetIndex);
  const rules = useSelector((state) => state.rules.presets[active_preset_index]);
  const { hppc, mppc } = useSelector((state) => state.gameState);
  const location = useLocation();
  const hash = location.hash;

  const mana_sync_rules = rules.filter((rule) => rule.id.includes('manaSync'));
  const action_bar_rules = rules.filter((rule) => rule.id.includes('actionBarItem'));
  const heal_friend_rules = rules.filter((rule) => rule.id.includes('healFriend'));
  const rotation_rules = rules.filter((rule) => rule.id.includes('rotationRule'));
  const equip_rules = rules.filter((rule) => rule.id.includes('equipRule'));
  const user_rules = rules.filter(
    (rule) =>
      !rule.id.includes('manaSync') &&
      !rule.id.includes('actionBarItem') &&
      !rule.id.includes('healFriend') &&
      !rule.id.includes('rotationRule') &&
      !rule.id.includes('equipRule'),
  );


  const render_rules = (rules_to_render) => {
    return rules_to_render.map((rule, index) => {
      const class_name = index % 2 === 0 ? 'list-bg' : '';

      let RuleComponent;

      // Determine component based on rule ID structure
      if (rule.id.includes('manaSync')) {
        RuleComponent = ManaSyncRule;
      } else if (rule.id.includes('actionBarItem')) {
        RuleComponent = ActionBarRule;
      } else if (rule.id.includes('healFriend')) {
        RuleComponent = PartyHealingRule;
      } else if (rule.id.includes('rotationRule')) {
        RuleComponent = SpellRotationRule;
      } else if (rule.id.includes('equipRule')) {
        RuleComponent = EquipRule;
      } else {
        // Default to HealingRule for any other type (e.g., userRule)
        RuleComponent = HealingRule;
      }

      // Add a check to ensure the component exists before rendering
      if (!RuleComponent) {
         console.error(`No component determined for rule ID: ${rule.id}`);
         return null; // Don't render if component is missing
      }

      return (
        <RuleComponent key={rule.id} rule={rule} className={class_name}>
        </RuleComponent>
      );
    });
  };

  const render_section = (hash_key, title, rules_to_render) => {
    return (
      hash === hash_key && (
        <>
          {render_rules(rules_to_render)}
        </>
      )
    );
  };

  return (
    <StyledMain>
      <StyledSection>
        <StatBars hppc={hppc} mppc={mppc} />

        {/* Sections now pass the filtered rules directly */}
        {render_section(
          '#userrules',
          'Rules',
          user_rules
        )}

        {render_section(
          '#actionbar',
          'Action Bar Rules',
          action_bar_rules
        )}

        {render_section(
          '#manasync',
          'Attack-Sync Rules',
          mana_sync_rules
        )}

        {render_section(
          '#party',
          'Party Heal Rules',
          heal_friend_rules
        )}

        {render_section(
          '#equip',
          'Auto Equip Rules',
          equip_rules
        )}

        {render_section(
          '#rotations',
          'Spell Rotation Rules',
          rotation_rules
        )}
      </StyledSection>
    </StyledMain>
  );
};

export default Healing;
