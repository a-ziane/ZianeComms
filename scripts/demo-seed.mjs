import { createServer } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, resolve: { alias: { '@': process.cwd() } } });
try {
  const { demoSeed } = await server.ssrLoadModule('/lib/persistence/demo.ts');
  const payload = demoSeed();
  if (process.argv.includes('--generate')) {
    const sql = `-- Generated from the existing mock data and engines. Explicit, idempotent seed; never runs at app startup.\nselect public.zianecomms_seed_demo($seed$${JSON.stringify(payload)}$seed$::jsonb);\n`;
    await writeFile(path.join(process.cwd(), 'supabase/seed.sql'), sql);
    console.log('Generated supabase/seed.sql from the existing demo models.');
  } else {
    const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error('Configure a server-only Supabase secret key in .env.local first.');
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.rpc('zianecomms_seed_demo', { p_payload: payload });
    if (error) throw new Error(error.message);
    console.log(data ? 'Demo seeded successfully.' : 'Demo already populated; existing operator work was preserved.');
  }
} finally { await server.close(); }
