const options = {
  globalDelay: 0,
  categoryDelays: {
    Healing: 200,
    Potion: 1000,
    Support: 500,
    Attack: 1000,
    Equip: 250,
    Others: 25,
  },
  cooldownStateMapping: {
    Healing: 'healingCdActive',
    Support: 'supportCdActive',
    Attack: 'attackCdActive',
  },
  logsEnabled: false,
};

export default options;
