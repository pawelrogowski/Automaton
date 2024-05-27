import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import HealingRule from '../components/HealingRule/HealingRule.js';
import { addRule, updateManaSync, toggleManaSyncEnabled } from '../redux/slices/healingSlice.js';
import StyledMain from './Healing.styled.js';
import { setIsBotEnabled, setRefreshRate } from '../redux/slices/globalSlice.js';
import { StyledSection } from '../components/SectionBlock/SectionBlock.styled.js';
import RuleListWrapper from '../components/RuleListWrapper/RuleListWrapper.js';
import CustomCheckbox from '../components/CustomCheckbox/CustomCheckbox.js';
import SunkenWrapper from '../components/SunkenWrapper/SunkenWrapper.js';
import ListInput from '../components/ListInput/ListInput.js';
import ListSelect from '../components/ListSelect/ListSelect.js';
import keyboardKeys from '../constants/keyboardKeys.js';
import { StatBars } from '../components/StatBars.js/StatBars.js';
import SquareGrid from '../components/SquareGrid/SquareGrid.js';

export const Healing = () => {
  const dispatch = useDispatch();
  const rules = useSelector((state) => state.healing);
  const { hpPercentage, manaPercentage } = useSelector((state) => state.gameState);
  const { windowId, botEnabled, refreshRate } = useSelector((state) => state.global);
  const isAnyRuleEnabled = rules.some((rule) => rule.enabled);

  const manaSyncRule = useSelector((state) =>
    state.healing.find((rule) => rule.id === 'manaSync'),
  ) || { manaTriggerPercentage: '80' };

  const handleAddRule = () => {
    const newRule = {
      name: 'New Rule',
      enabled: false,
      key: 'F6',
      colors: [],
      id: Date.now().toString(),
      hpTriggerCondition: '<=',
      hpTriggerPercentage: '80',
      manaTriggerCondition: '>=',
      manaTriggerPercentage: '5',
      priority: '1',
      delay: '100',
      category: 'Healing',
    };
    dispatch(addRule(newRule));
  };

  const handleHealingToggle = () => {
    dispatch(setIsBotEnabled(!botEnabled));
  };

  const handleManaSyncPercentageChange = (event) => {
    const value = event.target.value;
    dispatch(updateManaSyncTriggerPercentage(value));
  };

  const handleRefreshRateChange = (event) => {
    const value = event.target.value;
    dispatch(setRefreshRate(Math.max(25, value)));
  };

  const handleManaSyncToggle = () => {
    dispatch(toggleManaSyncEnabled());
  };

  const { saveRules, loadRules } = window.electron;

  const handleSaveRules = () => {
    saveRules();
  };

  const handleLoadRules = async () => {
    await loadRules();
  };

  return (
    <StyledMain>
      <StyledSection className="setting-section">
        <div className="top-bar">
          <div className="square"></div>
          <StatBars hpPercentage={hpPercentage} manaPercentage={manaPercentage} />
        </div>
        <div className="settings-row">
          <div className="enable-wrapper">
            <CustomCheckbox
              checked={botEnabled}
              onChange={handleHealingToggle}
              disabled={windowId === null}
              size={16}
            />
            <h2 className="enable-text">Enabled</h2>
          </div>

          <div className="refresh-rate-row">
            <h5>refresh</h5>
            <ListInput
              type="number"
              className="input-percent input-field input-long"
              id="refreshRate"
              value={refreshRate}
              onChange={handleRefreshRateChange}
              placeholder="25"
              min="25"
              max="20000"
            />
            <h5>ms</h5>
          </div>
          {manaSyncRule && (
            <div className="mana-sync-column margin-left">
              <div className="mana-sync-row">
                <CustomCheckbox
                  checked={manaSyncRule.enabled}
                  onChange={handleManaSyncToggle}
                  size={18}
                />
                <h5 className="mana-sync-row-text mana-sync-checkbox-text">
                  Sync HK with Attack CD:
                </h5>
              </div>

              <div className="mana-sync-row mana-sync-hotkey">
                <h5>HK:</h5>
                <ListSelect
                  className="input-hotkey input-field"
                  id="manaSyncKey"
                  value={manaSyncRule.key || 'F1'}
                  onChange={(event) =>
                    dispatch(
                      updateManaSync({
                        key: event.target.value,
                        manaTriggerPercentage: manaSyncRule.manaTriggerPercentage,
                      }),
                    )
                  }
                  placeholder="F1"
                >
                  {keyboardKeys.map((key) => (
                    <option key={key.value} value={key.value}>
                      {key.label}
                    </option>
                  ))}
                </ListSelect>
              </div>
              <div className="mana-sync-row">
                <h5>Mana%:</h5>
                <ListInput
                  type="number"
                  className="input-percent input-field"
                  id="manaSyncPercentage"
                  value={manaSyncRule.manaTriggerPercentage}
                  onChange={handleManaSyncPercentageChange}
                  placeholder="80"
                  min="1"
                  max="100"
                />
              </div>
            </div>
          )}
        </div>
      </StyledSection>
      <StyledSection>
        <SunkenWrapper className="settings-wrapper">
          <SquareGrid />
        </SunkenWrapper>
        <SunkenWrapper className="list-wrapper">
          <div className="button-container">
            <button className="add-button button-page" type="button" onMouseDown={handleAddRule}>
              ADD NEW RULE
            </button>
            <button className="save-button button-page" type="button" onMouseDown={handleLoadRules}>
              LOAD
            </button>
            <button className="load-button button-page" type="button" onMouseDown={handleSaveRules}>
              SAVE
            </button>
          </div>
          <RuleListWrapper>
            {rules
              .filter((rule) => rule.id !== 'manaSync')
              .map((rule, index) => (
                <HealingRule key={rule.id} rule={rule} />
              ))}
          </RuleListWrapper>
        </SunkenWrapper>
      </StyledSection>
    </StyledMain>
  );
};

export default Healing;
