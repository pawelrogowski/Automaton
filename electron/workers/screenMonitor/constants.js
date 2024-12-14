export const OPTIONS = {
  globalDelay: 0,
  categoryDelays: {
    Healing: 200,
    Potion: 1000,
    Support: 500,
    Attack: 1000,
    Equip: 250,
    Others: 50,
  },
  cooldownStateMapping: {
    Healing: 'healingCdActive',
    Support: 'supportCdActive',
    Attack: 'attackCdActive',
  },
  logsEnabled: false,
};

export const PARTY_MEMBER_STATUS = {
  active: {
    sequence: [
      [192, 192, 192],
      [192, 192, 192],
    ],
    direction: 'horizontal',
  },
  activeHover: {
    sequence: [
      [247, 247, 247],
      [247, 247, 247],
    ],
    direction: 'horizontal',
  },
  inactive: {
    sequence: [
      [128, 128, 128],
      [128, 128, 128],
    ],
    direction: 'horizontal',
  },
};
