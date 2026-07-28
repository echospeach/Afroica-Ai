// Talks to the Python backend's /chat/free-stream — the free tier's fast
// path (an open-weight model on Groq's shared free quota, see
// backend/app/groq_llm.py). A 503 here is an expected, routine signal
// that Groq's shared quota is temporarily exhausted, not a real error —
// js/main.js catches that specifically and falls back to the on-device
// WebLLM engine.
import { API_BASE_URL, getToken } from './api.js';

// Streams the reply as plain text chunks. Calls onChunk(fullTextSoFar) as
// each piece arrives; resolves with the complete reply text. `signal`
// (an AbortSignal) is optional — pass one to support a "stop generating"
// button; aborting rejects with a DOMException named "AbortError".
export async function streamFreeChat(messages, onChunk, signal){
  const res = await fetch(`${API_BASE_URL}/chat/free-stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ messages }),
    signal,
  });

  if(!res.ok){
    let detail = res.statusText;
    try{ detail = (await res.json()).detail || detail; }catch(err){ /* not JSON */ }
    const error = new Error(detail);
    error.status = res.status;
    throw error;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  while(true){
    const { done, value } = await reader.read();
    if(done) break;
    full += decoder.decode(value, { stream: true });
    onChunk(full);
  }
  return full;
}
