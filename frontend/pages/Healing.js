import React, { useMemo, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import HealingRule from '../components/HealingRule/HealingRule.js';
import StyledMain from './Healing.styled.js';
import { StyledSection } from '../components/SectionBlock/SectionBlock.styled.js';
import RuleListWrapper from '../components/RuleListWrapper/RuleListWrapper.js';
import { StatBars } from '../components/StatBars.js/StatBars.js';
import HighWrapper from '../components/HighWrapper/HighWrapper.js';
import PartyHealingRule from '../components/PartyHealingRule/PartyHealingRule.js';
import ActionBarRule from '../components/ActionBarRule/ActionBarRule.js';
import ManaSyncRule from '../components/ManaSyncRule/ManaSyncRule.js';
import SpellRotationRule from '../components/SpellRotationRule/SpellRotationRule.js';
import EquipRule from '../components/EquipRule/EquipRule.js';
import { addRule } from '../redux/slices/ruleSlice.js';
import ActionBarIcon from '../assets/action_bar.png';
import healParty from '../assets/actionBarItems/Ultimate_Healing_Rune.gif';
import UMP from '../assets/actionBarItems/Ultimate_Mana_Potion.gif';
import SSA from '../assets/Stone_Skin_Amulet.gif';
import mageHat from '../assets/The_Epic_Wisdom.gif';

export const Healing = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const rules = useSelector((state) => state.rules.rules);
  const { hppc, mppc } = useSelector((state) => state.gameState);
  const location = useLocation();
  const hash = location.hash;

  // Memoize filtered rule lists to prevent unnecessary recalculation
  const mana_sync_rules = useMemo(
    () => rules.filter((rule) => rule.id.includes('manaSync')),
    [rules],
  );
  const action_bar_rules = useMemo(
    () => rules.filter((rule) => rule.id.includes('actionBarItem')),
    [rules],
  );
  const heal_friend_rules = useMemo(
    () => rules.filter((rule) => rule.id.includes('healFriend')),
    [rules],
  );
  const rotation_rules = useMemo(
    () => rules.filter((rule) => rule.id.includes('rotationRule')),
    [rules],
  );
  const equip_rules = useMemo(
    () => rules.filter((rule) => rule.id.includes('equipRule')),
    [rules],
  );

  // Memoize render_rules to prevent recreation on every render
  const render_rules = useCallback((rules_to_render) => {
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
        <RuleComponent
          key={rule.id}
          rule={rule}
          className={class_name}
        ></RuleComponent>
      );
    });
  }, []);

  const handleAddRule = useCallback(() => {
    let ruleIdPrefix;
    switch (hash) {
      case '#party':
        ruleIdPrefix = 'healFriend';
        break;
      case '#manasync':
        ruleIdPrefix = 'manaSync';
        break;
      case '#actionbar':
        ruleIdPrefix = 'actionBarItem';
        break;
      case '#rotations':
        ruleIdPrefix = 'rotationRule';
        break;
      case '#equip':
        ruleIdPrefix = 'equipRule';
        break;
      default:
        console.warn('Cannot add rule on current page/hash:', hash);
        return;
    }
    if (ruleIdPrefix) {
      const newRuleId = `${ruleIdPrefix}${uuidv4()}`;
      dispatch(addRule(newRuleId));
    }
  }, [dispatch, hash]);

  const filterButtons = [
    {
      hash: '#actionbar',
      label: 'Action Bar',
      icon: ActionBarIcon,
      tooltip: 'Show action bar rules',
    },
    {
      hash: '#party',
      label: 'Party Heal',
      icon: healParty,
      tooltip: 'Show party heal rules',
    },
    {
      hash: '#manasync',
      label: 'Potion-Sync',
      icon: UMP,
      tooltip: 'Show potion-sync rules',
    },
    {
      hash: '#equip',
      label: 'Auto Equip',
      icon: SSA,
      tooltip: 'Show auto equip rules',
    },
    {
      hash: '#rotations',
      label: 'Rotations',
      icon: mageHat,
      tooltip: 'Show spell rotation rules',
    },
  ];

  const render_section = (hash_key, title, rules_to_render) => {
    return hash === hash_key && <>{render_rules(rules_to_render)}</>;
  };

  return (
    <StyledMain>
      <div className="filter-bar">
        <div className="filter-buttons">
          {filterButtons.map(({ hash: filterHash, label, icon, tooltip }) => (
            <button
              key={filterHash}
              className={`filter-button ${hash === filterHash ? 'active' : ''}`}
              onClick={() => navigate(`/healing${filterHash}`)}
              title={tooltip}
            >
              <img src={icon} alt={label} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <button
          className="add-rule-button"
          onClick={handleAddRule}
          title="Add a new rule to selected section"
        >
          + Add Rule
        </button>
      </div>

      <div className="content-area">
        <StatBars hppc={hppc} mppc={mppc} />

        <StyledSection>
          {/* Sections now pass the filtered rules directly */}
          {render_section('#actionbar', 'Action Bar Rules', action_bar_rules)}

          {render_section('#manasync', 'Attack-Sync Rules', mana_sync_rules)}

          {render_section('#party', 'Party Heal Rules', heal_friend_rules)}

          {render_section('#equip', 'Auto Equip Rules', equip_rules)}

          {render_section('#rotations', 'Spell Rotation Rules', rotation_rules)}
        </StyledSection>
      </div>
    </StyledMain>
  );
};

export default Healing;
