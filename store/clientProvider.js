import { createClient } from 'redis';

// This variable will hold the client instance specific to the context (main or worker)
let contextClient = null;
let isConnecting = false;
let connectionDetails = null; // Store details passed during initialization

/**
 * Initializes the Redis client for the current context (main or worker).
 * MUST be called once per context with connection details.
 * @param {{host: string, port: number}} details - Connection details.
 * @returns {Promise<object>} The connected client instance for this context.
 */
async function initializeContextClient(details) {
  if (contextClient && contextClient.isReady) {
    // console.log('[ClientProvider] Context client already initialized.');
    return contextClient;
  }
  if (isConnecting) {
     console.warn('[ClientProvider] Connection already in progress.');
     // Potentially return a promise that resolves when connection is done? For simplicity, just return null.
     return null;
  }
   if (!details || !details.host || !details.port) {
    throw new Error('[ClientProvider] Invalid connection details provided.');
  }

  isConnecting = true;
  connectionDetails = details; // Store for potential re-use/info
  console.log(`[ClientProvider] Initializing client for context. Connecting to ${details.host}:${details.port}...`);

  try {
    contextClient = createClient({
      socket: {
        host: details.host,
        port: details.port,
        connectTimeout: 3000, // Slightly longer timeout
      },
      // Add redis client options if needed
    });

    contextClient.on('error', (err) => {
        console.error('[ClientProvider] Context Redis Client Error:', err.message);
        // If error occurs before 'ready', reset state
        if (contextClient && !contextClient.isReady) {
            isConnecting = false;
            contextClient = null;
        }
        // Should we attempt reconnect? Let redis library handle default retries for now.
    });
    contextClient.on('ready', () => {
        console.log('[ClientProvider] Context client ready.');
        isConnecting = false;
    });
    contextClient.on('end', () => {
        console.log('[ClientProvider] Context client connection ended.');
        contextClient = null; // Reset on end
        isConnecting = false;
    });

    await contextClient.connect();
    console.log(`[ClientProvider] Context client connected.`);
    isConnecting = false;
    return contextClient;

  } catch (error) {
    console.error('[ClientProvider] FATAL: Error connecting context client:', error);
    contextClient = null;
    isConnecting = false;
    throw error; // Propagate
  }
}

/**
 * Gets the initialized Redis client for the current context.
 * @returns {object|null} The client instance or null if not initialized/ready.
 */
function getContextClient() {
  if (!contextClient || !contextClient.isReady) {
     // This can be noisy if called frequently before connection is ready
     // console.warn('[ClientProvider] getContextClient called but client is not ready/initialized.');
     return null;
  }
  return contextClient;
}

/**
 * Disconnects the client for the current context.
 */
async function disconnectContextClient() {
    if (contextClient && contextClient.isOpen) {
        try {
            await contextClient.quit();
            console.log('[ClientProvider] Context client disconnected.');
        } catch (err) {
            console.error('[ClientProvider] Error disconnecting context client:', err);
        } finally {
             contextClient = null;
             isConnecting = false;
        }
    }
}


export { initializeContextClient, getContextClient, disconnectContextClient }; 