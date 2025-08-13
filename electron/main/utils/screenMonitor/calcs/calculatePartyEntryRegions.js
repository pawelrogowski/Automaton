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
        width: 15,
        height: 6,
      },
      uhCoordinates: {
        x: partyListStart.x,
        y: partyListStart.y + i * 26,
      },
    });
  }
  return regions;
};
