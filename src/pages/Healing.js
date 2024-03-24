import React, { useState, useEffect, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { Heart, Zap } from 'react-feather';
import Switch from 'react-switch';
import HealingRule from '../components/HealingRule/HealingRule.js';
import { addRule, reorderRules, updateManaSync } from '../redux/slices/healingSlice.js';
import StyledMain from './Healing.styled.js';
import StatBar from '../components/StatBar/StatBar.jsx';
import { setIsBotEnabled } from '../redux/slices/globalSlice.js';
import { StyledSection } from '../components/SectionBlock/SectionBlock.styled.js';
import RuleListWrapper from '../components/RuleListWrapper/RuleListWrapper.js';
import CustomCheckbox from '../components/CustomCheckbox/CustomCheckbox.js';
import SunkenWrapper from '../components/SunkenWrapper/SunkenWrapper.js';
import ListInput from '../components/ListInput/ListInput.js';
import ListSelect from '../components/ListSelect/ListSelect.js';
import keyboardKeys from '../constants/keyboardKeys.js';

export const Healing = () => {
  const dispatch = useDispatch();
  const rules = useSelector((state) => state.healing);
  const { hpPercentage, manaPercentage } = useSelector((state) => state.gameState);
  const { windowId, botEnabled } = useSelector((state) => state.global);
  const isAnyRuleEnabled = rules.some((rule) => rule.enabled);
  const manaSyncRule = useSelector((state) => state.healing.find((rule) => rule.id === 'manaSync'));

  const [inputValue, setInputValue] = useState(manaSyncRule.manaTriggerPercentage || '50');
  const debounceTimeout = useRef(null);

  useEffect(() => {
    return () => {
      clearTimeout(debounceTimeout.current);
    };
  }, []);

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

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    dispatch(
      reorderRules({
        startIndex: result.source.index,
        endIndex: result.destination.index,
      }),
    );
  };

  const handleManaSyncPercentageChange = (event) => {
    const value = event.target.value;
    setInputValue(value); // Update the local state immediately

    clearTimeout(debounceTimeout.current);
    debounceTimeout.current = setTimeout(() => {
      if (value !== undefined) {
        dispatch(
          updateManaSync({
            key: manaSyncRule.key,
            manaTriggerPercentage: value,
          }),
        );
      }
    }, 500); // Adjust the delay as needed
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
      <StyledSection>
        <div className="bar-container">
          <div className="health-bar">
            <StatBar value={hpPercentage} fill={`#d10000`} />
            <Heart size={16} className="hp-icon" />
          </div>

          <div className="mana-bar">
            <StatBar value={manaPercentage} fill={`#3800a1`} />
            <Zap size={16} className="mp-icon" />
          </div>
        </div>
      </StyledSection>
      <StyledSection>
        <SunkenWrapper>
          <div className="enable-wrapper">
            <CustomCheckbox
              checked={botEnabled}
              onChange={handleHealingToggle}
              disabled={windowId === null}
              size={24}
            />
            <h2 className="enable-text">Enable (Alt+1)</h2>
          </div>
        </SunkenWrapper>
        <SunkenWrapper>
          {manaSyncRule && (
            <div className="mana-sync-column">
              <div className="mana-sync-row">
                <CustomCheckbox
                  checked={manaSyncRule.enabled}
                  onChange={() =>
                    dispatch(
                      updateManaSync({
                        key: manaSyncRule.key,
                        manaTriggerPercentage: manaSyncRule.manaTriggerPercentage,
                        enabled: !manaSyncRule.enabled,
                      }),
                    )
                  }
                  size={18}
                />
                <h5 className="mana-sync-row-text mana-sync-checkbox-text">
                  Sync Mana Pot with Attack Spells/Runes
                </h5>
              </div>

              <div className="mana-sync-row">
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

                <h5>Hotkey</h5>
              </div>
              <div className="mana-sync-row">
                <ListInput
                  type="number"
                  className="input-percent input-field"
                  id="manaSyncPercentage"
                  value={inputValue} // Use the local state for the input's value
                  onChange={handleManaSyncPercentageChange}
                  placeholder="80"
                  min="1"
                  max="100"
                />
                <h5>Max Mana %</h5>
              </div>
            </div>
          )}
        </SunkenWrapper>
        <SunkenWrapper className="list-wrapper">
          <div className="button-container">
            <button className="add-button button-page" type="button" onClick={handleAddRule}>
              ADD NEW RULE
            </button>
            <button className="save-button button-page" type="button" onClick={handleLoadRules}>
              LOAD
            </button>
            <button className="load-button button-page" type="button" onClick={handleSaveRules}>
              SAVE
            </button>
          </div>
          <RuleListWrapper>
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="rules">
                {(provided) => (
                  <div {...provided.droppableProps} ref={provided.innerRef}>
                    {rules
                      .filter((rule) => rule.id !== 'manaSync') // Exclude the manaSync rule
                      .map((rule, index) => (
                        <Draggable
                          key={rule.id}
                          draggableId={rule.id}
                          index={index}
                          isDragDisabled={true}
                        >
                          {(provided) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                            >
                              <HealingRule rule={rule} />
                            </div>
                          )}
                        </Draggable>
                      ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          </RuleListWrapper>
        </SunkenWrapper>
      </StyledSection>
    </StyledMain>
  );
};

export default Healing;
