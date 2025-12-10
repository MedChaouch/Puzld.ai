import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { version as currentVersion } from '../../package.json';

interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
}

const SKIP_FILE = join(homedir(), '.puzldai', '.skip-update-check');

// Mark that we just updated to a version (skip next check for this version)
export function markUpdated(version: string): void {
  try {
    writeFileSync(SKIP_FILE, version, 'utf-8');
  } catch {
    // Ignore errors
  }
}

// Check if we should skip update prompt for this version
function shouldSkipVersion(version: string): boolean {
  try {
    if (existsSync(SKIP_FILE)) {
      const skippedVersion = readFileSync(SKIP_FILE, 'utf-8').trim();
      return skippedVersion === version;
    }
  } catch {
    // Ignore errors
  }
  return false;
}

// Clear the skip file (called when a new version is detected that's different)
function clearSkipFile(): void {
  try {
    if (existsSync(SKIP_FILE)) {
      writeFileSync(SKIP_FILE, '', 'utf-8');
    }
  } catch {
    // Ignore errors
  }
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  try {
    const response = await fetch('https://registry.npmjs.org/puzldai/latest', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(3000), // 3s timeout
    });

    if (!response.ok) {
      return { hasUpdate: false, currentVersion, latestVersion: currentVersion };
    }

    const data = await response.json();
    const latestVersion = data.version;

    const hasNewerVersion = compareVersions(latestVersion, currentVersion) > 0;

    // If user already updated to this version, don't prompt again
    if (hasNewerVersion && shouldSkipVersion(latestVersion)) {
      return { hasUpdate: false, currentVersion, latestVersion };
    }

    // Clear skip file if there's a newer version than what was skipped
    if (hasNewerVersion) {
      clearSkipFile();
    }

    return {
      hasUpdate: hasNewerVersion,
      currentVersion,
      latestVersion,
    };
  } catch {
    // Network error, timeout, etc - silently skip update check
    return { hasUpdate: false, currentVersion, latestVersion: currentVersion };
  }
}

function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}
