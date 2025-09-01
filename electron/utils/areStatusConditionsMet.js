/**
 * Check if character status conditions are met.
 * @param {Object} rule - The rule object.
 * @param {Object} gameState - The game state object.
 * @returns {boolean} - True if all conditions are met, false otherwise.
 */
const areCharStatusConditionsMet = (rule, gameState) => {
  // If there are no conditions, the check passes.
  if (!rule.conditions || rule.conditions.length === 0) {
    return true;
  }

  // Check each condition in the rule's conditions array.
  return rule.conditions.every((condition) => {
    // Treat a missing status as false. This is the key fix.
    const charStatusValue = gameState.characterStatus[condition.name] ?? false;
    return charStatusValue === condition.value;
  });
};

export default areCharStatusConditionsMet;
