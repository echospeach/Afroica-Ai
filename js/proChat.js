// Talks to the Python backend's /chat/stream (Pro subscribers only) using
// Anthropic Messages API content-block shapes — distinct from the OpenAI-
// style shapes js/main.js builds for the local WebLLM engine, since the
// two paths never mix within a single page session (isPro() is decided
// once at sign-in).
import { API_BASE_URL, getToken } from './api.js';

function dataUrlToAnthropicImageBlock(dataUrl){
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if(!match) return null;
  const [, mediaType, data] = match;
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
}

export function buildAnthropicUserContent(text, imageDataUrl){
  if(!imageDataUrl) return text;
  const block = dataUrlToAnthropicImageBlock(imageDataUrl);
  const content = [{ type: 'text', text }];
  if(block) content.push(block);
  return content;
}

// Streams the reply as plain text chunks. Calls onChunk(fullTextSoFar) as
// each piece arrives; resolves with the complete reply text.
export async function streamProChat(messages, onChunk){
  const res = await fetch(`${API_BASE_URL}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ messages }),
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
