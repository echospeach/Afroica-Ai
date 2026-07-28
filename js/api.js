// Base URL of the Python backend (see /backend). Auto-detects local vs.
// deployed so this never needs manual toggling (and can't be forgotten)
// when switching between local dev and the live site — update
// PRODUCTION_API_URL below if the backend's deployed URL ever changes.
const PRODUCTION_API_URL = 'https://afroica-ai-production.up.railway.app';
const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
export const API_BASE_URL = isLocalHost ? 'http://localhost:8000' : PRODUCTION_API_URL;

const TOKEN_KEY = 'afroica_token';

export function getToken(){
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token){
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(){
  localStorage.removeItem(TOKEN_KEY);
}

export function isLoggedIn(){
  return !!getToken();
}

// Wraps fetch() with the API base URL and bearer auth header. On a non-2xx
// response it throws an Error with `.status` and `.detail` (FastAPI's
// error shape) so callers can branch on status without re-parsing JSON.
export async function apiFetch(path, options = {}){
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if(token) headers['Authorization'] = `Bearer ${token}`;

  let body = options.body;
  if(body && typeof body !== 'string'){
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers, body });

  if(!res.ok){
    let detail = res.statusText;
    try{
      const data = await res.json();
      detail = data.detail || detail;
    }catch(err){ /* response body wasn't JSON */ }
    const error = new Error(detail);
    error.status = res.status;
    error.detail = detail;
    throw error;
  }

  return res;
}
