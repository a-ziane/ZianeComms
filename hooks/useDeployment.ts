'use client';
import { useState, useEffect } from 'react';
import { DEFAULT_DEPLOYMENT, deployment, type DeploymentId } from '@/config/deployments';
const KEY = 'ziane-deployment';
export function useDeployment() {
  const [id, setId] = useState<DeploymentId>(DEFAULT_DEPLOYMENT);
  useEffect(() => {
    const update = () => { try { setId(deployment(localStorage.getItem(KEY) ?? DEFAULT_DEPLOYMENT).id); } catch { setId(DEFAULT_DEPLOYMENT); } };
    update(); window.addEventListener('storage', update); window.addEventListener(KEY, update);
    return () => { window.removeEventListener('storage', update); window.removeEventListener(KEY, update); };
  }, []);
  return { profile: deployment(id), selectDeployment: (next: DeploymentId) => {
    const valid = deployment(next); localStorage.setItem(KEY, valid.id); setId(valid.id); window.dispatchEvent(new Event(KEY));
  } };
}
