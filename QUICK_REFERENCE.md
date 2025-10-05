# Lua Script Editor - Quick Reference Card

## 🚀 Opening the Editor
- Double-click any script's **Code** cell in the table
- Or double-click the script **Name**

## ⌨️ Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| **Ctrl+S** (Cmd+S on Mac) | Save and close |
| **Esc** | Close editor |
| **Ctrl+F** | Find in code |
| **Ctrl+H** | Find and replace |
| **Ctrl+Z** | Undo |
| **Ctrl+Shift+Z** | Redo |

## 📁 Sidebar (Left Panel)
- **View all scripts** - Both Persistent and Hotkey
- **Switch scripts** - Click any script (auto-saves current)
- **See status** - Green "ON" badge for enabled scripts
- **Collapse/Expand** - Click chevron button at top

## 📝 Code Editor (Main Area)
- Full syntax highlighting for Lua
- Line numbers
- Bracket matching
- Auto-completion
- Code folding (click arrows next to line numbers)
- Multiple cursors (Ctrl+Click)
- Find/Replace (Ctrl+F / Ctrl+H)

## 📊 Log Panel (Bottom)
- **Resize** - Drag the handle up/down
- **Collapse** - Click chevron to hide (more coding space)
- **Expand** - Click collapsed bar to show again
- **Select text** - Click and drag to select logs
- **Copy** - Right-click → Copy or Ctrl+C
- **Auto-scroll** - Automatically scrolls to newest logs
- **Log count** - Badge shows number of entries

## ⚙️ Settings (Persistent Scripts Only)
- **Min Delay** - Minimum milliseconds between loops
- **Max Delay** - Maximum milliseconds between loops
- Validation ensures:
  - ✓ Values are numbers
  - ✓ Values are positive
  - ✓ Min ≤ Max

## 💾 Saving
- Click **Save** button (blue)
- Or press **Ctrl+S** / **Cmd+S**
- Validation runs automatically
- Red borders = fix errors before saving

## 🗑️ Deleting
- Click **Delete** button (trash icon)
- Confirmation dialog appears
- Script removed permanently

## ✕ Closing
- Click **X** button
- Or press **Esc**
- Unsaved changes are lost (save first!)

## 🎨 UI Elements

### Header Bar
```
[📄 Icon] [Script Name______] [Min: 1000] [Max: 5000] ms  [💾 Save] [🗑️ Delete] [✕]
```

### Sidebar Script Item
```
📝 Script Name [ON]  ← Active script (blue highlight)
📝 Script Name       ← Inactive script
```

### Log Panel
```
═══ RESIZE HANDLE (drag me) ═══
📊 Output [15] ▼               ← 15 log entries, click ▼ to collapse
[12:34:56.789] Log message     ← Selectable text
```

## 💡 Pro Tips

1. **Quick Script Switching**
   - Keep editor open, click scripts in sidebar
   - No need to close and reopen

2. **More Coding Space**
   - Collapse sidebar (if you don't need script list)
   - Collapse logs (if you don't need to see output)
   - Both collapsed = maximum editor space

3. **Resize Log Panel**
   - Small: See just a few recent logs
   - Large: See full log history
   - Drag to your preference

4. **Copy Logs**
   - Select text you need
   - Copy with Ctrl+C
   - Paste into bug reports or documentation

5. **Validation Errors**
   - Red borders show invalid inputs
   - Error message tells you what's wrong
   - Fix before saving

6. **Search in Code**
   - Ctrl+F to find text
   - Ctrl+H to find and replace
   - Great for renaming variables

## 🐛 Troubleshooting

**Editor won't open?**
- Check console for errors (F12)
- Try refreshing the page

**Can't save (validation error)?**
- Check loop delay values
- Min must be ≤ Max
- Both must be positive numbers

**Log panel too small/large?**
- Drag the resize handle
- Or collapse and re-expand

**Sidebar disappeared?**
- It's collapsed - click the chevron to expand
- Look for ▶ symbol

**Can't select log text?**
- Make sure you're clicking in the log content area
- Try clicking lower in the log panel

## 📖 More Information

See full documentation:
- **SCRIPT_EDITOR_IMPROVEMENTS.md** - Complete feature guide
- **PERFORMANCE_IMPROVEMENTS.md** - Performance details
- **EDITOR_LAYOUT.txt** - Visual layout diagram
- **CHANGES_SUMMARY.md** - All changes made

---

**Version**: 1.4.7  
**Last Updated**: October 4, 2025
