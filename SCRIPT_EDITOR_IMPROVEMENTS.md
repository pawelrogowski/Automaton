# Script Editor Improvements - IDE-like Experience

## Overview

The Lua Script Editor has been completely redesigned into a professional IDE-like experience with modern features and improved usability.

## New Features

### 1. **Full-Screen Layout (95vw x 95vh)**
- Editor now takes up 95% of viewport width and height
- Maximizes screen real estate for coding
- Better visibility and working space

### 2. **Sidebar with Script List**
- **Left sidebar** displaying all scripts (both Persistent and Hotkey)
- Scripts organized by type with visual categories
- Each script shows:
  - Script icon
  - Script name
  - "ON" badge for enabled persistent scripts
  - Active script highlighted with blue accent
- **Collapsible sidebar** - click the chevron to hide/show
- **Quick script switching** - click any script in the list (auto-saves current before switching)

### 3. **Resizable Log Panel**
- **Drag the resize handle** between editor and log panel to adjust sizes
- Min height: 100px, Max height: 70vh
- **Collapsible** - click chevron to hide/expand output panel
- **Auto-scroll** - logs automatically scroll to bottom
- **Selectable text** - you can select and copy log content
- **Log count badge** - shows number of log entries
- **Better scrollbars** - custom styled, more visible

### 4. **Input Validation for Loop Values**
- **Real-time validation** for loopMin and loopMax
- Error checking:
  - Values must be numbers
  - Values must be positive (≥ 0)
  - Min cannot be greater than Max
- **Visual feedback**:
  - Input fields turn red when invalid
  - Error message displayed next to inputs
  - Animated shake effect on error
- **Save protection** - prevents saving with invalid values

### 5. **Enhanced Code Editor**
- **Full CodeMirror features enabled**:
  - Line numbers
  - Syntax highlighting
  - Bracket matching
  - Auto-completion
  - Code folding
  - Multiple selections
  - Search/replace
  - History (undo/redo)
  - Active line highlighting
  - Selection highlighting
- **Better visibility** - darker background for better contrast
- **Full scrolling** support for large scripts

### 6. **Improved Header Bar**
- **Redesigned layout**:
  - File icon for visual identity
  - Script name input (larger, more prominent)
  - Loop settings inline with validation
  - Action buttons on the right
- **Icon buttons** with tooltips:
  - **Save** (blue) - also works with Ctrl+S / Cmd+S
  - **Delete** (red on hover)
  - **Close** - also works with Esc key

### 7. **Keyboard Shortcuts**
- **Ctrl+S / Cmd+S** - Save script
- **Esc** - Close editor
- All standard CodeMirror shortcuts available

### 8. **Better Visual Design**
- **Modern dark theme** - consistent with app design
- **Smooth transitions** - for collapsing/expanding panels
- **Hover effects** - on all interactive elements
- **Professional styling** - looks like VS Code / JetBrains IDEs
- **Better spacing** - more breathing room, less cluttered
- **Custom scrollbars** - styled to match theme

## User Experience Improvements

### Before vs After

**Before:**
- Editor was 80vw x 90vh (smaller)
- No script list - had to close and reopen for each script
- Fixed-size log panel (200px) - couldn't adjust
- Log text wasn't selectable
- No validation for loop values - could save invalid data
- Basic CodeMirror setup - fewer features
- Generic buttons - less intuitive

**After:**
- Editor is 95vw x 95vh (maximum space)
- Script list in sidebar - switch scripts instantly
- Resizable log panel - drag to preferred size
- Log text is fully selectable and copyable
- Real-time validation with visual feedback
- Full-featured code editor with all modern IDE features
- Icon buttons with clear visual hierarchy

## Technical Details

### Files Modified
- `frontend/components/ScriptEditorModal/ScriptEditorModal.jsx`

### New Dependencies
- Uses existing `react-feather` icons (no new packages)

### New State Variables
```javascript
const [validationError, setValidationError] = useState(''); // Validation messages
const [sidebarCollapsed, setSidebarCollapsed] = useState(false); // Sidebar toggle
const [logPanelHeight, setLogPanelHeight] = useState(250); // Resizable log height
const [isResizing, setIsResizing] = useState(false); // Drag state
const [logCollapsed, setLogCollapsed] = useState(false); // Log panel toggle
```

### New Styled Components
- `Sidebar` - Left panel for script list
- `SidebarHeader` - Header with title and collapse button
- `SidebarContent` - Scrollable script list container
- `ScriptListItem` - Individual script in the list
- `MainEditorArea` - Right panel containing editor and logs
- `ResizeHandle` - Draggable divider between editor and logs
- `LogPanel` - Resizable log container
- `LogHeader` - Log panel header with count
- `LogContent` - Scrollable log display
- `IconButton` - Reusable button with icon
- `HeaderLeft/HeaderRight` - Header layout containers
- `ValidationError` - Animated error message display
- `ContentArea` - Main layout container

### Validation Logic
```javascript
const validateLoopValues = (min, max) => {
  const minVal = Number(min);
  const maxVal = Number(max);
  
  if (isNaN(minVal) || isNaN(maxVal)) {
    setValidationError('Values must be numbers');
    return false;
  }
  
  if (minVal < 0 || maxVal < 0) {
    setValidationError('Values must be positive');
    return false;
  }
  
  if (minVal > maxVal) {
    setValidationError('Min delay cannot be greater than max delay');
    return false;
  }
  
  setValidationError('');
  return true;
};
```

### Resize Logic
```javascript
// Mouse down on resize handle
const handleResizeStart = (e) => {
  setIsResizing(true);
  resizeStartY.current = e.clientY;
  resizeStartHeight.current = logPanelHeight;
};

// Mouse move while resizing
const handleResizeMove = (e) => {
  if (!isResizing) return;
  const delta = resizeStartY.current - e.clientY;
  const newHeight = Math.max(100, Math.min(
    resizeStartHeight.current + delta, 
    window.innerHeight * 0.7
  ));
  setLogPanelHeight(newHeight);
};

// Mouse up - stop resizing
const handleResizeEnd = () => {
  setIsResizing(false);
};
```

## Usage Guide

### Opening the Editor
- Double-click on any script code cell in the table
- Click the script name to open the editor

### Working with Scripts
1. **View all scripts** - Check the sidebar on the left
2. **Switch scripts** - Click any script in the sidebar (auto-saves current)
3. **Edit code** - Use the main editor area with full IDE features
4. **Adjust log size** - Drag the resize handle up/down
5. **Hide logs** - Click the chevron in the log header
6. **View logs** - Click the collapsed output bar at the bottom
7. **Copy logs** - Select text in the log panel and copy
8. **Save changes** - Click Save button or press Ctrl+S
9. **Close editor** - Click X button or press Esc

### Loop Delay Settings (Persistent Scripts Only)
1. Enter values for Min and Max delay in milliseconds
2. Watch for real-time validation
3. Red border = invalid values
4. Error message shows what's wrong
5. Fix errors before saving

### Keyboard Shortcuts
- **Ctrl+S** (or Cmd+S on Mac) - Save and close
- **Esc** - Close without saving pending changes
- **Ctrl+F** - Find in code
- **Ctrl+H** - Find and replace
- **Ctrl+Z** - Undo
- **Ctrl+Shift+Z** - Redo

## Performance Considerations

- **Lazy rendering** - Sidebar only renders visible scripts
- **Memoized handlers** - All callbacks use `useCallback`
- **Efficient updates** - Only subscribes to log changes, not entire script object
- **Smooth animations** - CSS transitions for UI changes
- **Optimized scrolling** - Custom scrollbar styling doesn't impact performance

## Future Enhancements

Potential improvements for future versions:

1. **Search in sidebar** - Filter scripts by name
2. **Drag-and-drop** - Reorder scripts in sidebar
3. **Multiple tabs** - Open multiple scripts simultaneously
4. **Split view** - Edit two scripts side-by-side
5. **Autocomplete** - Context-aware suggestions for bot API
6. **Error highlighting** - Show Lua syntax errors inline
7. **Minimap** - Code overview like VS Code
8. **Themes** - Multiple color schemes
9. **Font size control** - Zoom in/out
10. **Line wrapping toggle** - Option for long lines

## Notes

- The editor maintains backward compatibility with existing scripts
- All previous functionality is preserved
- No database schema changes required
- Works with both Persistent and Hotkey scripts
- Validation only applies to Persistent scripts (which have loop delays)
- Auto-save on script switch prevents data loss
- Log panel state (collapsed/expanded, size) resets on editor open
