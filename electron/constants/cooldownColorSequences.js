const cooldownColorSequences = {
  attack: {
    direction: 'vertical',
    sequence: [
      [0, 0, 6],
      [70, 13, 1],
      [171, 42, 9],
      [255, 255, 255],
    ],
  },
  healing: {
    direction: 'vertical',
    sequence: [
      [1, 37, 102],
      [77, 111, 158],
      [39, 75, 116],
      [255, 255, 255],
    ],
  },
  support: {
    direction: 'vertical',
    sequence: [
      [0, 61, 52],
      [0, 109, 99],
      [52, 179, 172],
      [255, 255, 255],
    ],
  },
  attackInactive: {
    direction: 'vertical',
    sequence: [
      [71, 13, 2],
      [53, 10, 3],
      [0, 0, 0],
    ],
  },
  healingInactive: {
    direction: 'vertical',
    sequence: [
      [17, 29, 45],
      [6, 16, 30],
      [0, 0, 0],
    ],
  },
  supportInactive: {
    direction: 'vertical',
    sequence: [
      [42, 74, 73],
      [28, 50, 48],
      [0, 0, 0],
    ],
  },
};

export default cooldownColorSequences;
