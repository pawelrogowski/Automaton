const statusBarSequences = {
  inRestingArea: {
    direction: 'horizontal',
    sequence: [
      [101, 157, 101],
      [120, 34, 34],
      [26, 45, 27],
    ],
  },
  inProtectedZone: {
    direction: 'horizontal',
    sequence: [
      [172, 201, 246],
      [29, 77, 155],
      [118, 165, 242],
    ],
  },
  hungry: {
    direction: 'horizontal',
    sequence: [
      [246, 212, 143],
      [246, 212, 143],
      [239, 180, 63],
    ],
  },
  poisoned: {
    direction: 'horizontal',
    sequence: [
      [52, 118, 62],
      [54, 168, 70],
      [52, 118, 62],
    ],
  },
  hasted: {
    direction: 'horizontal',
    sequence: [
      [176, 139, 80],
      [72, 57, 33],
      [249, 249, 248],
    ],
  },
  battleSign: {
    direction: 'horizontal',
    sequence: [
      [182, 122, 85],
      [143, 100, 78],
      [229, 154, 108],
    ],
  },
  burning: {
    direction: 'horizontal',
    sequence: [
      [174, 16, 13],
      [253, 139, 0],
      [218, 32, 4],
      [174, 16, 13],
    ],
  },
  magicShield: {
    direction: 'horizontal',
    sequence: [
      [211, 198, 27],
      [86, 97, 91],
      [154, 26, 55],
    ],
  },
  strengthened: {
    direction: 'horizontal',
    sequence: [
      [37, 170, 21],
      [32, 56, 30],
      [243, 153, 32],
    ],
  },
  cursed: {
    direction: 'horizontal',
    sequence: [
      [9, 9, 9],
      [164, 164, 164],
      [210, 210, 210],
    ],
  },
  electrified: {
    direction: 'horizontal',
    sequence: [
      [67, 21, 70],
      [241, 173, 245],
      [67, 21, 70],
    ],
  },
  paralyzed: {
    direction: 'horizontal',
    sequence: [
      [120, 24, 24],
      [213, 8, 8],
      [243, 2, 2],
    ],
  },
  drowning: {
    direction: 'horizontal',
    sequence: [
      [75, 206, 222],
      [208, 220, 224],
      [48, 142, 170],
    ],
  },
  bleeding: {
    direction: 'horizontal',
    sequence: [
      [54, 28, 32],
      [128, 42, 50],
      [54, 28, 32],
    ],
  },
  freezing: {
    direction: 'horizontal',
    sequence: [
      [128, 255, 255],
      [190, 252, 252],
      [128, 255, 255],
    ],
  },
};

export default statusBarSequences;
