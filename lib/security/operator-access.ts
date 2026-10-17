// Edge-compatible shared operator gate. No account system or new login UI.
export function operatorAccess(authorization: string | null, password = process.env.OPERATIONS_PASSWORD): boolean {
  if (!password || password.length < 24 || !authorization?.startsWith('Basic ')) return false;
  try {
    const supplied = atob(authorization.slice(6));
    const expected = `operator:${password}`;
    let difference = supplied.length ^ expected.length;
    for (let i = 0; i < Math.max(supplied.length, expected.length); i++) difference |= (supplied.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
    return difference === 0;
  } catch { return false; }
}
export function operatorGateRequired() {
  return process.env.RETELL_CHAT_ENABLED === 'true' || process.env.TWILIO_ENABLED === 'true' || process.env.RETELL_ENABLED === 'true' || !!process.env.OPERATIONS_PASSWORD;
}
export function operatorDenied() {
  const configured = (process.env.OPERATIONS_PASSWORD?.length ?? 0) >= 24;
  return new Response(configured ? 'Operator access required' : 'Operator access is not configured', {
    status: configured ? 401 : 503,
    headers: { 'Cache-Control': 'no-store', ...(configured ? { 'WWW-Authenticate': 'Basic realm="ZianeComms", charset="UTF-8"' } : {}) },
  });
}
