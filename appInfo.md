# Electron Application Overview

This document provides a comprehensive overview of the Electron application, detailing its architecture, technologies, communication channels, and optimizations.

## 1. High-Level Architecture

The application is built using Electron, a framework for creating native applications with web technologies like JavaScript, HTML, and CSS. It consists of a main process and multiple worker threads, which communicate with each other to perform various tasks.

- **Main Process**: The entry point of the application, responsible for creating and managing windows, handling application-level events, and coordinating the workers. It initializes the `workerManager` to handle all worker threads and ensures a graceful shutdown by stopping all workers before the application quits.
- **Renderer Process**: The user interface of the application, built with React and Redux. It communicates with the main process via IPC to access native resources and trigger backend tasks.
- **Workers**: Separate threads that perform computationally intensive tasks, such as screen capture, image processing, and automation logic, without blocking the main process. The `workerManager` is responsible for the lifecycle of these workers.
- **Native Modules**: The application uses native modules like `windowinfo-native` to interact with the operating system, for example, to get a list of open windows.

## 2. Technologies Used

- **Electron**: Core framework for building the cross-platform desktop application.
- **React**: A JavaScript library for building user interfaces.
- **Redux**: A predictable state container for JavaScript apps, used for managing the application's state.
- **Node.js**: Used for the backend logic in the main process and workers.
- **Native Modules**: C++ addons for performance-critical tasks, such as screen capture and input simulation.

## 3. Communication Channels

- **IPC (Inter-Process Communication)**: The primary communication channel between the main process and the renderer process. The `ipcMain` and `ipcRenderer` modules are used to send and receive messages.
- **SharedArrayBuffer**: A memory-efficient way to share data between the main process and workers, reducing the overhead of data serialization. The `workerManager` creates several `SharedArrayBuffer`s for different types of data, such as screen captures, player position, and battle list information.
- **Redux Store**: The central state management solution, used to synchronize state across different parts of the application. The `workerManager` listens for store updates and broadcasts them to the relevant workers.
- **Message Passing**: Workers communicate with the main process and each other by sending messages. The `workerManager` has a centralized message handler (`handleWorkerMessage`) that routes messages to the appropriate destination.

## 4. Optimizations

- **Worker Threads**: Offloading heavy tasks to worker threads to keep the main process responsive.
- **Shared Memory**: Using `SharedArrayBuffer` to efficiently share data between processes and threads. This is particularly useful for sharing large data structures like screen captures without the overhead of serialization.
- **State Batching**: The `setGlobalState.js` file uses a batching mechanism to send state updates to the renderer process. Instead of sending an IPC message for every state change, it queues up the actions and sends them in a single batch. This is a significant performance optimization that reduces the overhead of inter-process communication.
- **Debouncing**: The `workerManager` uses debouncing for store updates to prevent performance issues from frequent state changes. This ensures that workers are not overwhelmed with too many updates in a short period.
- **Selective State Updates**: The `workerManager` intelligently sends state updates only to the workers that need them, based on a dependency map (`WORKER_STATE_DEPENDENCIES`). This reduces unnecessary data transfer and processing.
- **Efficient Frame Update Distribution**: Frame updates from the `captureWorker` are distributed only to workers that are interested in the changed screen regions, which is determined by checking for intersections between dirty rectangles and worker-specific regions of interest.

## 5. Main Process Overview

The main process is the backbone of the application, responsible for the following:

- **Application Lifecycle**: Managing the application's lifecycle events, such as startup, shutdown, and window management. The `app.whenReady()` function serves as the entry point.
- **Window Management**: Creating and managing the `selectWindow`, `mainWindow`, and `widgetWindow`. The `selectWindow` is shown first to allow the user to select a game window. The `createMainWindow.js` file is the central place for all window-related logic. It handles the creation of `BrowserWindow` instances, the system tray icon, and the application menu. It also manages window visibility and state.
- **UI/UX**: The application provides a rich user experience with features like a system tray icon for quick access, a context menu for controlling the bot, and a separate widget window for real-time controls. The main window is where the user can configure the bot's settings. The application menu is dynamically built and updated based on the application's state.
- **Worker Management**: Initializing the `workerManager` which is responsible for handling all the worker threads. It ensures a graceful shutdown by calling `workerManager.stopAllWorkers()` before the application quits. The `workerManager` is a sophisticated module that handles the entire lifecycle of workers, including starting, stopping, and restarting them. It also manages communication between workers and synchronizes their state with the main Redux store.
- **State Management**: Hosting the main Redux store and using `setGlobalState` to manage the application's state. It subscribes to the store to send updates to the widget window. The `workerManager` also subscribes to the store to broadcast state changes to the workers.
- **Centralized State Updates**: The `setGlobalState.js` file provides a centralized function for updating the Redux store. This function not only dispatches actions to the store but also queues them to be sent to the renderer process in a batch. This ensures that the state is synchronized across all processes in an efficient manner.
- **Redux Store**: The `store.js` file is responsible for creating and configuring the main Redux store. It uses the `configureStore` function from `@reduxjs/toolkit` to create the store and combines all the different state slices using `combineReducers`. The store is configured with middleware that disables immutable and serializable checks, which is a common practice in Electron applications to improve performance.
- **State Slices**: The application's state is divided into several slices, each responsible for a specific part of the application's state. The following slices are used: `global`, `gameState`, `rules`, `lua`, `cavebot`, `targeting`, `statusMessages`, `regionCoordinates`, `ocr`, `uiValues`, `battleList`, and `pathfinder`.
- **Data Persistence**: The `saveManager.js` file is responsible for all data persistence logic. It provides functions to save and load the application's state to and from JSON files. It uses a schema-driven approach (`STATE_SCHEMA`) to define which parts of the state should be persisted and how they should be transformed before saving and after loading.
- **Auto-Save and Auto-Load**: The application has an auto-save feature that periodically saves the state to a file. It also has an auto-load feature that loads the last saved state when the application starts. This ensures that the user's settings are not lost between sessions.
- **Slice-Specific Saving**: The `saveManager.js` file also provides functions to save specific slices of the state, such as targeting profiles, cavebot profiles, and Lua scripts. This allows the user to manage their settings in a more granular way.
- **Global Shortcuts**: Registering and handling global keyboard shortcuts via `registerGlobalShortcuts`. The `globalShortcuts.js` file is the central place for all global shortcut logic. It uses the `globalShortcut` module from Electron to register a variety of shortcuts for controlling the bot, such as toggling the bot's status, showing/hiding the main window, and enabling/disabling different bot features.
- **Debouncing**: To prevent performance issues from rapid key presses, all shortcut handlers are debounced using `lodash/debounce`. This ensures that the associated actions are only triggered once after a short delay.
- **Notifications and Sounds**: When a shortcut is triggered, the application provides feedback to the user in the form of a notification and a sound. This is handled by the `showNotification` and `playSound` functions.
- **Notification Handler**: The `notificationHandler.js` file is responsible for creating and showing native desktop notifications. It uses the `Notification` module from Electron to display notifications with a custom title, body, and icon. The notifications are only shown if the user has enabled them in the application's settings.
- **IPC Listeners**: Handling messages from the renderer process and workers using `ipcMain.handle` and `ipcMain.on`. The `ipcListeners.js` file is the central place for all IPC-related logic. It handles a variety of messages, including state changes from the renderer, requests to save and load rules, and communication with the widget.
- **Communication with Renderer**: The main process communicates with the renderer process through a preload script (`preload.js`), which exposes a limited API to the renderer. This is a security best practice that ensures the renderer process does not have direct access to Node.js APIs.
- **Preload Script**: The `preload.js` file uses the `contextBridge` to expose a limited and secure API to the renderer process. This API allows the renderer to send and receive IPC messages, but it does not give it access to the full `ipcRenderer` object. This is a crucial security feature that prevents the renderer process from executing arbitrary Node.js code.
- **Communication with Widget**: The widget communicates with the main process via IPC to get the current state of the bot and to toggle the main window's visibility.

## 6. Security and Licensing

- **Hardware ID**: The `hardwareId.js` file is responsible for generating a unique hardware ID for the user's machine. It uses a multi-step process to ensure a reliable and unique ID is generated. It first tries to get the machine ID from `/etc/machine-id`, then falls back to the product UUID from `/sys/class/dmi/id/product_uuid`, and finally uses a hash of the system information as a last resort. This hardware ID can be used for licensing and tracking purposes.

## 7. Worker Details

The application uses a multi-worker architecture to handle different tasks concurrently. Each worker has a specific responsibility and communicates with the main process and other workers as needed.

### 6.1. `captureWorker`

- **Purpose**: Captures the screen content of the target window.
- **Communication**: Shares the captured image data with other workers via a `SharedArrayBuffer`.
- **Native Modules**: Uses a native module for efficient screen capture.

### 6.2. `regionMonitor`

- **Purpose**: Monitors specific regions of the screen for changes.
- **Communication**: Receives screen updates from the `captureWorker` and sends notifications to other workers when relevant regions change.
- **Native Modules**: None.

### 6.3. `screenMonitor`

- **Purpose**: Analyzes the screen content to extract game state information, such as health, mana, and cooldowns.
- **Communication**: Receives screen updates from the `captureWorker` and updates the Redux store with the extracted game state.
- **Native Modules**: Uses native modules for image processing and OCR.

### 6.4. `minimapMonitor`

- **Purpose**: Monitors the minimap to track the player's position and navigate the game world.
- **Communication**: Receives screen updates from the `captureWorker` and updates the Redux store with the player's position.
- **Native Modules**: Uses a native module for minimap matching.

### 6.5. `ocrWorker`

- **Purpose**: Performs Optical Character Recognition (OCR) on specific screen regions to read text.
- **Communication**: Receives screen updates from the `captureWorker` and sends the recognized text to other workers or the main process.
- **Native Modules**: Uses a native module for OCR.

### 6.6. `creatureMonitor`

- **Purpose**: Monitors the game world for creatures and updates the battle list.
- **Communication**: Receives screen updates from the `captureWorker` and updates the Redux store with the list of visible creatures.
- **Native Modules**: Uses native modules for creature detection.

### 6.7. `cavebotWorker`

- **Purpose**: Executes the cavebot logic, which includes navigating the game world, killing monsters, and looting.
- **Communication**: Interacts with the Redux store to get the current game state and sends commands to the `inputOrchestrator` to perform actions.
- **Native Modules**: None.

### 6.8. `targetingWorker`

- **Purpose**: Implements the targeting logic, which includes selecting and attacking monsters.
- **Communication**: Interacts with the Redux store to get the current game state and sends commands to the `inputOrchestrator` to perform actions.
- **Native Modules**: None.

### 6.9. `pathfinderWorker`

- **Purpose**: Calculates the optimal path for the cavebot to navigate the game world.
- **Communication**: Receives requests from the `cavebotWorker` and returns the calculated path.
- **Native Modules**: Uses a native module for pathfinding.

### 6.10. `windowTitleMonitor`

- **Purpose**: Monitors the title of the target window to detect changes.
- **Communication**: Sends notifications to the main process when the window title changes.
- **Native Modules**: None.

### 6.11. `inputOrchestrator`

- **Purpose**: Manages all keyboard and mouse inputs to the target window.
- **Communication**: Receives commands from other workers and sends the corresponding inputs to the target window.
- **Native Modules**: Uses native modules for sending keyboard and mouse events.

### 6.12. `luaScriptWorker`

- **Purpose**: Executes user-provided Lua scripts.
- **Communication**: Interacts with the Redux store and other workers via a dedicated Lua API.
- **Native Modules**: None.
