import { DEFAULT_DEPLOYMENT } from '@/config/deployments';
import type { Caller, Responder } from '@/types';
// Deployment scoping is input configuration; the generic matching calculation stays unchanged.
export function deploymentResponders(caller: Pick<Caller,'deploymentId'>, responders: Responder[]) {
  return responders.filter(r => (r.deploymentId ?? DEFAULT_DEPLOYMENT) === (caller.deploymentId ?? DEFAULT_DEPLOYMENT));
}
