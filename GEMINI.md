# Gemini Project Context: Tibia Automation Bot

## Project Overview

This project is a sophisticated automation tool (a "bot") for the MMORPG Tibia. It's built as a desktop application using Electron, with a React/Redux frontend for the user interface.

The core logic is implemented in Node.js and leverages high-performance C++ native modules for tasks that require low-level access to the operating system and high performance. These tasks include screen capture, input (mouse and keyboard) simulation, and image analysis (e.g., finding health bars, recognizing text with OCR).

The application is designed to be modular and performant, using a multi-threaded architecture with worker threads for different automation tasks like "cavebot" (automated navigation), "targeting", and "healing".

A key architectural feature is the use of a **Unified SharedArrayBuffer (SAB)**. This allows for zero-copy data sharing between the main process and the worker threads, which is crucial for performance in a real-time application like this. The SAB serves as the "source of truth" for the application's state, while the Redux store is used primarily for the UI and is synchronized with the SAB.

The project also places a strong emphasis on **human-like behavior** to avoid detection by the game's anti-cheat systems. This is evident in features like randomized mouse movements and intelligent, context-aware targeting logic.

## Key Technologies

*   **Application Framework:** Electron
*   **Frontend:** React, Redux
*   **Backend:** Node.js
*   **Build Tool:** Webpack
*   **Native Modules:** C++ (via Node-API) for performance-critical tasks.
*   **Scripting:** `wasmoon` for integrating Lua scripts.

## Building and Running

### Development

To run the application in development mode with live-reloading and debugging tools:

```bash
npm run dev
```

This will start the Webpack development server and launch the Electron application with the Chrome DevTools inspector attached.

### Production Build

To create a distributable package for Linux (AppImage):

```bash
npm run make
```

This command will:
1.  Clean the `dist` directory.
2.  Run any pre-build scripts.
3.  Build the frontend and backend code using Webpack in production mode.
4.  Package the application into an AppImage using `electron-builder`.

### Linting

To check the code for style and potential errors:

```bash
npm run lint
```

### Rebuilding Native Modules

If you make changes to the C++ native modules, you'll need to rebuild them:

```bash
npm run rebuild
```

## Development Conventions

*   **State Management:** The application uses a "Unified SAB" as the primary source of truth for application state. The Redux store is used for the UI and is kept in sync with the SAB. Workers should read from the SAB, not from Redux.
*   **Modularity:** The core logic is separated into worker threads for different tasks (e.g., `targetingWorker.js`, `cavebotWorker.js`).
*   **Performance:** Performance is a critical concern. Use native modules for heavy computations and leverage the SAB for efficient data sharing.
*   **Human-like Behavior:** When adding new features, consider how to make them appear more human-like to avoid detection. This includes adding randomness and context-aware decision-making.
*   **Code Style:** The project uses ESLint for code linting. Follow the existing code style and run `npm run lint` to check your changes.
