# AGENTS.md - Automaton Project Guide

## Commands
- **Build**: `npm run build` - Production webpack build
- **Dev**: `npm run dev` - Development build with electron inspect on port 5858
- **Start**: `npm start` - Production build and run
- **Lint**: `npm run lint` - ESLint check for .js/.jsx/.mjs files
- **Package**: `npm run make` - Clean build and create Linux AppImage

## Architecture
- **Electron app** for Tibia automation with React frontend
- **electron/**: Main process - IPC handlers, screen monitoring, keyboard/mouse control, workers, save manager
- **frontend/**: React renderer with Redux store - components, pages, hooks, assets
- **nativeModules/**: C++ N-API modules - findHealthBars, findTarget, fontOcr, keypress, mouseController, minimapMatcher, pathfinder, x11RegionCapture, windowInfo
- **lua_scripts/**: Lua scripting interface via wasmoon
- **webpack.config.cjs**: Builds to dist/, separate configs for main/renderer processes

## Code Style
- **Format**: Prettier - 80 char width, single quotes, trailing commas, 2 spaces
- **Lint**: ESLint with Babel parser, Prettier + React plugins
- **Components**: Arrow functions for React components
- **Files**: .js/.jsx/.mjs for React (no .ts)
- **Imports**: ES6 modules (`import`/`export`), use file:// protocol for native modules
- **Naming**: camelCase for functions/variables, PascalCase for React components
