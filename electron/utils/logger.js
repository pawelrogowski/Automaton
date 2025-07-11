// electron/utils/logger.js
/**
 * Creates a configured logger function.
 *
 * @param {object} config - Logging configuration.
 * @param {boolean} [config.error=true] - Enable error logs.
 * @param {boolean} [config.warn=false] - Enable warning logs.
 * @param {boolean} [config.info=false] - Enable info logs.
 * @param {boolean} [config.debug=false] - Enable debug logs.
 * @param {boolean} [config.colors=true] - Enable colored output.
 * @returns {function(string, string, ...any): void} - The logging function.
 *   The function takes (level, message, ...optionalParams).
 */
export function createLogger(config = {}) {
  const defaultConfig = {
    error: true,
    warn: false,
    info: true,
    debug: false,
    colors: true,
  };

  // Merge provided config with default config
  const loggerConfig = { ...defaultConfig, ...config };

  const levels = {
    error: { tag: 'ERROR', color: 31, consoleMethod: 'error' }, // Red
    warn: { tag: 'WARN', color: 33, consoleMethod: 'warn' }, // Yellow
    info: { tag: 'INFO', color: 34, consoleMethod: 'log' }, // Blue
    debug: { tag: 'DEBUG', color: 32, consoleMethod: 'log' }, // Green
  };

  /**
   * Logs a message with a specific level.
   *
   * @param {string} level - The logging level ('error', 'warn', 'info', 'debug').
   * @param {string} message - The message to log.
   * @param {...any} optionalParams - Optional parameters to log (e.g., objects, variables).
   */
  return function log(level, message, ...optionalParams) {
    // Normalize level to lowercase for config lookup
    const lowerLevel = level.toLowerCase();
    const levelDetails = levels[lowerLevel];

    // Check if the level exists and is enabled in the config
    if (!levelDetails || !loggerConfig[lowerLevel]) {
      return; // Don't log if level is not configured or invalid
    }

    const now = new Date();
    // Format timestamp as YYYY-MM-DD HH:MM:SS.sss
    const timestamp = now.toISOString().replace('T', ' ').slice(0, 23);
    const tag = levelDetails.tag;
    const consoleMethod = levelDetails.consoleMethod;

    let formattedMessage;
    if (loggerConfig.colors) {
      const colorCode = levelDetails.color;
      // --- FIX: Apply color once at the start and reset once at the end ---
      // This ensures the tag, timestamp, and message are all the same color.
      // OLD: `\x1b[${colorCode}m[${tag}] [\x1b[90m${timestamp}\x1b[0m]\x1b[0m ${message}`
      formattedMessage = `\x1b[${colorCode}m[${tag}] [${timestamp}] ${message}\x1b[0m`;
    } else {
      // Format: [TAG] [TIMESTAMP] Message
      formattedMessage = `[${tag}] [${timestamp}] ${message}`;
    }

    // Use the appropriate console method to maintain console output streams (stdout vs stderr)
    console[consoleMethod](formattedMessage, ...optionalParams);
  };
}

// Example usage (can be removed or kept for testing)
// const defaultLogger = createLogger();
// defaultLogger('error', 'This is an error message.');
// defaultLogger('warn', 'This is a warning message.'); // Won't show with default config
// defaultLogger('info', 'This is an info message.');   // Won't show with default config
// defaultLogger('debug', 'This is a debug message.'); // Won't show with default config

// const verboseLogger = createLogger({ info: true, warn: true, debug: true });
// verboseLogger('error', 'This is an error message (verbose).');
// verboseLogger('warn', 'This is a warning message (verbose).');
// verboseLogger('info', 'This is an info message (verbose).');
// verboseLogger('debug', 'This is a debug message (verbose).', { data: 123 });
