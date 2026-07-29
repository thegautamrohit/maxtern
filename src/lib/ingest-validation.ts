import dns from "dns/promises"

// All RFC-1918 private IP ranges + loopback + localhost.
// Used in both layers of SSRF protection — hostname regex check and post-DNS-resolution check.
const PRIVATE_IP_RANGES = [
  /^127\./,           // loopback
  /^10\./,            // RFC-1918 Class A
  /^192\.168\./,      // RFC-1918 Class C
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC-1918 Class B (172.16–172.31)
  /^::1$/,            // IPv6 loopback
  /^localhost$/i,
]

export const MAX_PDF_SIZE = 50 * 1024 * 1024 // 50MB

function isPrivateHost(hostname: string): boolean {
  return PRIVATE_IP_RANGES.some((range) => range.test(hostname))
}

// Two-layer SSRF (Server-Side Request Forgery) protection for website URLs.
// SSRF: an attacker submits a URL that tricks the server into fetching an internal resource
// (e.g. http://192.168.1.1/admin) from inside the private network, bypassing firewalls.
//
// Layer 1 — hostname regex: catches obvious internal IPs and localhost directly in the URL.
// Layer 2 — DNS resolution: catches public-looking domains (e.g. evil.com) that resolve
// to a private IP. Without this layer, Layer 1 is trivially bypassed.
// { all: true } returns all DNS A records — a hostname can have multiple, some private.
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

  // Layer 1 — check the hostname directly in the URL
  if (isPrivateHost(parsed.hostname)) {
    return "URL resolves to a private/internal address"
  }

  // Layer 2 — resolve DNS and check the actual IP addresses
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

// GitHub URL validation is sync — no DNS check needed.
// Restricting to github.com by hostname is sufficient: self-hosted GitLab, internal git servers,
// and typosquatted domains are all blocked by the hostname check alone.
// No SSRF risk because GithubRepoLoader uses the GitHub API (authenticated), not raw HTTP fetch.
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
