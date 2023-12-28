import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import HealingRule from '../components/HealingRule/HealingRule.js';
import { addRule } from '../redux/slices/healingSlice.js';
import { PlusSquare } from 'react-feather';
import StyledMain from './Healing.styled.js';

export const Healing = () => {
  const dispatch = useDispatch();
  const rules = useSelector((state) => state.healing);
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

  return (
    <StyledMain>
      <section>
        <button className="add-button" type="button" onClick={handleAddRule}>
          <PlusSquare className="add-healing-rule" size={32} />
        </button>
        {rules.map((rule) => (
          <HealingRule key={rule.id} rule={rule} />
        ))}
      </section>
    </StyledMain>
  );
};

export default Healing;
