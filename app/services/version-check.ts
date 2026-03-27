export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  changelog: string
  downloadUrl: string
  htmlUrl: string
}

const GITHUB_REPO = 'apuigsech/oncraft'
const CHECK_TIMEOUT_MS = 5000

let cachedResult: UpdateInfo | null | undefined

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na !== nb) return na - nb
  }
  return 0
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  // Return cached result if we already checked this session
  if (cachedResult !== undefined) return cachedResult

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)

    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        signal: controller.signal,
        headers: { Accept: 'application/vnd.github.v3+json' },
      },
    )
    clearTimeout(timeout)

    if (!res.ok) {
      cachedResult = null
      return null
    }

    const data = await res.json()
    const latestVersion = (data.tag_name as string).replace(/^v/, '')
    const currentVersion = import.meta.env.PACKAGE_VERSION as string

    if (compareVersions(latestVersion, currentVersion) <= 0) {
      cachedResult = null
      return null
    }

    cachedResult = {
      currentVersion,
      latestVersion,
      changelog: data.body ?? '',
      downloadUrl: data.html_url,
      htmlUrl: data.html_url,
    }
    return cachedResult
  } catch {
    // Network errors, timeouts, parse errors — all silent
    cachedResult = null
    return null
  }
}
