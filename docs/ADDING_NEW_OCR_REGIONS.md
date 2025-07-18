# Adding New OCR Regions - Complete Guide

This document provides a step-by-step guide for adding new OCR regions to the system, including data formats, parsing strategies, and state management.

## Overview

The OCR system consists of several components working together:

1. **OCR Worker** (`electron/workers/ocrWorker.js`) - Captures screen regions and sends raw OCR data
2. **Parsers** (`electron/workers/ocrWorker/parsers.js`) - Transforms raw OCR data into structured data
3. **Redux Store** (`frontend/redux/slices/uiValuesSlice.js`) - Manages application state
4. **UI Components** - Display the parsed data

## Data Flow Architecture

```
Screen → OCR Worker → Raw OCR Data → Parser → Structured Data → Redux Store → UI
```

### Raw OCR Data Format

The OCR module returns an array of objects with this structure:

```javascript
[
  {
    x: 187, // X coordinate on screen
    y: 946, // Y coordinate on screen
    text: '19:49 Your message here', // Recognized text
    click: {
      // Click coordinates (optional)
      x: 492,
      y: 950,
    },
  },
  // ... more objects
];
```

## Step-by-Step Guide

### 1. Define the Region

Add your new region to the `regions` object in the region configuration. The region will be automatically detected by the region monitor.

### 2. Create a Parser Function

Create a new parser function in `electron/workers/ocrWorker/parsers.js`:

```javascript
/**
 * Parses your new region's OCR data
 * @param {Array} ocrData - Array of OCR text objects
 * @returns {Object} Structured data for your region
 */
function parseYourRegion(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0) {
    return null; // or appropriate default
  }

  // Filter valid items
  const validItems = ocrData.filter((item) => item && item.text && item.text.trim());

  // Sort items (usually by y then x coordinate)
  validItems.sort((a, b) => {
    if (Math.abs(a.y - b.y) <= 5) return a.x - b.x;
    return a.y - b.y;
  });

  // Your parsing logic here
  const result = {
    // Your structured data
  };

  return result;
}
```

### 3. Register the Parser

Add your parser to the `ocrParsers` export object:

```javascript
export const ocrParsers = {
  skillsWidget: parseSkillsWidgetData,
  gameLog: parseGameLogData,
  chatboxMain: parseChatData,
  chatboxSecondary: parseChatData,
  yourNewRegion: parseYourRegion, // Add here
};
```

### 4. Update Redux State

#### 4.1 Add State Structure

Add your region to the initial state in `uiValuesSlice.js`:

```javascript
const initialState = {
  skillsWidget: { ... },
  chatboxMain: { ... },
  chatboxSecondary: { ... },
  yourNewRegion: {
    // Your initial state structure
    data: null,
    lastUpdate: null,
    // Add any other fields you need
  },
};
```

#### 4.2 Add Handler in updateRegionData

Add your region handler in the `updateRegionData` reducer:

```javascript
updateRegionData: (state, action) => {
  const { region, data } = action.payload;
  if (region === 'skillsWidget') {
    state.skillsWidget = parseSkillsWidgetData(data);
  } else if (region === 'chatboxMain') {
    state.chatboxMain.messages = parseChatData(data);
    state.chatboxMain.lastUpdate = Date.now();
  } else if (region === 'yourNewRegion') {
    state.yourNewRegion.data = parseYourRegion(data);
    state.yourNewRegion.lastUpdate = Date.now();
  }
  // ... other regions
},
```

#### 4.3 Add Selectors

Add selectors for your new region:

```javascript
export const selectYourNewRegion = (state) => state.uiValues.yourNewRegion;
export const selectYourNewRegionData = (state) => state.uiValues.yourNewRegion.data;
```

### 5. Update OCR Worker (if needed)

The OCR worker automatically processes all regions defined in `regions`, so no changes are needed unless you need special handling.

## Parser Patterns by Data Type

### 1. Key-Value Pairs (like skillsWidget)

Use when data appears as label-value pairs:

- Group by y-coordinate to form rows
- Sort by x-coordinate within rows
- Match labels to extract values

### 2. Text Messages (like chatbox)

Use when data is free-form text:

- Detect boundaries (timestamps, newlines, etc.)
- Group related text fragments
- Parse structured information from text

### 3. Grid/Table Data

Use when data appears in a grid:

- Calculate row/column positions
- Map coordinates to logical positions
- Extract data based on grid structure

### 4. Single Value Regions

Use when region contains a single value:

- Extract text from the region
- Parse and validate the value
- Return simple structure

## Common Patterns

### Timestamp Detection

```javascript
const timePattern = /^(\d{1,2}:\d{2}(?::\d{2})?)/;
```

### Number Extraction

```javascript
const number = parseInt(text.replace(/,/g, '')) || null;
const percentage = parseFloat(text.replace('%', '')) || null;
```

### Text Cleaning

```javascript
const cleanText = text.trim().replace(/\s+/g, ' ');
```

## Error Handling

Always include:

1. **Input validation**: Check for null/empty arrays
2. **Type checking**: Ensure data types are correct
3. **Graceful degradation**: Return sensible defaults
4. **Logging**: Log errors but don't crash the app

## Testing Strategy

1. **Unit tests**: Test parser functions with sample OCR data
2. **Integration tests**: Test full data flow
3. **Edge cases**: Empty regions, malformed text, etc.
4. **Performance**: Ensure parsers are efficient

## Example: Adding a Health Bar Region

### 1. Parser Function

```javascript
function parseHealthBar(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0) {
    return { current: null, max: null, percentage: null };
  }

  const validItems = ocrData.filter((item) => item?.text?.trim());
  if (validItems.length === 0) return { current: null, max: null, percentage: null };

  // Look for patterns like "1250/1500" or "1250 (83%)"
  const text = validItems.map((item) => item.text).join(' ');

  const healthMatch = text.match(/(\d+)\/(\d+)/);
  if (healthMatch) {
    const current = parseInt(healthMatch[1]);
    const max = parseInt(healthMatch[2]);
    return {
      current,
      max,
      percentage: Math.round((current / max) * 100),
    };
  }

  return { current: null, max: null, percentage: null };
}
```

### 2. State Structure

```javascript
healthBar: {
  current: null,
  max: null,
  percentage: null,
  lastUpdate: null,
}
```

### 3. Handler

```javascript
} else if (region === 'healthBar') {
  state.healthBar = parseHealthBar(data);
  state.healthBar.lastUpdate = Date.now();
}
```

## Troubleshooting

### Common Issues

1. **Empty results**: Check OCR data filtering
2. **Wrong order**: Verify sorting logic
3. **Parsing failures**: Add debug logging temporarily
4. **State not updating**: Check Redux action dispatch

### Debug Tools

Use these temporarily for debugging:

```javascript
console.log('Raw OCR:', ocrData);
console.log('Valid items:', validItems);
console.log('Parsed result:', result);
```

## Performance Tips

1. **Filter early**: Remove invalid items ASAP
2. **Use efficient sorting**: Leverage built-in sort
3. **Avoid regex when possible**: Use string methods for simple cases
4. **Cache results**: Store intermediate results if reused

## Next Steps

1. Define your region's purpose and data structure
2. Create sample OCR data for testing
3. Implement the parser function
4. Add state management
5. Test thoroughly
6. Remove debug logging
7. Document any special considerations
