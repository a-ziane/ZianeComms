'use client';
import { useEffect, useState } from 'react';
const KEY = 'ziane-demo-offline';
const EVENT = 'ziane-connectivity';
export function simulatedOffline() { return typeof window !== 'undefined' && localStorage.getItem(KEY) === 'true'; }
export function connected() { return typeof navigator !== 'undefined' && navigator.onLine && !simulatedOffline(); }
export function setDemoOffline(value: boolean) {
  localStorage.setItem(KEY, String(value)); window.dispatchEvent(new Event(EVENT));
}
export function useConnectivity() {
  const [online, setOnline] = useState(true);
  const [simulated, setSimulated] = useState(false);
  useEffect(() => {
    const update = () => { setOnline(connected()); setSimulated(simulatedOffline()); };
    update();
    for (const event of ['online','offline','storage',EVENT]) window.addEventListener(event, update);
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/offline-sw.js').catch(() => {});
    return () => { for (const event of ['online','offline','storage',EVENT]) window.removeEventListener(event, update); };
  }, []);
  return { online, simulated, setDemoOffline };
}
