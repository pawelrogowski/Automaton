import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { Download, Heart, Plus, Save, Zap } from 'react-feather';
import Switch from 'react-switch';
import HealingRule from '../components/HealingRule/HealingRule.js';
import { addRule, reorderRules } from '../redux/slices/healingSlice.js';
import StyledMain from './Healing.styled.js';
import StatBar from '../components/StatBar/StatBar.jsx';
import { setHealing } from '../redux/slices/globalSlice.js';

export const Healing = () => {
  const dispatch = useDispatch();
  const rules = useSelector((state) => state.healing);
  const { hpPercentage, manaPercentage } = useSelector((state) => state.gameState);
  const { windowId, healingEnabled } = useSelector((state) => state.global);
  const isAnyRuleEnabled = rules.some((rule) => rule.enabled);

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
    dispatch(setHealing(!healingEnabled));
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
      <section>
        <div className="heading-wrapper">
          <Switch
            className="main-switch"
            checked={healingEnabled}
            onChange={handleHealingToggle}
            disabled={windowId === null}
            offColor="#ff1c1c"
            onColor="#00ff00"
            handleDiameter={42}
            uncheckedIcon={false}
            checkedIcon={false}
            boxShadow="0px 1px 5px rgba(0, 0, 0, 0.6)"
            activeBoxShadow="0px 0px 1px 10px rgba(0, 0, 0, 0.2)"
            height={28}
            width={72}
          />
        </div>
        <div className="bar-container">
          <div className="health-bar">
            <StatBar value={hpPercentage} fill={` #990000`} />
            <Heart size={28} className="hp-icon" />
          </div>

          <div className="mana-bar">
            <StatBar value={manaPercentage} fill={` #350099`} />

            <Zap size={30} className="mp-icon" />
          </div>
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
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="rules">
            {(provided) => (
              <div {...provided.droppableProps} ref={provided.innerRef}>
                {rules.map((rule, index) => (
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
      </section>
    </StyledMain>
  );
};

export default Healing;
