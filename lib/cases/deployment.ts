import { DEFAULT_DEPLOYMENT } from '@/config/deployments';
import type { Caller, Responder } from '@/types';
// Deployment scoping is input configuration; the generic matching calculation stays unchanged.
export function deploymentResponders(caller: Pick<Caller,'deploymentId'|'organizationId'>, responders: Responder[], activeOrganizations: import('@/lib/organization/model').ActiveOrganization[] = []) {
  const active = activeOrganizations.find(o => o.id === caller.organizationId);
  return responders.filter(r => (!active || active.responderIds.includes(r.id)) && (r.organizationId ?? 'zianecomms-demo') === (caller.organizationId ?? 'zianecomms-demo') && (r.deploymentId ?? DEFAULT_DEPLOYMENT) === (caller.deploymentId ?? DEFAULT_DEPLOYMENT));
}
