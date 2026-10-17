import 'server-only';
import { contactKey, normalizePhone } from '@/lib/retell/contact';
import type { Rulebook } from '@/types';
export const SMS_TEXT: Record<Rulebook, string> = {
  disaster: "ZianeComms: Sorry we couldn't fully help on your call. Reply with what you still need, or URGENT if your situation changed. For immediate danger contact emergency services. Reply STOP to opt out.",
  clinic: "ZianeComms: Your request still needs follow-up. Reply with what you still need, or URGENT if your situation changed. For immediate danger contact emergency services. Reply STOP to opt out.",
};
export function messagingConfig(env: Record<string,string|undefined> = process.env) {
  if (env.TWILIO_ENABLED !== 'true') return null;
  const required = (key: string) => { const value = env[key]; if (!value?.trim()) throw new Error('Messaging configuration incomplete'); return value; };
  const accountSid = required('TWILIO_ACCOUNT_SID');
  const apiKey = required('TWILIO_API_KEY');
  if (!/^AC[a-f0-9]{32}$/i.test(accountSid) || !/^SK[a-f0-9]{32}$/i.test(apiKey)) throw new Error('Messaging configuration invalid');
  const from = normalizePhone(required('TWILIO_PHONE_NUMBER'));
  const base = new URL(required('TWILIO_WEBHOOK_BASE_URL'));
  if (!from || base.protocol !== 'https:' || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('Invalid messaging origin/sender');
  if ((env.OPERATIONS_PASSWORD?.length ?? 0) < 24) throw new Error('Operator protection required');
  const recipients = required('SMS_RECOVERY_ALLOWED_RECIPIENTS').split(',').map(v => normalizePhone(v.trim()));
  if (recipients.some(v => !v) || recipients.length > 10) throw new Error('Invalid consenting demo recipients');
  return { accountSid, apiKey, apiSecret: required('TWILIO_API_SECRET'), authToken: required('TWILIO_AUTH_TOKEN'), from,
    baseUrl: base.origin, recipients: recipients as string[], encryptionKey: contactKey(env.CONTACT_ENCRYPTION_KEY),
    templates: { disaster: env.SMS_RECOVERY_DISASTER_TEXT || SMS_TEXT.disaster, clinic: env.SMS_RECOVERY_CLINIC_TEXT || SMS_TEXT.clinic } };
}
export type MessagingConfig = NonNullable<ReturnType<typeof messagingConfig>>;
