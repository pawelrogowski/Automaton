export const calculatePartyEntryRegions = (partyListStart, entryCount) => {
  const regions = [];
  for (let i = 0; i < entryCount; i++) {
    regions.push({
      bar: {
        x: partyListStart.x + 1,
        y: partyListStart.y + 6 + i * 26,
        width: 130,
        height: 1,
      },
      name: {
        x: partyListStart.x + 1,
        y: partyListStart.y + i * 26,
        width: 6,
        height: 5,
      },
      uhCoordinates: {
        x: partyListStart.x,
        y: partyListStart.y + i * 26,
      },
    });
  }
  return regions;
};
