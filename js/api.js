// Base URL of the Python backend (see /backend). Change this when you
// deploy the backend — see README for the Render/Neon setup steps.
export const API_BASE_URL = 'http://localhost:8000';

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
