import 'server-only';
import { createClient } from '@supabase/supabase-js';

export function createOperationsClient() {
  if (process.env.ZIANECOMMS_DEMO_MODE !== 'true' && process.env.RETELL_ENABLED !== 'true') throw new Error('Persistence demo is disabled. Set ZIANECOMMS_DEMO_MODE=true only for synthetic demo data.');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Missing server-only Supabase secret key. Configure SUPABASE_SECRET_KEY in .env.local.');
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error('Missing Supabase URL.');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
