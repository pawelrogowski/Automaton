import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import HealingRule from '../components/HealingRule/HealingRule.js';
import { addRule, reorderRules } from '../redux/slices/healingSlice.js';
import { PlusSquare } from 'react-feather';
import StyledMain from './Healing.styled.js';
import StatBar from '../components/StatBar/StatBar.jsx';
import { setHealing } from '../redux/slices/globalSlice.js';
import Switch from 'react-switch';

export const Healing = () => {
  const dispatch = useDispatch();
  const rules = useSelector((state) => state.healing);
  const { hpPercentage, manaPercentage } = useSelector((state) => state.gameState);
  const { windowTitle, windowId, healingEnabled } = useSelector((state) => state.global);
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

  return (
    <StyledMain>
      <section>
        <Switch
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
          height={32}
          width={72}
        />
        <div className="bar-container">
          <StatBar value={hpPercentage} fill={` #990000`} />
          <StatBar value={manaPercentage} fill={` #350099`} />
        </div>
        <h2>
          {windowTitle}({windowId})
        </h2>

        <button className="add-button" type="button" onClick={handleAddRule}>
          <PlusSquare size={32} />
        </button>
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
