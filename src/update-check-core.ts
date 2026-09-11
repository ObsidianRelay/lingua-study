export const LINGUA_STUDY_PLUGIN_ID = "lingua-study";
export const LINGUA_STUDY_LATEST_MANIFEST_URL =
  "https://github.com/ObsidianRelay/lingua-study/releases/latest/download/manifest.json";
export const LINGUA_STUDY_UPDATE_PAGE_URI =
  "obsidian://show-plugin?id=lingua-study";

export interface PluginUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updatePageUrl: string;
}

interface ReleaseManifest {
  id: string;
  version: string;
}

function parseVersion(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version.trim());
  if (!match) {
    return null;
  }
  const parts = match.slice(1).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isSafeInteger(part))) {
    return null;
  }
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function isNewerPluginVersion(currentVersion: string, candidateVersion: string): boolean {
  const current = parseVersion(currentVersion);
  const candidate = parseVersion(candidateVersion);
  if (!current || !candidate) {
    return false;
  }
  for (let index = 0; index < current.length; index += 1) {
    const currentPart = current[index] ?? 0;
    const candidatePart = candidate[index] ?? 0;
    if (candidatePart !== currentPart) {
      return candidatePart > currentPart;
    }
  }
  return false;
}

function isReleaseManifest(value: unknown): value is ReleaseManifest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const manifest = value as Record<string, unknown>;
  return manifest.id === LINGUA_STUDY_PLUGIN_ID && typeof manifest.version === "string";
}

export function getPluginUpdateInfo(
  currentVersion: string,
  releaseManifest: unknown
): PluginUpdateInfo | null {
  if (
    !isReleaseManifest(releaseManifest) ||
    !isNewerPluginVersion(currentVersion, releaseManifest.version)
  ) {
    return null;
  }
  return {
    currentVersion,
    latestVersion: releaseManifest.version,
    updatePageUrl: LINGUA_STUDY_UPDATE_PAGE_URI
  };
}
