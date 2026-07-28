// Small in-memory cache of "who is signed in and are they Pro" — refreshed
// after login and after each usage-affecting action, read by main.js to
// decide which chat path (local WebLLM vs. server-side Pro) to use.
import { fetchMe, isLoggedIn } from './auth.js';
import { fetchUsage } from './usage.js';

let currentUser = null; // { id, email, is_pro }
let currentUsage = null; // { date, count, limit, is_pro, remaining }

export function getUser(){ return currentUser; }
export function getUsage(){ return currentUsage; }
export function isPro(){ return !!(currentUser && currentUser.is_pro); }
export function setUsage(usage){ currentUsage = usage; }

export async function refreshAccount(){
  if(!isLoggedIn()){
    currentUser = null;
    currentUsage = null;
    return null;
  }
  currentUser = await fetchMe();
  currentUsage = await fetchUsage();
  return currentUser;
}
