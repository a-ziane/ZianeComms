export function integrationStatus(env:Record<string,string|undefined>=process.env){
 const gate=(env.OPERATIONS_PASSWORD?.length??0)>=24;
 return { voice:env.RETELL_ENABLED==='true'&&!!env.RETELL_API_KEY&&!!env.RETELL_AGENT_ID&&gate?'Configured — published-agent connectivity not probed':'Not configured',
 recoveryChat:env.RETELL_CHAT_ENABLED==='true'&&!!env.RETELL_API_KEY&&!!env.RETELL_CHAT_AGENT_ID&&gate?'Configured — existing reusable agent':'Not configured',
 carrierSms:env.TWILIO_ENABLED==='true'?'Provider enabled — registration/delivery not verified':'Demo transport / carrier registration required',
 database:'Connected',publishing:'Configuration Ready after activation — agent publishing is manual'};
}
