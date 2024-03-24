/**
 * Check if character status conditions are met.
 * @param {Object} rule - The rule object.
 * @param {Object} gameState - The game state object.
 * @returns {boolean} - True if all conditions are met, false otherwise.
 */
const areCharStatusConditionsMet = (rule, gameState) => {
  // Check each condition in the rule's conditions array
  return rule.conditions.every((condition) => {
    const charStatusValue = gameState.characterStatus[condition.name];
    // If the condition's value is undefined or null, consider it met
    if (charStatusValue === undefined || charStatusValue === null) {
      return true;
    }
    return charStatusValue === condition.value;
  });
};

export default areCharStatusConditionsMet;
