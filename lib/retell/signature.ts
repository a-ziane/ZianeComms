import { createHmac, timingSafeEqual } from 'node:crypto';

// Retell's documented wire format: v=<milliseconds>,d=HMAC_SHA256(rawBody + v, API key).
// Verify the original body, before JSON parsing; reject replays outside the five-minute window.
export function verifyRetellSignature(rawBody: string, signature: string | null, apiKey: string, now = Date.now()): boolean {
  const match = /^v=(\d+),d=([a-fA-F0-9]{64})$/.exec(signature ?? '');
  if (!apiKey || !match || !Number.isSafeInteger(Number(match[1])) || Math.abs(now - Number(match[1])) > 300000) return false;
  const expected = createHmac('sha256', apiKey).update(rawBody + match[1]).digest();
  return timingSafeEqual(expected, Buffer.from(match[2], 'hex'));
}
