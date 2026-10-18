import type {Caller,Responder,Rulebook,DashboardMetrics} from '@/types';
import {TERMINAL_STATUSES} from '@/lib/cases';
export function workspaceMetrics(callers:Caller[],responders:Responder[],rulebook:Rulebook):DashboardMetrics{
 const active=callers.filter(c=>!TERMINAL_STATUSES.includes(c.status));
 return {incomingCalls:callers.length,answeredCalls:callers.filter(c=>c.source==='retell'&&c.retell?.event==='call_analyzed').length,
 missedCalls:active.length,recoveredCallers:callers.filter(c=>c.recoveryState?.provider==='retell-chat'&&c.recoveryState.hasSession).length,
 activeResponders:responders.filter(r=>r.rulebooks.includes(rulebook)&&r.status==='available').length,awaitingCallback:active.filter(c=>c.status==='awaiting_callback').length,
 priority0Count:active.filter(c=>c.priority===0).length,resolvedCases:callers.filter(c=>TERMINAL_STATUSES.includes(c.status)).length,
 averageWaitMinutes:active.length?Math.round(active.reduce((n,c)=>n+c.waitMinutes,0)/active.length):0,
 offlineRequests:callers.filter(c=>c.source==='offline_help_form').length,
 priorityDistribution:[0,1,2,3].map(p=>active.filter(c=>c.priority===p).length)};
}
