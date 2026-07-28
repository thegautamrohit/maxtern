import dns from "dns/promises"

const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
  /^localhost$/i,
]

export const MAX_PDF_SIZE = 50 * 1024 * 1024 // 50MB

function isPrivateHost(hostname: string): boolean {
  return PRIVATE_IP_RANGES.some((range) => range.test(hostname))
}

export async function validateWebsiteUrl(source: string): Promise<string | null> {
  let parsed: URL
  try {
    parsed = new URL(source)
  } catch {
    return "Invalid URL format"
  }

  if (parsed.protocol !== "https:") {
    return "Only HTTPS URLs are allowed"
  }

  if (isPrivateHost(parsed.hostname)) {
    return "URL resolves to a private/internal address"
  }

  try {
    const addresses = await dns.lookup(parsed.hostname, { all: true })
    for (const { address } of addresses) {
      if (isPrivateHost(address)) {
        return "URL resolves to a private/internal address"
      }
    }
  } catch {
    return "Could not resolve hostname"
  }

  return null
}

export function validateGithubUrl(source: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(source)
  } catch {
    return "Invalid URL format"
  }

  if (parsed.hostname !== "github.com") {
    return "Only github.com URLs are allowed"
  }

  if (parsed.protocol !== "https:") {
    return "Only HTTPS URLs are allowed"
  }

  return null
}
