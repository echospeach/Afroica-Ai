import { apiFetch, clearToken, getToken, isLoggedIn, setToken } from './api.js';

export { getToken, isLoggedIn, setToken };

export async function signup(email, password){
  const res = await apiFetch('/auth/signup', { method: 'POST', body: { email, password } });
  const data = await res.json();
  setToken(data.access_token);
  return data;
}

export async function login(email, password){
  const res = await apiFetch('/auth/login', { method: 'POST', body: { email, password } });
  const data = await res.json();
  setToken(data.access_token);
  return data;
}

export function logout(){
  clearToken();
}

export async function fetchMe(){
  const res = await apiFetch('/auth/me');
  return res.json();
}

export async function deleteAccount(password){
  await apiFetch('/auth/me', { method: 'DELETE', body: { password } });
  clearToken();
}

export async function forgotPassword(email){
  await apiFetch('/auth/forgot-password', { method: 'POST', body: { email } });
}

export async function resetPassword(token, password){
  await apiFetch('/auth/reset-password', { method: 'POST', body: { token, password } });
}
