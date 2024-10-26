import { performance as perf } from 'perf_hooks';

const ENABLE_COOLDOWN_LOGGING = true; // Toggle logging functionality

const COOLDOWN_DURATIONS = {
  healing: 800,
  attack: 1935,
  support: 425,
};

export class CooldownManager {
  constructor() {
    this.cooldowns = {
      healing: { active: false, startTime: 0, totalDuration: 0 },
      attack: { active: false, startTime: 0, totalDuration: 0 },
      support: { active: false, startTime: 0, totalDuration: 0 },
    };
  }

  updateCooldown(type, isActive) {
    const now = perf.now();
    const cooldown = this.cooldowns[type];

    if (isActive && !cooldown.active) {
      cooldown.active = true;
      cooldown.startTime = now;
    } else if (!isActive && cooldown.active) {
      const elapsedTime = now - cooldown.startTime;
      if (elapsedTime >= COOLDOWN_DURATIONS[type]) {
        cooldown.active = false;

        if (ENABLE_COOLDOWN_LOGGING) {
          console.log(`${type} cooldown deactivated after ${elapsedTime.toFixed(2)}ms`);
        }
      }
    }

    return cooldown.active;
  }

  getCooldownState(type) {
    const cooldown = this.cooldowns[type];
    if (cooldown.active) {
      const elapsedTime = perf.now() - cooldown.startTime;
      if (elapsedTime >= COOLDOWN_DURATIONS[type]) {
        cooldown.active = false;

        if (ENABLE_COOLDOWN_LOGGING) {
          console.log(`${type} cooldown expired after ${elapsedTime.toFixed(2)}ms`);
        }
      }
    }
    return cooldown.active;
  }

  // Optional method to get current cooldown statistics
  getStats() {
    if (!ENABLE_COOLDOWN_LOGGING) return null;

    const stats = {};
    const now = perf.now();

    for (const [type, data] of Object.entries(this.cooldowns)) {
      const currentDuration = data.active ? now - data.startTime : 0;
      stats[type] = {
        isActive: data.active,
        currentActiveDuration: currentDuration,
      };
    }

    return stats;
  }
}
