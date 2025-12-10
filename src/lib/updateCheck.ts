import { version as currentVersion } from '../../package.json';

interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
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

    return {
      hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
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
