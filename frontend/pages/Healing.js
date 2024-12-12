import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import HealingRule from '../components/HealingRule/HealingRule.js';
import { addRule } from '../redux/slices/healingSlice.js';
import StyledMain from './Healing.styled.js';
import { setIsBotEnabled, setRefreshRate } from '../redux/slices/globalSlice.js';
import { StyledSection } from '../components/SectionBlock/SectionBlock.styled.js';
import RuleListWrapper from '../components/RuleListWrapper/RuleListWrapper.js';
import CustomCheckbox from '../components/CustomCheckbox/CustomCheckbox.js';
import ListInput from '../components/ListInput/ListInput.js';
import { StatBars } from '../components/StatBars.js/StatBars.js';
import PresetSelector from '../components/PresetSelector/PresetSelector.jsx';
import HealFriendControls from '../components/HealFriendController/HealFriendController.js';
import ManaSyncController from '../components/ManaSyncController/ManaSyncController.js';
import HighWrapper from '../components/HighWrapper/HighWrapper.js';
import { useLocation } from 'react-router-dom';

export const Healing = () => {
  const dispatch = useDispatch();
  const activePresetIndex = useSelector((state) => state.healing.activePresetIndex);
  const rules = useSelector((state) => state.healing.presets[activePresetIndex]);
  const { hpPercentage, manaPercentage } = useSelector((state) => state.gameState);
  const { windowId, botEnabled, refreshRate } = useSelector((state) => state.global);

  const location = useLocation();
  const hash = location.hash;

  return (
    <StyledMain>
      <StyledSection>
        <StatBars hpPercentage={hpPercentage} manaPercentage={manaPercentage} />
        {hash === '#userrules' ? (
          <HighWrapper title="Rules" className="healing-rules-box">
            <div>
              <RuleListWrapper tooltip="Customize rules for conditional">
                {rules
                  .filter((rule) => rule.id !== 'manaSync' && rule.id !== 'healFriend')
                  .map((rule, index) => (
                    <HealingRule
                      key={rule.id}
                      rule={rule}
                      className={index % 2 === 0 ? 'list-bg' : ''}
                    />
                  ))}
              </RuleListWrapper>
            </div>
          </HighWrapper>
        ) : hash === '#manasync' ? (
          <HighWrapper title="Mana-Sync Rules" className="healing-rules-box">
            <ManaSyncController />
          </HighWrapper>
        ) : hash === '#party' ? (
          <HighWrapper title="Party Heal Rules" className="healing-rules-box">
            <div>
              <RuleListWrapper variant="friends" tooltip="Customize rules for conditional">
                {rules
                  .filter((rule) => rule.id.includes('healFriend'))
                  .map((rule, index) => (
                    <HealingRule
                      variant="friends"
                      key={rule.id}
                      rule={rule}
                      className={index % 2 === 0 ? 'list-bg' : ''}
                    />
                  ))}
              </RuleListWrapper>
            </div>
          </HighWrapper>
        ) : null}
      </StyledSection>
    </StyledMain>
  );
};
export default Healing;
