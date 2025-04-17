import { RedisMemoryServer } from 'redis-memory-server';

let redisServer = null;
let serverConfig = { host: null, port: null };

/**
 * Starts the in-memory Redis server if it's not already running.
 * @returns {Promise<{host: string, port: number}>} Connection details.
 */
async function startRedisServer() {
  if (redisServer && redisServer.state === 'running') {
    console.log('[RedisServer] Server already running.');
    return serverConfig;
  }
  try {
    console.log('[RedisServer] Starting in-memory Redis server...');
    redisServer = new RedisMemoryServer();
    await redisServer.start();
    serverConfig.port = await redisServer.getPort();
    serverConfig.host = await redisServer.getHost();
    console.log(`[RedisServer] Started on ${serverConfig.host}:${serverConfig.port}`);
    return serverConfig;
  } catch (error) {
    console.error('[RedisServer] FATAL: Error starting server:', error);
    redisServer = null;
    serverConfig = { host: null, port: null };
    throw error; // Propagate
  }
}

/**
 * Stops the in-memory Redis server if it's running.
 */
async function stopRedisServer() {
  if (redisServer) {
    try {
      await redisServer.stop();
      console.log('[RedisServer] Stopped.');
    } catch (error) {
      console.error('[RedisServer] Error stopping server:', error);
    } finally {
      redisServer = null;
      serverConfig = { host: null, port: null };
    }
  } else {
    console.log('[RedisServer] Server was not running.');
  }
}

export { startRedisServer, stopRedisServer }; 