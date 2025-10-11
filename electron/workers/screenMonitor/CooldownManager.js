import { performance as perf } from 'perf_hooks';

// Configuration Section
const CONFIG = {
  ENABLE_COOLDOWN_LOGGING: false,
  DEBOUNCE_DURATION: 50,
  HISTORY_LENGTH: 3,
  MAX_COOLDOWN_DURATIONS: {
    attack: 2000,
    healing: 1000,
    support: 500,
  },
};

const COOLDOWN_DURATIONS = {
  healing: 1000,
  attack: 1950,
  support: 500,
};

export class CooldownManager {
  constructor() {
    this.cooldowns = {
      healing: {
        active: false,
        startTime: 0,
        debounceEndTime: 0,
        history: [],
      },
      attack: {
        active: false,
        startTime: 0,
        debounceEndTime: 0,
        history: [],
      },
      support: {
        active: false,
        startTime: 0,
        debounceEndTime: 0,
        history: [],
      },
    };
  }

  forceDeactivate(type) {
    const cooldown = this.cooldowns[type];
    const now = perf.now();

    cooldown.active = false;
    cooldown.startTime = 0;
    cooldown.debounceEndTime = now + CONFIG.DEBOUNCE_DURATION;
    cooldown.history = [];

    if (CONFIG.ENABLE_COOLDOWN_LOGGING) {
      console.log(`${type} cooldown force-deactivated by UI state`);
    }
  }

  updateCooldown(type, isActive) {
    const now = perf.now();
    const cooldown = this.cooldowns[type];

    // Update state history
    cooldown.history.push(isActive);
    if (cooldown.history.length > CONFIG.HISTORY_LENGTH) {
      cooldown.history.shift();
    }

    // Determine consistent state
    const activeCount = cooldown.history.filter((state) => state).length;
    const consistentActive =
      activeCount >= Math.ceil(CONFIG.HISTORY_LENGTH / 2);

    // Activation logic
    if (
      consistentActive &&
      !cooldown.active &&
      now >= cooldown.debounceEndTime
    ) {
      cooldown.active = true;
      cooldown.startTime = now;
      cooldown.debounceEndTime =
        now + COOLDOWN_DURATIONS[type] - CONFIG.DEBOUNCE_DURATION;

      if (CONFIG.ENABLE_COOLDOWN_LOGGING) {
        console.log(`${type} cooldown activated`);
      }
    }

    // Deactivation logic
    if (
      !consistentActive &&
      cooldown.active &&
      now >= cooldown.debounceEndTime
    ) {
      const elapsedTime = now - cooldown.startTime;
      const maxDuration = CONFIG.MAX_COOLDOWN_DURATIONS[type];

      if (
        elapsedTime >= COOLDOWN_DURATIONS[type] ||
        elapsedTime >= maxDuration
      ) {
        cooldown.active = false;
        cooldown.debounceEndTime = now + CONFIG.DEBOUNCE_DURATION;

        if (CONFIG.ENABLE_COOLDOWN_LOGGING) {
          console.log(
            `${type} cooldown naturally deactivated after ${elapsedTime.toFixed(1)}ms`,
          );
        }
      }
    }

    return cooldown.active;
  }

  getCooldownState(type) {
    const cooldown = this.cooldowns[type];
    if (cooldown.active) {
      const elapsedTime = perf.now() - cooldown.startTime;
      const maxDuration = CONFIG.MAX_COOLDOWN_DURATIONS[type];

      // Force expiration if beyond maximum allowed duration
      if (elapsedTime >= maxDuration) {
        cooldown.active = false;
        cooldown.debounceEndTime = perf.now() + CONFIG.DEBOUNCE_DURATION;

        if (CONFIG.ENABLE_COOLDOWN_LOGGING) {
          console.log(
            `${type} cooldown forced expiration after ${elapsedTime.toFixed(2)}ms`,
          );
        }
      }
    }
    return cooldown.active;
  }

  getStats() {
    if (!CONFIG.ENABLE_COOLDOWN_LOGGING) return null;

    const stats = {};
    const now = perf.now();

    for (const [type, data] of Object.entries(this.cooldowns)) {
      const currentDuration = data.active ? now - data.startTime : 0;
      stats[type] = {
        isActive: data.active,
        currentActiveDuration: currentDuration,
        debounceEndTime: data.debounceEndTime,
        history: [...data.history],
      };
    }

    return stats;
  }
}
