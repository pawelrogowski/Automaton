import React from 'react';
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

export const Healing = () => {
  const dispatch = useDispatch();
  const rules = useSelector((state) => state.healing);
  const { hpPercentage, manaPercentage } = useSelector((state) => state.gameState);
  const { windowId, botEnabled } = useSelector((state) => state.global);
  const isAnyRuleEnabled = rules.some((rule) => rule.enabled);
  const manaSyncRule = useSelector((state) =>
    state.healing.find((rule) => rule.category === 'Potion'),
  );

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
        <SunkenWrapper className="header-wrapper">
          <div className="enable-wrapper">
            <CustomCheckbox
              checked={botEnabled}
              onChange={handleHealingToggle}
              disabled={windowId === null}
            />
            <h2>Enable Bot</h2>
          </div>
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
        </SunkenWrapper>

        {manaSyncRule && (
          <div className="manaSync-rule">
            <div className="input-wrapper">
              <Switch
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
                disabled={botEnabled}
                offColor="#ff1c1c"
                onColor="#00ff00"
                handleDiameter={26}
                uncheckedIcon={false}
                checkedIcon={false}
                boxShadow="0px   1px   5px rgba(0,   0,   0,   0.6)"
                activeBoxShadow="0px   0px   1px   10px rgba(0,   0,   0,   0.2)"
                height={18}
                width={48}
                className="react-switch"
              />
            </div>
            <div className="input-wrapper">
              <input
                className="input input-hotkey"
                id="manaSyncKey"
                value={manaSyncRule.key}
                onChange={(event) =>
                  dispatch(
                    updateManaSync({
                      key: event.target.value,
                      manaTriggerPercentage: manaSyncRule.manaTriggerPercentage,
                    }),
                  )
                }
                placeholder="F1"
                disabled={botEnabled}
              />
              <label className="label" htmlFor="manaSyncKey">
                Hotkey
              </label>
            </div>
            <div className="input-wrapper">
              <input
                type="number"
                className="input input-percent"
                id="manaSyncPercentage"
                value={manaSyncRule.manaTriggerPercentage}
                onChange={(event) => {
                  if (event.target.value !== undefined) {
                    dispatch(
                      updateManaSync({
                        key: manaSyncRule.key,
                        manaTriggerPercentage: event.target.value,
                      }),
                    );
                  }
                }}
                placeholder="0"
                disabled={botEnabled}
              />
              <label className="label" htmlFor="manaSyncPercentage">
                Mana %
              </label>
            </div>
          </div>
        )}
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
                        isDragDisabled={isAnyRuleEnabled}
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
      </StyledSection>
    </StyledMain>
  );
};

export default Healing;
