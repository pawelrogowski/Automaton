import React, { useState } from 'react';
import HealingRule from '../components/HealingRule/HealingRule.js';

export const Healing = () => {
  const [rules, setRules] = useState([
    {
      name: 'name1',
      enabled: false,
      color: '#000000',
      coords: { x: 800, y: 600 },
      key: 'F1',
      interval: '100',
    },
  ]);

  const handleRuleChange = (index, updatedRule) => {
    setRules(rules.map((rule, i) => (i === index ? updatedRule : rule)));
  };

  return (
    <div>
      {rules.map((rule) => (
        <HealingRule
          key={rule.name}
          rule={rule}
          onRuleChange={(updatedRule) => handleRuleChange(rule.name, updatedRule)}
        />
      ))}
    </div>
  );
};

export default Healing;
