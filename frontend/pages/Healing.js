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

export const Healing = () => {
  const dispatch = useDispatch();
  const activePresetIndex = useSelector((state) => state.healing.activePresetIndex);
  const rules = useSelector((state) => state.healing.presets[activePresetIndex]);
  const { hpPercentage, manaPercentage } = useSelector((state) => state.gameState);
  const { windowId, botEnabled, refreshRate } = useSelector((state) => state.global);
  const { saveRules, loadRules } = window.electron;

  const handleAddHealingRule = () => {
    dispatch(addRule());
  };

  const handleBotEnabledToggle = () => {
    dispatch(setIsBotEnabled(!botEnabled));
  };

  const handleRefreshRateChange = (event) => {
    dispatch(setRefreshRate(Math.max(0, event.target.value)));
  };

  const handleSaveRules = () => {
    saveRules();
  };

  const handleLoadRules = async () => {
    await loadRules();
  };

  return (
    <StyledMain>
      <StyledSection>
        <StatBars hpPercentage={hpPercentage} manaPercentage={manaPercentage} />

        <HighWrapper title="Rules" className="healing-rules-box">
          <div className="healing-enable-checkbox">
            <CustomCheckbox
              checked={botEnabled}
              onChange={handleBotEnabledToggle}
              disabled={windowId === null}
              width={17}
              height={17}
            />
          </div>
          <PresetSelector />
          <div>
            <div className="button-container">
              <button
                className="add-button button-page"
                type="button"
                onMouseDown={handleAddHealingRule}
              >
                ADD NEW RULE
              </button>

              <button
                className="save-button button-page"
                type="button"
                onMouseDown={handleLoadRules}
              >
                LOAD
              </button>
              <button
                className="load-button button-page"
                type="button"
                onMouseDown={handleSaveRules}
              >
                SAVE
              </button>
            </div>
            <RuleListWrapper>
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
            {/* <RuleListWrapper variant="friends">
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
            </RuleListWrapper> */}
          </div>
          {/* <div className="controllers-wrapper">
            <HealFriendControls />
            <ManaSyncController />
          </div> */}
        </HighWrapper>
      </StyledSection>
    </StyledMain>
  );
};

export default Healing;
