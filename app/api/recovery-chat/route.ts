import {createOperationsClient} from '@/lib/persistence/admin';
import {operatorAccess,operatorDenied} from '@/lib/security/operator-access';
import {sameRequestOrigin} from '@/lib/persistence/request-origin';
import {chatConfig} from '@/lib/retell-chat/config';
import {demoSession} from '@/lib/retell-chat/demo';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const response=(status:number,data:unknown)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function handle(request:Request,write:boolean){
 // Demo APIs always require operator access, even when integration env flags are accidentally removed.
 if(!operatorAccess(request.headers.get('authorization')))return operatorDenied();
 if(write&&!sameRequestOrigin(request.headers.get('origin'),request.headers.get('host')))return response(403,{error:'Cross-origin request rejected'});
 let config;try{config=chatConfig();}catch{return response(503,{error:'Recovery Chat configuration is incomplete'});}
 if(!config)return response(503,{error:'Recovery Chat is disabled'});
 let input;
 try{
  const text=write?await request.text():'';
  if(text.length>12000)return response(413,{error:'Message too large'});
  input=write?JSON.parse(text):Object.fromEntries(new URL(request.url).searchParams);
  if(typeof input.caseId!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(input.caseId))throw Error();
  if(write&&(!['start','send','end'].includes(input.action)||input.action==='send'&&
    (typeof input.content!=='string'||!input.content.trim()||input.content.length>4000||typeof input.requestId!=='string'||!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(input.requestId))))throw Error();
 }catch{return response(400,{error:'Invalid recovery operation'});}
 try{return response(200,await demoSession(createOperationsClient(),config,input.caseId,write?input:undefined));}
 catch{return response(409,{error:'Recovery could not complete. Reload to inspect the existing session before retrying. Check agent publishing, active case, and any pending turn in Retell.'});}
}
export async function GET(request:Request){return handle(request,false);}
export async function POST(request:Request){return handle(request,true);}
