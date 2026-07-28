import { apiFetch } from './api.js';

export async function startCheckout(plan){
  const res = await apiFetch('/billing/checkout', { method: 'POST', body: { plan } });
  const data = await res.json();
  window.location.href = data.url;
}

export async function openBillingPortal(){
  const res = await apiFetch('/billing/portal', { method: 'POST' });
  const data = await res.json();
  window.location.href = data.url;
}
