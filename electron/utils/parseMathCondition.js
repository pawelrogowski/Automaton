/**
 * Parse mathematical conditions for HP and mana triggers.
 * @param {string} condition - The mathematical condition to check.
 * @param {number} triggerPercentage - The trigger percentage value.
 * @param {number} actualPercentage - The actual percentage value to check against.
 * @returns {boolean} - True if the condition is met, false otherwise.
 */
const parseMathCondition = (condition, triggerPercentage, actualPercentage) => {
  switch (condition) {
    case '<':
      return actualPercentage < triggerPercentage;
    case '<=':
      return actualPercentage <= triggerPercentage;
    case '=':
      return actualPercentage === triggerPercentage;
    case '>':
      return actualPercentage > triggerPercentage;
    case '>=':
      return actualPercentage >= triggerPercentage;
    case '!=':
      return actualPercentage !== triggerPercentage;
    default:
      return false;
  }
};

export default parseMathCondition;
