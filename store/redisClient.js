import { createClient } from 'redis';
import { startRedisServer } from './redisServer.js'; // Import server start function

let storeClient = null;
let connectionDetails = { host: null, port: null }; // Store details here

/**
 * Connects the Redis client to the server (starts server if needed).
 * @returns {Promise<object>} The connected client instance.
 */
async function connectClient() {
  if (storeClient && storeClient.isReady) {
    console.log('[RedisClient] Client already connected.');
    return storeClient;
  }
  try {
    const serverDetails = await startRedisServer(); // Ensure server is running and get config
    if (!serverDetails || !serverDetails.host || !serverDetails.port) {
      throw new Error('Failed to get server configuration.');
    }
    // Store details for later retrieval
    connectionDetails = serverDetails;

    console.log(`[RedisClient] Connecting to ${connectionDetails.host}:${connectionDetails.port}...`);
    storeClient = createClient({ socket: { port: connectionDetails.port, host: connectionDetails.host } });
    storeClient.on('error', (err) => console.error('[RedisClient] Error:', err));
    storeClient.on('ready', () => console.log('[RedisClient] Ready.'));
    storeClient.on('end', () => console.log('[RedisClient] Connection ended.'));

    await storeClient.connect();
    console.log(`[RedisClient] Connected.`);
    return storeClient;
  } catch (error) {
    console.error('[RedisClient] FATAL: Error connecting client:', error);
    storeClient = null;
    connectionDetails = { host: null, port: null }; // Reset on failure
    throw error;
  }
}

/**
 * Disconnects the Redis client.
 */
async function disconnectClient() {
  if (storeClient && storeClient.isOpen) { // Check if connected before quitting
    try {
      await storeClient.quit();
      console.log('[RedisClient] Disconnected.');
    } catch (error) {
      console.error('[RedisClient] Error disconnecting:', error);
    } finally {
      storeClient = null;
    }
  } else {
    console.log('[RedisClient] Client was not connected.');
    storeClient = null; // Ensure it's null even if it wasn't connected
  }
}

/**
 * Gets the current Redis client instance.
 * @returns {object|null} The client instance or null if not connected.
 */
function getStoreClient() {
  if (!storeClient || !storeClient.isReady) {
     // console.warn('[RedisClient] getStoreClient called but client is not ready/connected.');
     return null;
  }
  return storeClient;
}

/**
 * Gets the connection details of the managed Redis server.
 * @returns {{host: string|null, port: number|null}}
 */
function getRedisConnectionDetails() {
    return connectionDetails;
}

export { connectClient, disconnectClient, getStoreClient, getRedisConnectionDetails }; 