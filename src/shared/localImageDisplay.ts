/**
 * Display-time resolver for `agentemployee-local://` image URLs. Inside the desktop
 * Electron shell that scheme is served by a privileged protocol handler; the
 * remote PWA (a plain browser) can't load it, so the mobile bridge installs a
 * resolver that maps those URLs to the paired desktop's authenticated HTTP
 * image endpoint. The desktop never installs a resolver, so URLs there stay
 * `agentemployee-local://` untouched.
 */
let resolver: ((agentemployeeLocalUrl: string) => string) | null = null;

/** Installed by the remote bridge while a desktop connection is active. */
export function setRemoteLocalImageResolver(
  fn: ((agentemployeeLocalUrl: string) => string) | null,
): void {
  resolver = fn;
}

/**
 * Maps a `agentemployee-local://` image URL to its renderable form. Returns `url`
 * unchanged unless it is a agentemployee-local URL AND a resolver is installed.
 */
export function resolveLocalImageDisplayUrl(url: string): string {
  if (!resolver || !url.startsWith("agentemployee-local://")) return url;
  return resolver(url);
}
