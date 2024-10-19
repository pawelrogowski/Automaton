const COOLDOWN_DURATIONS = {
  healing: 930,
  attack: 1925,
  support: 425,
};

export class CooldownManager {
  constructor() {
    this.cooldowns = {
      healing: { active: false, startTime: 0 },
      attack: { active: false, startTime: 0 },
      support: { active: false, startTime: 0 },
    };
  }

  updateCooldown(type, isActive) {
    const now = performance.now();
    const cooldown = this.cooldowns[type];

    if (isActive && !cooldown.active) {
      cooldown.active = true;
      cooldown.startTime = now;
    } else if (!isActive && cooldown.active) {
      const elapsedTime = now - cooldown.startTime;
      if (elapsedTime >= COOLDOWN_DURATIONS[type]) {
        cooldown.active = false;
      }
    }

    return cooldown.active;
  }

  getCooldownState(type) {
    const cooldown = this.cooldowns[type];
    if (cooldown.active) {
      const elapsedTime = performance.now() - cooldown.startTime;
      if (elapsedTime >= COOLDOWN_DURATIONS[type]) {
        cooldown.active = false;
      }
    }
    return cooldown.active;
  }
}
