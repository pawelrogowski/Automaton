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
        <HighWrapper className="top-bar" title="Automaton Bot">
          <StatBars hpPercentage={hpPercentage} manaPercentage={manaPercentage} />
        </HighWrapper>
        <HighWrapper className="settings-wrapper" title="General Settings">
          <div className="settings-row">
            <div className="enable-wrapper">
              <CustomCheckbox
                checked={botEnabled}
                onChange={handleBotEnabledToggle}
                disabled={windowId === null}
                size={16}
              />
              <h2 className="enable-text">On</h2>
            </div>
            <div className="refresh-rate-row">
              <h5>refresh</h5>
              <ListInput
                type="number"
                className="input-percent input-field input-long"
                id="refreshRate"
                value={refreshRate}
                defaultValue="25"
                onChange={handleRefreshRateChange}
                placeholder="25"
                min="0"
                max="20000"
              />
              <h5>ms</h5>
            </div>
            <PresetSelector />
          </div>
        </HighWrapper>
        <HighWrapper title="Healing Rules">
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
          <div className="controllers-wrapper">
            <HealFriendControls />
            <ManaSyncController />
          </div>
        </HighWrapper>
      </StyledSection>
    </StyledMain>
  );
};

export default Healing;
