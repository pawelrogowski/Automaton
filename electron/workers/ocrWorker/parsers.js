/**
 * OCR data parsers for different regions
 * These functions parse raw OCR data into structured data
 */

/**
 * Parses skills widget OCR data into structured values
 * @param {Array} ocrData - Array of OCR text objects with x, y, text properties
 * @returns {Object} Structured skills widget data
 */
function parseSkillsWidgetData(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0) {
    return null;
  }

  const result = {
    level: null,
    experience: null,
    xpGainRate: null,
    hitPoints: null,
    mana: null,
    soulPoints: null,
    capacity: null,
    speed: null,
    food: null,
    stamina: null,
    offlineTraining: null,
    skills: {
      magic: null,
      fist: null,
      club: null,
      sword: null,
      axe: null,
      distance: null,
      shielding: null,
      fishing: null,
    },
    combat: {
      damageHealing: null,
      attack: null,
      defence: null,
      armor: null,
      mantra: null,
      mitigation: null,
    },
  };

  // Quick filter for valid data - extremely fast
  const validData = ocrData.filter((item) => item?.text && item.text.trim() && !/^[-\s]*$/.test(item.text) && item.text !== 'alue');

  if (validData.length === 0) return result;

  // Create a map for fast lookup - O(n) complexity
  const dataMap = new Map();

  // Group by approximate y-coordinate (within 5 pixels tolerance)
  const rows = new Map();
  for (const item of validData) {
    let rowKey = null;
    for (const [key] of rows) {
      if (Math.abs(item.y - key) <= 5) {
        rowKey = key;
        break;
      }
    }
    if (rowKey === null) rowKey = item.y;

    if (!rows.has(rowKey)) rows.set(rowKey, []);
    rows.get(rowKey).push(item);
  }

  // Process each row - O(m*n) where m is rows and n is items per row
  for (const row of rows.values()) {
    // Sort by x-coordinate for label-value pairing
    row.sort((a, b) => a.x - b.x);

    // Simple label-value pairing
    for (let i = 0; i < row.length - 1; i++) {
      const label = row[i].text.trim();
      const value = row[i + 1]?.text?.trim();
      if (!value) continue;

      // Fast string matching with lowercase comparison
      const lowerLabel = label.toLowerCase();

      // Use switch for O(1) lookup
      switch (lowerLabel) {
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
          result.capacity = parseInt(value) || null;
          break;
        case 'speed':
          result.speed = parseInt(value) || null;
          break;
        case 'food':
          result.food = value;
          break;
        case 'stamina':
          result.stamina = value;
          break;
        case 'offline training':
          result.offlineTraining = value;
          break;
        case 'magic':
          result.skills.magic = parseInt(value) || null;
          break;
        case 'fist':
          result.skills.fist = parseInt(value) || null;
          break;
        case 'club':
          result.skills.club = parseInt(value) || null;
          break;
        case 'sword':
          result.skills.sword = parseInt(value) || null;
          break;
        case 'axe':
          result.skills.axe = parseInt(value) || null;
          break;
        case 'distance':
          result.skills.distance = parseInt(value) || null;
          break;
        case 'shielding':
          result.skills.shielding = parseInt(value) || null;
          break;
        case 'fishing':
          result.skills.fishing = parseInt(value) || null;
          break;
        case 'damage/healing':
          result.combat.damageHealing = parseInt(value) || null;
          break;
        case 'attack':
          if (value.endsWith('V')) result.combat.attack = parseInt(value.slice(0, -1)) || null;
          break;
        case 'defence':
          if (value.endsWith('V')) result.combat.defence = parseInt(value.slice(0, -1)) || null;
          break;
        case 'armor':
          if (value.endsWith('V')) result.combat.armor = parseInt(value.slice(0, -1)) || null;
          break;
        case 'mantra':
          if (value.endsWith('V')) result.combat.mantra = parseInt(value.slice(0, -1)) || null;
          break;
        case 'mitigation':
          if (value.includes('%')) result.combat.mitigation = parseFloat(value.replace(/[+%]/g, '')) || null;
          break;
      }
    }
  }

  return result;
}

/**
 * Parses game log OCR data
 * @param {string} text - Raw OCR text from game log
 * @returns {Object} Structured game log data
 */
function parseGameLogData(text) {
  if (!text || typeof text !== 'string') return null;

  return {
    rawText: text,
    lines: text.split('\n').filter((line) => line.trim()),
    timestamp: Date.now(),
  };
}

/**
 * Parses chat box OCR data into structured messages
 * @param {Array} ocrData - Array of OCR text objects with x, y, text properties
 * @returns {Array} Array of parsed messages from newest to oldest
 */
function parseChatData(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0) {
    return [];
  }

  // Filter valid text items
  const validItems = ocrData.filter(
    (item) => item && typeof item === 'object' && item.text && typeof item.text === 'string' && item.text.trim(),
  );

  if (validItems.length === 0) return [];

  // Sort by y-coordinate (top to bottom) then x-coordinate (left to right)
  validItems.sort((a, b) => {
    if (Math.abs(a.y - b.y) <= 5) {
      return a.x - b.x; // Same line, sort left to right
    }
    return a.y - b.y; // Different lines, sort top to bottom
  });

  // Group messages by timestamp
  const messages = [];
  let currentMessage = null;

  // Regex to detect timestamps at start of text
  const timePattern = /^(\d{1,2}:\d{2}(?::\d{2})?)/;

  for (const item of validItems) {
    const text = item.text.trim();
    if (!text) continue;

    const timeMatch = text.match(timePattern);

    if (timeMatch) {
      // This is a new message starting with a timestamp
      if (currentMessage) {
        // Save the previous message
        messages.push(currentMessage);
      }

      // Start new message
      const remainingText = text.substring(timeMatch[0].length).trim();
      currentMessage = {
        time: timeMatch[1],
        text: remainingText,
        x: item.x,
        y: item.y,
      };
    } else if (currentMessage) {
      // This is continuation of the current message
      if (currentMessage.text) {
        currentMessage.text += ' ' + text;
      } else {
        currentMessage.text = text;
      }
    } else {
      // This is the first message without a timestamp
      currentMessage = {
        time: null,
        text: text,
        x: item.x,
        y: item.y,
      };
    }
  }

  // Add the last message if it exists
  if (currentMessage) {
    messages.push(currentMessage);
  }

  // Now parse each message into structured format
  const parsedMessages = [];

  for (const msg of messages) {
    if (!msg.text) continue;

    const fullText = msg.text;

    // Try to parse as player message: "PlayerName [level]: message"
    const playerMatch = fullText.match(/^([^\[]+)\[(\d+)\]:\s*(.+)$/);
    if (playerMatch) {
      parsedMessages.push({
        time: msg.time,
        sender: playerMatch[1].trim(),
        level: parseInt(playerMatch[2]),
        message: playerMatch[3].trim(),
        type: 'player',
      });
      continue;
    }

    // Try to parse as NPC message: "NPCName: message"
    const npcMatch = fullText.match(/^([^:]+):\s*(.+)$/);
    if (npcMatch) {
      const sender = npcMatch[1].trim();
      // Skip if it looks like a system message
      if (!sender.match(/^(Your|System|Server|Game|You have|You gained|You lost|You are|Welcome to|You earned)/i)) {
        parsedMessages.push({
          time: msg.time,
          sender: sender,
          level: null,
          message: npcMatch[2].trim(),
          type: 'npc',
        });
        continue;
      }
    }

    // Default to info message
    parsedMessages.push({
      time: msg.time,
      sender: null,
      level: null,
      message: fullText.trim(),
      type: 'info',
    });
  }

  // Sort by time (newest first)
  return parsedMessages.reverse();
}

// Export parsers as a map for easy access
export const ocrParsers = {
  skillsWidget: parseSkillsWidgetData,
  gameLog: parseGameLogData,
  chatboxMain: parseChatData,
  chatboxSecondary: parseChatData,
};

// Export individual functions for direct use
export { parseSkillsWidgetData, parseGameLogData, parseChatData };
