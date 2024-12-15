import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import HealingRule from '../components/HealingRule/HealingRule.js';
import StyledMain from './Healing.styled.js';
import { StyledSection } from '../components/SectionBlock/SectionBlock.styled.js';
import RuleListWrapper from '../components/RuleListWrapper/RuleListWrapper.js';
import { StatBars } from '../components/StatBars.js/StatBars.js';
import HighWrapper from '../components/HighWrapper/HighWrapper.js';
import { useLocation } from 'react-router-dom';
// import PartyHealingRule from '../components/PartyHealingRule/PartyHealingRule.js';
import { v4 as uuidv4 } from 'uuid';

export const Healing = () => {
  const activePresetIndex = useSelector((state) => state.healing.activePresetIndex);
  const rules = useSelector((state) => state.healing.presets[activePresetIndex]);
  const { hpPercentage, manaPercentage } = useSelector((state) => state.gameState);
  const location = useLocation();
  const hash = location.hash;

  const manaSyncRules = rules.filter((rule) => rule.id.includes('manaSync'));
  const healFriendRules = rules.filter((rule) => rule.id.includes('healFriend'));

  const renderRules = (rules, isParty = false) => {
    return rules.map((rule, index) => {
      const className = index % 2 === 0 ? 'list-bg' : '';

      const RuleComponent = HealingRule;
      return <RuleComponent key={rule.id} rule={rule} className={className} />;
    });
  };

  const renderSection = (hashKey, title, rulesToRender, variant = null) =>
    hash === hashKey && (
      <HighWrapper title={title} className="healing-rules-box">
        <div>
          <RuleListWrapper tooltip="Customize rules for conditional" variant={variant}>
            {renderRules(rulesToRender, hashKey === '#party')}
          </RuleListWrapper>
        </div>
      </HighWrapper>
    );

  return (
    <StyledMain>
      <StyledSection>
        <StatBars hpPercentage={hpPercentage} manaPercentage={manaPercentage} />

        {renderSection(
          '#userrules',
          'Rules',
          rules.filter((rule) => rule.id.includes('userRule')),
        )}

        {/* {renderSection('#manasync', 'Mana-Sync Rules', manaSyncRules)}

        {renderSection('#party', 'Party Heal Rules', healFriendRules, 'friends')} */}
      </StyledSection>
    </StyledMain>
  );
};

export default Healing;
