// Same fetch-wrapper pattern as the main app's js/api.js, but with its own
// token storage key and base URL so an admin session and a regular user
// session on the same browser never collide.
//
// Auto-detects local vs. deployed the same way js/api.js does — update
// PRODUCTION_API_URL / PRODUCTION_MAIN_APP_URL if either deployed URL
// ever changes.
const PRODUCTION_API_URL = 'https://afroica-ai-production.up.railway.app';
const PRODUCTION_MAIN_APP_URL = 'https://afroica-ai.vercel.app';
const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);

export const API_BASE_URL = isLocalHost ? 'http://localhost:8000' : PRODUCTION_API_URL;
// Where the "Impersonate" handoff opens — the main consumer app.
export const MAIN_APP_URL = isLocalHost ? 'http://localhost:8080' : PRODUCTION_MAIN_APP_URL;

const TOKEN_KEY = 'afroica_admin_token';

export function getAdminToken(){
  return localStorage.getItem(TOKEN_KEY);
}

export function setAdminToken(token){
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAdminToken(){
  localStorage.removeItem(TOKEN_KEY);
}

export function isAdminLoggedIn(){
  return !!getAdminToken();
}

export async function adminFetch(path, options = {}){
  const headers = { ...(options.headers || {}) };
  const token = getAdminToken();
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
