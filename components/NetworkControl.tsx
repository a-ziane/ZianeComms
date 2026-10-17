'use client';
import { useConnectivity } from '@/hooks/useConnectivity';
export default function NetworkControl() {
  const { online, simulated, setDemoOffline } = useConnectivity();
  return <div className="text-xs border border-amber-700/50 rounded p-3 space-y-2">
    <p className="font-semibold">DEMO network control · {online ? 'ONLINE' : 'OFFLINE'}{simulated ? ' (simulated)' : ''}</p>
    <button type="button" className="underline mr-4" onClick={() => setDemoOffline(true)}>SIMULATE OFFLINE</button>
    <button type="button" className="underline" onClick={() => setDemoOffline(false)}>RESTORE CONNECTION</button>
    <p className="text-slate-400">Uses the real device queue. Restoring simulation cannot restore a lost network.</p>
  </div>;
}
