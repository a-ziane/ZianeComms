import { deserializeSnapshot, serializeState, type DatabaseSnapshot } from './mapping';
import type { CaseState } from '@/lib/cases';

// One transaction boundary for cases, responders and all their audit projections.
export interface RpcClient {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}
export class PersistenceError extends Error {
  constructor(message: string, public readonly conflict = false) { super(message); }
}
export function operationsRepository(client: RpcClient) {
  return {
    async load(): Promise<{ state: CaseState; revision: number }> {
      const { data, error } = await client.rpc('zianecomms_load_demo');
      if (error) throw new PersistenceError(error.message);
      if (!data) throw new PersistenceError('Database demo is not seeded. Apply migrations and run npm run db:seed.');
      const snapshot = data as DatabaseSnapshot;
      return { state: deserializeSnapshot(snapshot), revision: snapshot.revision };
    },
    async wasApplied(mutationId: string) {
      const { data, error } = await client.rpc('zianecomms_mutation_applied', { p_mutation_id: mutationId });
      if (error) throw new PersistenceError(error.message);
      return data === true;
    },
    async save(state: CaseState, revision: number, mutationId: string) {
      const { error } = await client.rpc('zianecomms_save_demo', { p_expected_revision: revision,
        p_mutation_id: mutationId, p_payload: serializeState(state) });
      if (error) throw new PersistenceError(error.message, error.code === '40001');
      return this.load();
    },
    async seed(payload: unknown) {
      const { data, error } = await client.rpc('zianecomms_seed_demo', { p_payload: payload });
      if (error) throw new PersistenceError(error.message);
      return data;
    },
  };
}
