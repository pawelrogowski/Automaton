# Input Orchestrator Worker

## Purpose

The `inputOrchestrator` worker centralizes all keypress and mouse movement actions within the Electron application. Its primary goals are:

1.  **Prevent Race Conditions**: By queuing and processing input events sequentially, it avoids conflicts that can arise from multiple workers attempting to send inputs simultaneously.
2.  **Prioritization**: It allows for different types of input actions (e.g., hotkeys, movements) to be prioritized, ensuring critical actions are executed before less time-sensitive ones.
3.  **Controlled Execution Speed**: All input actions are executed with a configurable delay (currently 50ms) between them, mimicking human-like input and reducing the risk of detection by external systems.
4.  **Simplified Worker Logic**: Other workers no longer need to directly import and manage native input modules. Instead, they send high-level input requests to the `workerManager`, which forwards them to the `inputOrchestrator`.
5.  **Centralized State Access**: The `inputOrchestrator` has direct access to `windowId` and `display` from the global state, eliminating the need for individual workers to manage these details for input operations.

## Usage

To utilize the `inputOrchestrator`, other workers should send messages to the `workerManager` with a specific `type` of `'inputAction'`. The `payload` of this message must contain the `type` of priority and the `action` details, including the `module`, `method`, and `args`.

### Message Structure

```javascript
{
  type: 'inputAction',
  payload: {
    type: 'hotkey' | 'movement' | 'default', // Defines the priority of the action.
                                            // 'hotkey': Highest priority (e.g., emergency healing, critical spells).
                                            // 'movement': Medium priority (e.g., walking, mouse movements).
                                            // 'default': Lowest priority (for all other actions).
    action: {
      module: 'keypress' | 'mouseController', // The native module whose method should be called.
      method: 'sendKey' | 'type' | 'typeArray' | 'rotate' | 'keyDown' | 'keyUp' | // For 'keypress' module
                'leftClick' | 'rightClick' | 'mouseDown' | 'mouseUp' | 'rightMouseDown' | 'rightMouseUp' | 'mouseMove', // For 'mouseController' module
      args: [], // An array of arguments for the specified method.
                // IMPORTANT: Do NOT include `windowId` or `display` in `args`.
                // The `inputOrchestrator` automatically retrieves these from the global state.
    },
  },
}
```

### Examples

#### 1. Sending a Keypress (e.g., pressing 'f1')

To simulate pressing the 'f1' key, which is typically a hotkey and should have high priority:

```javascript
// In a worker (e.g., cavebot/actionHandlers.js)
parentPort.postMessage({
  type: 'inputAction',
  payload: {
    type: 'hotkey', // High priority for hotkeys
    action: {
      module: 'keypress',
      method: 'sendKey',
      args: ['f1'], // Corresponds to keypress.sendKey('f1', display)
    },
  },
});
```

#### 2. Typing a String (e.g., typing "hello")

To type a string, which might be a lower priority than a hotkey:

```javascript
// In a worker
parentPort.postMessage({
  type: 'inputAction',
  payload: {
    type: 'default', // Default priority for typing
    action: {
      module: 'keypress',
      method: 'type',
      args: ['hello', false], // Corresponds to keypress.type('hello', display, false)
    },
  },
});
```

#### 3. Performing a Mouse Left Click (e.g., at coordinates 100, 200)

To simulate a mouse movement and click:

```javascript
// In a worker
parentPort.postMessage({
  type: 'inputAction',
  payload: {
    type: 'movement', // Medium priority for mouse movements
    action: {
      module: 'mouseController',
      method: 'leftClick',
      args: [100, 200], // Corresponds to mouseController.leftClick(windowId, 100, 200, display)
    },
  },
});
```

#### 4. Moving the Mouse (e.g., to coordinates 500, 300)

```javascript
// In a worker
parentPort.postMessage({
  type: 'inputAction',
  payload: {
    type: 'movement', // Medium priority for mouse movements
    action: {
      module: 'mouseController',
      method: 'mouseMove',
      args: [500, 300], // Corresponds to mouseController.mouseMove(windowId, 500, 300, display)
    },
  },
});
```

### Integration with `workerManager.js`

The `workerManager.js` is responsible for:

- Starting the `inputOrchestrator` worker.
- Forwarding `inputAction` messages from other workers to the `inputOrchestrator`.
- Providing the `inputOrchestrator` with the necessary `globalState` (including `windowId` and `display`).

Workers should **not** directly import `keypress-native` or `mouse-controller` after this integration. All input actions should be routed through the `inputOrchestrator` via the `workerManager`.
