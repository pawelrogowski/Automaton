import { execSync } from 'child_process';
import { existsSync } from 'fs';

export function getLinuxHardwareId() {
  try {
    // Try machine-id first (most modern systems)
    if (existsSync('/etc/machine-id')) {
      const machineId = execSync('cat /etc/machine-id', { encoding: 'utf-8' }).trim();
      if (machineId.length >= 32) return machineId;
    }

    // Fallback to product_uuid (AWS/Azure/GCP and some VMs)
    if (existsSync('/sys/class/dmi/id/product_uuid')) {
      return execSync('cat /sys/class/dmi/id/product_uuid', { encoding: 'utf-8' }).trim();
    }

    // Final fallback using system information
    const fallbackId = execSync('uname -a | sha256sum | head -c 64', { encoding: 'utf-8' }).trim();
    return fallbackId || 'unknown-device';
  } catch (error) {
    console.error('Hardware ID detection failed:', error);
    return 'error-no-id';
  }
}
