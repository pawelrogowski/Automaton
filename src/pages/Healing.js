import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import HealingRule from '../components/HealingRule/HealingRule.js';
import { addRule, reorderRules } from '../redux/slices/healingSlice.js';
import { PlusSquare } from 'react-feather';
import StyledMain from './Healing.styled.js';

export const Healing = () => {
  const dispatch = useDispatch();
  const rules = useSelector((state) => state.healing);
  const { hpPercentage, manaPercentage } = useSelector((state) => state.gameState);
  const isAnyRuleEnabled = rules.some((rule) => rule.enabled);
  const handleAddRule = () => {
    const newRule = {
      id: Date.now().toString(),
      name: '',
      enabled: false,
      key: '',
      interval: '',
      colors: [],
    };
    dispatch(addRule(newRule));
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
        <progress max="100" value={hpPercentage} />
        <progress max="100" value={manaPercentage} />

        <button className="add-button" type="button" onClick={handleAddRule}>
          <PlusSquare className="add-healing-rule" size={32} />
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
