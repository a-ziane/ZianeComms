import { NextResponse,type NextRequest } from 'next/server';
import {operatorAccess,operatorDenied} from '@/lib/security/operator-access';
import {sameRequestOrigin} from '@/lib/persistence/request-origin';
import {createOperationsClient} from '@/lib/persistence/admin';
import {organizationRepository} from '@/lib/organization/repository';
import {activeDynamicVariables} from '@/lib/organization/dynamic-variables';
import {integrationStatus} from '@/lib/organization/status';
import {PersistenceError} from '@/lib/persistence/repository';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
export async function GET(request:NextRequest){
 if(!operatorAccess(request.headers.get('authorization')))return operatorDenied();
 try{const records=await organizationRepository(createOperationsClient()).list();return NextResponse.json({records,integrations:integrationStatus()},{headers});}
 catch{return NextResponse.json({error:'Organization configuration unavailable. Check migrations and connection.'},{status:503,headers});}
}
export async function POST(request:NextRequest){
 if(!operatorAccess(request.headers.get('authorization')))return operatorDenied();
 if(!sameRequestOrigin(request.headers.get('origin'),request.headers.get('host')))return NextResponse.json({error:'Cross-origin action rejected.'},{status:403,headers});
 let input;
 try{if(Number(request.headers.get('content-length')??0)>200000)throw Error();const raw=await request.text();if(raw.length>200000)throw Error();input=JSON.parse(raw);}
 catch{return NextResponse.json({error:'Invalid or oversized configuration.'},{status:400,headers});}
 try{
  const repo=organizationRepository(createOperationsClient());
  if(input.operation==='preview'){
   const record=(await repo.list()).find(r=>r.id===input.id);if(!record?.active)return NextResponse.json({error:'Activate an approved configuration first.'},{status:400,headers});
   return NextResponse.json({dynamicVariables:activeDynamicVariables(record.active),version:record.active.version,status:'Configuration Ready — preview only; no Retell call or publishing performed.'},{headers});
  }
  if(!['create','save','activate'].includes(input.operation))throw Error('Unknown operation');
  const records=await repo.write(input.id,input.revision,input.commandId,input.operation,input.config);
  return NextResponse.json({records,integrations:integrationStatus()},{headers});
 }catch(error){return NextResponse.json({error:error instanceof PersistenceError?'Configuration save not confirmed. Reload/review before retrying.':'Invalid configuration. Review required fields, safety questions and matching weights.'},{status:error instanceof PersistenceError?error.conflict?409:503:400,headers});}
}
