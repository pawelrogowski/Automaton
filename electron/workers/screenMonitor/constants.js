export const OPTIONS = {
  globalDelay: 0,
  categoryDelays: {
    Healing: 200,
    Potion: 975,
    Support: 475,
    Attack: 1975,
    Equip: 250,
    Others: 50,
  },
  cooldownStateMapping: {
    Healing: 'healingCd',
    Support: 'supportCd',
    Attack: 'attackCd',
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
  // inactive: {
  //   sequence: [
  //     [128, 128, 128],
  //     [128, 128, 128],
  //   ],
  //   direction: 'horizontal',
  // },
};
