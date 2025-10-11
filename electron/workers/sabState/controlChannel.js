// electron/workers/sabState/controlChannel.js
// Lock-free control channel for worker-to-worker messaging

import {
  getPropertyInfo,
  WORKER_IDS,
  CONTROL_COMMANDS,
  CONTROL_PRIORITIES,
} from './schema.js';

/**
 * Control Channel for direct worker-to-worker messaging
 * Uses lock-free ring buffer for high-performance communication
 */
export class ControlChannel {
  constructor(sabStateArray) {
    this.array = sabStateArray;
    const { offset, schema } = getPropertyInfo('controlChannel');

    this.baseOffset = offset;
    this.messageSize = schema.messageSize;
    this.maxMessages = schema.maxMessages;

    // Ring buffer header indices
    this.WRITE_INDEX = this.baseOffset + 0;
    this.READ_INDEX = this.baseOffset + 1;
    this.COUNT = this.baseOffset + 2;
    this.LOCK = this.baseOffset + 3;

    // Messages start after header
    this.messagesStart = this.baseOffset + schema.headerSize;

    // Initialize if needed
    if (
      Atomics.load(this.array, this.WRITE_INDEX) === 0 &&
      Atomics.load(this.array, this.READ_INDEX) === 0
    ) {
      this._initialize();
    }

    this.workerId = WORKER_IDS.BROADCAST; // Will be set by worker
  }

  /**
   * Initialize ring buffer
   * @private
   */
  _initialize() {
    Atomics.store(this.array, this.WRITE_INDEX, 0);
    Atomics.store(this.array, this.READ_INDEX, 0);
    Atomics.store(this.array, this.COUNT, 0);
    Atomics.store(this.array, this.LOCK, 0);
  }

  /**
   * Set this worker's ID for message sending
   */
  setWorkerId(workerId) {
    this.workerId = workerId;
  }

  /**
   * Send a message to target worker(s)
   * @param {number} target - WORKER_IDS or BROADCAST
   * @param {number} command - CONTROL_COMMANDS
   * @param {Object} payload - {a?, b?, c?} optional int32 payload
   * @param {number} priority - CONTROL_PRIORITIES (default: NORMAL)
   * @returns {boolean} Success
   */
  send(target, command, payload = {}, priority = CONTROL_PRIORITIES.NORMAL) {
    // Acquire lock (spin briefly)
    let attempts = 0;
    while (Atomics.compareExchange(this.array, this.LOCK, 0, 1) !== 0) {
      if (++attempts > 100) {
        console.warn('[ControlChannel] Failed to acquire lock for send');
        return false;
      }
    }

    try {
      const count = Atomics.load(this.array, this.COUNT);

      // Check if buffer is full
      if (count >= this.maxMessages) {
        console.warn('[ControlChannel] Buffer full, dropping message');
        return false;
      }

      // Get write position
      const writeIdx = Atomics.load(this.array, this.WRITE_INDEX);
      const messageOffset = this.messagesStart + writeIdx * this.messageSize;

      // Write message
      Atomics.store(this.array, messageOffset + 0, this.workerId);
      Atomics.store(this.array, messageOffset + 1, target);
      Atomics.store(this.array, messageOffset + 2, command);
      Atomics.store(this.array, messageOffset + 3, priority);
      Atomics.store(this.array, messageOffset + 4, Date.now() % 0x7fffffff);
      Atomics.store(this.array, messageOffset + 5, payload.type || 0);
      Atomics.store(this.array, messageOffset + 6, payload.a || 0);
      Atomics.store(this.array, messageOffset + 7, payload.b || 0);
      Atomics.store(this.array, messageOffset + 8, payload.c || 0);

      // Advance write index (circular)
      Atomics.store(
        this.array,
        this.WRITE_INDEX,
        (writeIdx + 1) % this.maxMessages,
      );
      Atomics.add(this.array, this.COUNT, 1);

      // Wake any waiting workers
      Atomics.notify(this.array, this.COUNT, 1);

      return true;
    } finally {
      // Release lock
      Atomics.store(this.array, this.LOCK, 0);
    }
  }

  /**
   * Poll for messages (non-blocking)
   * @returns {Array<Object>} Array of messages for this worker
   */
  poll() {
    const messages = [];

    // Acquire lock (spin briefly)
    let attempts = 0;
    while (Atomics.compareExchange(this.array, this.LOCK, 0, 1) !== 0) {
      if (++attempts > 100) {
        return messages; // Return empty if can't acquire
      }
    }

    try {
      let count = Atomics.load(this.array, this.COUNT);

      while (count > 0) {
        const readIdx = Atomics.load(this.array, this.READ_INDEX);
        const messageOffset = this.messagesStart + readIdx * this.messageSize;

        // Peek at message target
        const target = Atomics.load(this.array, messageOffset + 1);

        // Check if message is for us or broadcast
        if (target === this.workerId || target === WORKER_IDS.BROADCAST) {
          // Read full message
          const message = {
            sender: Atomics.load(this.array, messageOffset + 0),
            target: target,
            command: Atomics.load(this.array, messageOffset + 2),
            priority: Atomics.load(this.array, messageOffset + 3),
            timestamp: Atomics.load(this.array, messageOffset + 4),
            payload: {
              type: Atomics.load(this.array, messageOffset + 5),
              a: Atomics.load(this.array, messageOffset + 6),
              b: Atomics.load(this.array, messageOffset + 7),
              c: Atomics.load(this.array, messageOffset + 8),
            },
          };

          messages.push(message);
        }

        // Advance read index
        Atomics.store(
          this.array,
          this.READ_INDEX,
          (readIdx + 1) % this.maxMessages,
        );
        Atomics.sub(this.array, this.COUNT, 1);
        count--;
      }

      return messages;
    } finally {
      // Release lock
      Atomics.store(this.array, this.LOCK, 0);
    }
  }

  /**
   * Wait for a message (blocking)
   * @param {number} timeoutMs - Maximum time to wait
   * @returns {Object|null} Message or null on timeout
   */
  waitForMessage(timeoutMs = 1000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      // Check for messages
      const messages = this.poll();
      if (messages.length > 0) {
        return messages[0];
      }

      // Wait for notification or timeout
      const count = Atomics.load(this.array, this.COUNT);
      if (count === 0) {
        const remaining = timeoutMs - (Date.now() - startTime);
        if (remaining > 0) {
          Atomics.wait(this.array, this.COUNT, 0, Math.min(remaining, 50));
        }
      }
    }

    return null;
  }

  /**
   * Broadcast to all workers
   * @param {number} command
   * @param {Object} payload
   * @param {number} priority
   */
  broadcast(command, payload = {}, priority = CONTROL_PRIORITIES.NORMAL) {
    return this.send(WORKER_IDS.BROADCAST, command, payload, priority);
  }
}
