import { createCipheriv, createHmac, randomBytes } from 'node:crypto';

export function contactKey(value: string | undefined): Buffer {
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('Contact encryption key is not configured');
  return Buffer.from(value, 'hex');
}
export function protectContact(phone: string | undefined, key: Buffer, caseId: string) {
  if (!phone) return { identity: null, encrypted: null };
  const identity = createHmac('sha256', key).update('zianecomms-contact-identity-v1:' + phone).digest('hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(caseId));
  const ciphertext = Buffer.concat([cipher.update(phone, 'utf8'), cipher.final()]);
  return { identity, encrypted: ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':') };
}
// No country-code guessing: withholding a number is safer than attaching a wrong callback identity.
export function normalizePhone(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const phone = value.replace(/[\s().-]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : undefined;
}
export function redactPhones(text: string): string {
  return text.replace(/\+?\d[\d\s().-]{5,}\d/g, match => match.replace(/\D/g, '').length >= 7 ? '[phone redacted]' : match);
}
