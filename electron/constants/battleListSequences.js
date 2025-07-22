const battleListSequences = {
  // Border detection sequences for battle entries
  targetBorder: {
    offset: { x: 0, y: 0 },
    direction: 'horizontal',
    sequence: [
      [255, 0, 0], // Red target indicator
    ],
  },
  attackBorder: {
    offset: { x: 1, y: 1 },
    direction: 'horizontal',
    sequence: [
      [0, 0, 0], // Black attack indicator
    ],
  },
  healthBarValidation: {
    offset: { x: 0, y: 0 },
    direction: 'horizontal',
    sequence: [
      [0, 0, 0], // Black border validation
    ],
  },
  // Legacy sequences (can be removed if not used)
  battleEntry: {
    offset: { x: 0, y: 0 },
    direction: 'vertical',
    sequence: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
  },
  partyEntry: {
    offset: { x: 0, y: 0 },
    direction: 'vertical',
    sequence: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
  },
};

export default battleListSequences;
