// /home/feiron/Dokumenty/Automaton/electron/workers/ocr/parsers.js
// --- MODIFIED ---

/**
 * @file parsers.js
 * @summary The single source of truth for parsing all OCR data.
 * @description This module contains powerful parsers that transform raw OCR text
 * into the final, structured objects ready for the Redux state.
 */

function timeStringToMinutes(timeStr) {
  if (typeof timeStr !== 'string') {
    return null;
  }
  const normalizedTime = timeStr.replace('.', ':');
  const parts = normalizedTime.split(':');
  if (parts.length !== 2) return null;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function parseSkillsWidget(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0) return null;
  const result = {};
  const skills = {};
  const combat = {};
  const validData = ocrData.filter(
    (item) =>
      item.text &&
      item.text.trim() &&
      !item.text.match(/^[-\s]*$/) &&
      item.text !== 'alue',
  );
  const rows = new Map();
  validData.forEach((item) => {
    let rowKey = Array.from(rows.keys()).find(
      (key) => Math.abs(item.y - key) <= 5,
    );
    if (rowKey === undefined) rowKey = item.y;
    if (!rows.has(rowKey)) rows.set(rowKey, []);
    rows.get(rowKey).push(item);
  });
  Array.from(rows.values()).forEach((row) => {
    row.sort((a, b) => a.x - b.x);
    for (let i = 0; i < row.length - 1; i++) {
      const label = row[i].text.trim().toLowerCase();
      const value = row[i + 1]?.text?.trim();
      if (!value) continue;
      switch (label) {
        case 'level':
          result.level = parseInt(value) || null;
          break;
        case 'experience':
          result.experience = parseInt(value.replace(/,/g, '')) || null;
          break;
        case 'xp gain rate':
          result.xpGainRate = parseFloat(value.replace('%', '')) || null;
          break;
        case 'hit points':
          result.hitPoints = parseInt(value) || null;
          break;
        case 'mana':
          result.mana = parseInt(value) || null;
          break;
        case 'soul points':
          result.soulPoints = parseInt(value) || null;
          break;
        case 'capacity':
          result.capacity = parseInt(value.replace(/,/g, '')) || null;
          break;
        case 'speed':
          result.speed = parseInt(value) || null;
          break;
        case 'food':
          result.food = timeStringToMinutes(value);
          break;
        case 'stamina':
          result.stamina = timeStringToMinutes(value);
          break;
        case 'offline training':
          result.offlineTraining = value;
          break;
        case 'magic':
          skills.magic = parseInt(value) || null;
          break;
        case 'fist':
          skills.fist = parseInt(value) || null;
          break;
        case 'club':
          skills.club = parseInt(value) || null;
          break;
        case 'sword':
          skills.sword = parseInt(value) || null;
          break;
        case 'axe':
          skills.axe = parseInt(value) || null;
          break;
        case 'distance':
          skills.distance = parseInt(value) || null;
          break;
        case 'shielding':
          skills.shielding = parseInt(value) || null;
          break;
        case 'fishing':
          skills.fishing = parseInt(value) || null;
          break;
        case 'damage/healing':
          combat.damageHealing = parseInt(value) || null;
          break;
        case 'attack':
          if (value.endsWith('V'))
            combat.attack = parseInt(value.replace('V', '')) || null;
          break;
        case 'defence':
          if (value.endsWith('V'))
            combat.defence = parseInt(value.replace('V', '')) || null;
          break;
        case 'armor':
          if (value.endsWith('V'))
            combat.armor = parseInt(value.replace('V', '')) || null;
          break;
        case 'mantra':
          if (value.endsWith('V'))
            combat.mantra = parseInt(value.replace('V', '')) || null;
          break;
        case 'mitigation':
          if (value.includes('%'))
            combat.mitigation = parseFloat(value.replace(/[+%]/g, '')) || null;
          break;
      }
    }
  });
  return { ...result, skills, combat };
}

function parseChatData(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0) return [];
  return ocrData.filter((item) => item && typeof item === 'object');
}

function parseChatBoxTabRow(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0)
    return { activeTab: null, tabs: {} };
  const tabs = {};
  let activeTab = null;
  ocrData.forEach((item) => {
    const tabName = item.text.trim();
    if (!tabName) return;
    tabs[tabName] = {
      tabName,
      tabPosition: { x: item.click.x, y: item.click.y },
      originalPosition: { x: item.x, y: item.y },
    };
    if (
      item.color &&
      item.color.r === 223 &&
      item.color.g === 223 &&
      item.color.b === 223
    ) {
      activeTab = tabName;
    }
  });
  return { activeTab, tabs };
}

function parseSelectCharacterModal(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0)
    return { selectedCharacter: null, characters: {}, accountStatus: null };
  const characters = {};
  let selectedCharacter = null;
  let accountStatus = null;
  ocrData.forEach((item) => {
    const text = item.text.trim();
    if (!text) return;
    if (text.includes('Account Status:')) {
      const nextItem = ocrData.find(
        (next) => next.y > item.y && Math.abs(next.x - item.x) < 50,
      );
      if (nextItem) accountStatus = nextItem.text.trim();
      return;
    }
    if (text === 'Free Account' || text === 'Premium Account') {
      if (!accountStatus) accountStatus = text;
      return;
    }
    const characterName = text.replace(/(?!^)(?<!\s)([A-Z])/g, ' $1');
    characters[characterName] = {
      name: characterName,
      position: { x: item.click.x, y: item.click.y },
      originalPosition: { x: item.x, y: item.y },
      color: item.color,
    };
    if (
      item.color &&
      item.color.r === 244 &&
      item.color.g === 244 &&
      item.color.b === 244
    ) {
      selectedCharacter = characterName;
    }
  });
  return { selectedCharacter, characters, accountStatus };
}

function parseVipWidget(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0)
    return { online: [], offline: [] };
  const online = [];
  const offline = [];
  ocrData.forEach((item) => {
    if (!item?.text) return;
    const isOnline =
      item.color &&
      item.color.r === 96 &&
      item.color.g === 248 &&
      item.color.b === 96;
    if (isOnline) online.push(item.text);
    else offline.push(item.text);
  });
  online.sort((a, b) => a.localeCompare(b));
  offline.sort((a, b) => a.localeCompare(b));
  return { online, offline };
}

function parseGameWorldOcr(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0) return [];
  return ocrData.filter((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      !item.text ||
      typeof item.text !== 'string'
    ) {
      return false;
    }
    const text = item.text.trim();
    // Exclude entries that start with lowercase letters
    if (
      text.length > 0 &&
      text[0] === text[0].toLowerCase() &&
      text[0].match(/[a-z]/i)
    ) {
      return false;
    }
    // Exclude entries that length is shorter than 3 letters
    if (text.length < 3) {
      return false;
    }
    return true;
  });
}

function parsePreyBalance(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0) {
    return null;
  }
  // Concatenate all text, remove spaces and non-digits, then parse
  const fullText = ocrData
    .map((item) => item?.text?.trim() || '')
    .join(' ') // Join all text items
    .replace(/[^0-9]/g, ''); // Remove everything except digits (including spaces, commas, etc.)
  if (!fullText) {
    return null;
  }
  const balance = parseInt(fullText, 10);

  return isNaN(balance) ? null : balance;
}

function parseMarketSellToList(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0) {
    return { offers: [] };
  }
  const offers = [];
  ocrData.forEach((item) => {
    if (!item?.text) return;
    const characterName = item.text.trim();
    if (characterName) {
      offers.push({
        characterName,
        position: { x: item.click.x, y: item.click.y },
        originalPosition: { x: item.x, y: item.y },
      });
    }
  });
  return { offers };
}

function parseNpcTalkModalTradeSectionItemList(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0) {
    return { items: [] };
  }
  const items = [];
  ocrData.forEach((item) => {
    if (!item?.text) return;
    const itemName = item.text.trim();
    if (itemName) {
      items.push({
        name: itemName,
        position: { x: item.click.x, y: item.click.y },
        originalPosition: { x: item.x, y: item.y },
      });
    }
  });
  return { items };
}

function parseNpcTalkModalSearchInput(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0) {
    return { text: '' };
  }
  const fullText = ocrData
    .map((item) => item?.text?.trim() || '')
    .join(' ')
    .trim();
  return { text: fullText };
}

function parseNpcTalkModalAmountInput(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0) {
    return { amount: '' };
  }
  const fullText = ocrData
    .map((item) => item?.text?.trim() || '')
    .join('')
    .replace(/[^0-9]/g, '');
  const amount = parseInt(fullText, 10);
  return { amount: isNaN(amount) ? '' : amount.toString() };
}


export const regionParsers = {
  skillsWidget: parseSkillsWidget,
  chatboxMain: parseChatData,
  chatboxSecondary: parseChatData,
  chatBoxTabRow: parseChatBoxTabRow,
  selectCharacterModal: parseSelectCharacterModal,
  vipWidget: parseVipWidget,
  gameWorld: parseGameWorldOcr,
  preyBalance: parsePreyBalance,
  marketSellToList: parseMarketSellToList,
  npcTalkModalTradeSectionItemList: parseNpcTalkModalTradeSectionItemList,
  npcTalkModalSearchInput: parseNpcTalkModalSearchInput,
  npcTalkModalAmountInput: parseNpcTalkModalAmountInput,
};
