# Lua Script Import/Export Feature

## Overview

A complete import/export system for Lua scripts that allows you to:
- **Export individual scripts** to share or backup
- **Import individual scripts** from files
- **Export entire script packages** (all scripts at once)
- **Import script packages** to quickly set up multiple scripts

All imported scripts are **disabled by default** for safety.

---

## Features

### 1. Individual Script Export
- Export a single script to a `.lua.json` file
- Script name is used as the filename
- Exported script is disabled and logs are cleared
- Click the download icon next to any script in the table

### 2. Individual Script Import
- Import a single script from a `.lua.json` file
- Script is automatically disabled on import
- New unique ID is generated to avoid conflicts
- Logs are cleared
- Click "Import Script" button at the top

### 3. Package Export (All Scripts)
- Export all scripts (Persistent or Hotkey) to a single package file
- Includes metadata: version, script count, export timestamp
- All scripts are disabled and logs cleared
- Click "Export All" button when scripts exist

### 4. Package Import
- Import multiple scripts from a package file
- Each script gets a new unique ID
- All scripts are disabled on import
- Logs are cleared for all scripts
- Click "Import Package" button at the top

---

## User Interface

### Script Table Header

```
┌────────────────────────────────────────────────────────────────┐
│ [📤 Import Script] [📦 Import Package]    [⬇ Export All] [➕ New Script] │
└────────────────────────────────────────────────────────────────┘
```

### Script Actions Column

Each script row now has:
- **Download icon** (blue) - Export this script
- **Trash icon** (red) - Delete this script

---

## File Formats

### Individual Script Format (`.lua.json`)

```json
{
  "id": "uuid-here",
  "name": "My Script",
  "code": "-- Lua code here",
  "type": "persistent",
  "enabled": false,
  "loopMin": 1000,
  "loopMax": 5000,
  "log": []
}
```

For hotkey scripts:
```json
{
  "id": "uuid-here",
  "name": "My Hotkey Script",
  "code": "-- Lua code here",
  "type": "hotkey",
  "hotkey": "F1",
  "log": []
}
```

### Script Package Format (`.json`)

```json
{
  "version": "1.0",
  "type": "lua_script_package",
  "scriptCount": 3,
  "exportedAt": "2025-10-05T00:00:00.000Z",
  "scripts": [
    {
      "id": "uuid-1",
      "name": "Script 1",
      "code": "-- code",
      "type": "persistent",
      "enabled": false,
      "loopMin": 1000,
      "loopMax": 5000,
      "log": []
    },
    {
      "id": "uuid-2",
      "name": "Script 2",
      "code": "-- code",
      "type": "hotkey",
      "hotkey": "F2",
      "log": []
    }
  ]
}
```

---

## Usage Guide

### Exporting a Single Script

1. **Go to** Lua Scripts page
2. **Navigate** to Persistent or Hotkey tab
3. **Click** the blue download icon next to the script you want to export
4. **Choose** where to save the file
5. **Save** - Script is exported with its name as the filename

### Importing a Single Script

1. **Go to** Lua Scripts page
2. **Navigate** to Persistent or Hotkey tab (doesn't matter which)
3. **Click** "Import Script" button
4. **Select** the `.lua.json` file
5. **Script appears** in the appropriate list (Persistent or Hotkey based on type)
6. **Script is disabled** by default
7. **Enable** it when ready to use

### Exporting All Scripts (Package)

1. **Go to** Lua Scripts page
2. **Navigate** to Persistent or Hotkey tab
3. **Click** "Export All" button (appears when scripts exist)
4. **Choose** where to save the package
5. **Save** - All scripts from that tab are exported

### Importing a Script Package

1. **Go to** Lua Scripts page
2. **Navigate** to Persistent or Hotkey tab (doesn't matter which)
3. **Click** "Import Package" button
4. **Select** the package `.json` file
5. **All scripts appear** in their appropriate lists
6. **All scripts are disabled** by default
7. **Review and enable** scripts as needed

---

## Safety Features

### 1. Disabled by Default
- All imported scripts are disabled automatically
- Prevents accidental execution of untrusted code
- You must manually enable scripts after reviewing them

### 2. New IDs Generated
- Every imported script gets a new unique ID
- Prevents conflicts with existing scripts
- Allows importing the same script multiple times

### 3. Logs Cleared
- All log data is removed on export
- Imported scripts start with fresh logs
- Reduces file size

### 4. Validation
- Script structure is validated on import
- Invalid files are rejected with error message
- Prevents corrupted data from entering the system

---

## Use Cases

### 1. Backup Your Scripts
- Export all scripts before major changes
- Keep versions of working configurations
- Restore if something goes wrong

### 2. Share Scripts with Others
- Export your custom scripts
- Share via Discord, forums, etc.
- Others can import and use them

### 3. Script Libraries
- Create collections of useful scripts
- Package related scripts together
- Distribute as reusable templates

### 4. Multi-Character Setup
- Export scripts from one character
- Import to another character
- Quickly replicate configurations

### 5. Version Control
- Export scripts periodically
- Keep history of changes
- Roll back when needed

---

## File Naming Conventions

### Individual Scripts
- Format: `ScriptName.lua.json`
- Example: `HP_Monitor.lua.json`
- Invalid characters are replaced with underscores

### Script Packages
- Default: `lua_scripts_package.json`
- You can rename when saving
- Recommended: `persistent_scripts_2025-10-05.json`

---

## Technical Details

### Backend (Electron)

**File**: `electron/saveManager.js`

Functions added:
- `saveLuaScript(script, callback)` - Export single script
- `loadLuaScript(callback)` - Import single script
- `saveLuaScriptPackage(scripts, callback)` - Export package
- `loadLuaScriptPackage(callback)` - Import package

**File**: `electron/ipcListeners.js`

IPC Handlers:
- `save-lua-script` - Handle script export
- `load-lua-script` - Handle script import
- `save-lua-script-package` - Handle package export
- `load-lua-script-package` - Handle package import

### Frontend (React)

**Files Modified**:
- `frontend/components/LuaScripts/ScriptTable.jsx`
  - Added import/export buttons
  - Added download icon to Actions column
  - New props: `onExportScript`, `onImportScript`, `onExportPackage`, `onImportPackage`

- `frontend/components/LuaScripts/PersistentScriptList.jsx`
  - Added export/import handlers
  - IPC communication with backend

- `frontend/components/LuaScripts/HotkeyScriptList.jsx`
  - Added export/import handlers
  - IPC communication with backend

---

## Error Handling

### Invalid File Format
- **Message**: "❌ Invalid script file format"
- **Cause**: Missing required fields (id, type, or code)
- **Solution**: Check the JSON structure

### No Scripts to Export
- **Message**: "❌ No scripts to save"
- **Cause**: Trying to export package with no scripts
- **Solution**: Add scripts first

### Import Failed
- **Message**: "❌ Failed to load script"
- **Cause**: File read error or JSON parse error
- **Solution**: Check file integrity and permissions

### Package Format Error
- **Message**: "❌ Invalid package file format"
- **Cause**: Package doesn't contain "scripts" array
- **Solution**: Verify it's a valid package file

---

## Notifications

All operations show desktop notifications:

- **Export script**: "📥 Saved | ScriptName.lua.json"
- **Import script**: "📤 Loaded script | ScriptName"
- **Export package**: "📥 Saved | lua_scripts_package.json"
- **Import package**: "📤 Loaded 5 scripts from package"
- **Error**: "❌ Failed to [operation]"

---

## Best Practices

### 1. Regular Backups
- Export all scripts weekly
- Keep backups in a safe location
- Name files with dates for versioning

### 2. Before Importing
- Review the script code first
- Check for malicious content
- Understand what it does

### 3. Testing Imported Scripts
- Import to a test environment first
- Enable one script at a time
- Monitor for issues

### 4. Organizing Exports
- Create folders for different purposes
  - `/backups/` - Regular backups
  - `/shared/` - Scripts to share
  - `/templates/` - Reusable templates
  - `/character1/` - Character-specific configs

### 5. Documentation
- Add comments in your script code
- Use descriptive script names
- Document loop delays and hotkeys

---

## Troubleshooting

**Q: Import button does nothing**
- Check that electron IPC is available
- Open DevTools (F12) for errors
- Restart the application

**Q: Exported file has wrong name**
- Script name contains invalid characters
- They're replaced with underscores
- Rename after export if needed

**Q: Can't find imported script**
- Check the correct tab (Persistent vs Hotkey)
- Look at the script type in the JSON
- Persistent scripts go to Persistent tab
- Hotkey scripts go to Hotkey tab

**Q: Imported script doesn't work**
- Remember: scripts are disabled by default
- Enable the script manually
- Check loop delays (Min/Max)
- Review the code for errors

**Q: Package import added duplicates**
- Each import creates new scripts with new IDs
- This is intentional to prevent conflicts
- Delete unwanted duplicates manually

---

## Future Enhancements

Potential improvements:

1. **Drag-and-drop** file import
2. **Script marketplace** integration
3. **Automatic backups** on schedule
4. **Export selected scripts** (checkboxes)
5. **Script categories/tags** for organization
6. **Import conflict resolution** (merge/replace/skip)
7. **Cloud storage** integration
8. **Version history** tracking
9. **Script templates** built-in
10. **Batch operations** (enable/disable multiple)

---

## Security Considerations

⚠️ **Warning**: Only import scripts from trusted sources!

- Scripts have full access to the bot API
- Malicious code could damage your setup
- Always review code before enabling
- Test in a safe environment first

**Safe practices**:
- ✅ Import from official sources
- ✅ Import your own backups
- ✅ Import from trusted community members
- ✅ Review code before enabling
- ❌ Don't import from unknown sources
- ❌ Don't blindly enable imported scripts
- ❌ Don't run untested code on live accounts

---

## Summary

The import/export system provides a robust way to:
- 💾 **Backup** your scripts
- 🔄 **Share** with the community
- 📦 **Package** related scripts
- 🚀 **Quick setup** on new installations
- 🛡️ **Safe import** with disabled-by-default policy

All operations are user-friendly, safe, and well-tested.

**Version**: 1.4.7  
**Last Updated**: October 5, 2025
