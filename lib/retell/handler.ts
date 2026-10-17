import { RetellInputError, normalizeRetell, parseRetellEnvelope } from './normalize';
import { verifyRetellSignature } from './signature';
import { ingestRetell } from './ingest';
import type { retellConfig } from './config';
import type { RpcClient } from '@/lib/persistence/repository';

const MAX_BYTES = 2 * 1024 * 1024;
const response = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function boundedBody(request: Request): Promise<string> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) throw new RangeError('Body too large');
  if (!request.body) throw new RetellInputError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); throw new RangeError('Body too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}
// Dependency boundary lets tests exercise the actual HTTP handler and actual SQL without paid calls.
export async function handleRetell(request: Request, dependencies: {
  config: () => ReturnType<typeof retellConfig>;
  client: () => RpcClient;
  afterIngest?: (callId: string) => Promise<unknown>;
}) {
  let config;
  try { config = dependencies.config(); }
  catch { return response(503, { error: 'Retell integration is not configured' }); }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return response(415, { error: 'JSON required' });
  let raw: string;
  try { raw = await boundedBody(request); }
  catch (error) { return response(error instanceof RangeError ? 413 : 400, { error: 'Invalid request body' }); }
  if (!verifyRetellSignature(raw, request.headers.get('x-retell-signature'), config.apiKey)) return response(401, { error: 'Invalid signature' });
  let intake;
  try {
    const payload: unknown = JSON.parse(raw);
    const envelope = parseRetellEnvelope(payload);
    if (envelope.agentId !== config.agentId) return response(403, { error: 'Agent is not configured for this endpoint' });
    // Only analyzed calls have the structured intake needed for safe ranking and repeat-contact matching.
    // Acknowledge earlier/other signed events; never create a second provisional case from them.
    if (envelope.event !== 'call_analyzed') return response(200, { received: true, ignored: true });
    intake = normalizeRetell(payload, config.rulebook, config.mapping);
  } catch { return response(400, { error: 'Invalid Retell payload' }); }
  try {
    const result = await ingestRetell(dependencies.client(), intake, config.encryptionKey);
    await dependencies.afterIngest?.(intake.callId);
    return response(200, { received: true, duplicate: result.duplicate });
  } catch {
    // No caller content, phone, raw payload, signature, secret or database details in logs/responses.
    console.error('Retell ingestion failed; delivery was not acknowledged');
    return response(503, { error: 'Persistence unavailable; retry delivery' });
  }
}
