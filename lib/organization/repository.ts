import type { RpcClient } from '@/lib/persistence/repository';
import { PersistenceError } from '@/lib/persistence/repository';
import { activationIssues, publishableConfig, validateConfig, type OrganizationRecord, type OrganizationConfig, type ActiveOrganization } from './model';
export function organizationRepository(client:RpcClient){
 return {
  async list():Promise<OrganizationRecord[]> { const {data,error}=await client.rpc('zianecomms_organizations');if(error)throw new PersistenceError('Organization configuration unavailable.');return data as OrganizationRecord[]; },
  async write(id:string,revision:number,commandId:string,operation:'create'|'save'|'activate',config:OrganizationConfig):Promise<OrganizationRecord[]> {
   if(!/^org-[a-f0-9-]{36}$/.test(id)||!Number.isSafeInteger(revision)||revision<0||!/^[a-f0-9-]{36}$/i.test(commandId))throw Error('Invalid configuration operation');
   const draft=validateConfig(config,id);if(operation==='activate'&&activationIssues(draft).length)throw Error('Complete required configuration before activation');
   const {data,error}=await client.rpc('zianecomms_configure_organization',{p_id:id,p_expected_revision:revision,p_command_id:commandId,p_operation:operation,p_payload:{draft,...(operation==='activate'?{published:publishableConfig(draft)}:{})}});
   if(error)throw new PersistenceError('Configuration could not be saved. Reload and review before retrying.',error.code==='40001');
   return data as OrganizationRecord[];
  },
 };
}
export function activeSummaries(records:OrganizationRecord[]):ActiveOrganization[]{
 return records.filter(r=>r.active).map(r=>({id:r.id,name:r.active!.configuration.name,version:r.active!.version,rulebook:r.active!.configuration.rulebook,deploymentId:r.active!.configuration.deploymentId,matchingWeights:r.active!.configuration.matchingWeights,responderIds:r.active!.configuration.responders.map(x=>x.id)}));
}
