// Next.js may normalize nextUrl to localhost behind a proxy; compare the browser Origin to the incoming Host.
// This is CSRF hygiene for the public synthetic demo, not authentication of direct HTTP clients.
export function sameRequestOrigin(origin: string | null, host: string | null): boolean {
  if (!origin) return true;
  try { const url = new URL(origin); return ['http:', 'https:'].includes(url.protocol) && url.origin === origin && url.host === host; }
  catch { return false; }
}
