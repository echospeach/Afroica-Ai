import { apiFetch } from './api.js';

export async function fetchUsage(){
  const res = await apiFetch('/usage/me');
  return res.json();
}

// Throws (via apiFetch) with .status === 402 once the free daily cap is
// hit — callers should catch that specifically and show the upgrade
// prompt rather than blocking on any other kind of failure.
export async function incrementUsage(){
  const res = await apiFetch('/usage/increment', { method: 'POST' });
  return res.json();
}
