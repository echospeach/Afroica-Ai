// Client-side conversation history — localStorage only, nothing here ever
// touches the backend. This keeps the "we don't store your messages"
// privacy promise (see PRIVACY.md) intact regardless of which tier
// answered: the operator never sees this, only the user's own browser
// does. Image attachments are deliberately NOT persisted here (Pro-only,
// and base64 image data would blow through localStorage's ~5-10MB quota
// fast) — history only ever stores plain text.
const STORAGE_KEY = 'afroica_conversations';
const MAX_CONVERSATIONS = 50; // keeps localStorage usage bounded

function readAll(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  }catch(err){
    console.warn('Could not read saved conversation history:', err);
    return [];
  }
}

function writeAll(conversations){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  }catch(err){
    // Most likely quota exceeded — drop the oldest conversation and retry
    // once rather than silently losing the one currently being saved.
    console.warn('Could not save conversation history (storage full?):', err);
    if(conversations.length > 1){
      try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations.slice(0, -1))); }
      catch(err2){ /* give up quietly — history is a convenience, not core functionality */ }
    }
  }
}

export function loadAllConversations(){
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getConversation(id){
  return readAll().find((c) => c.id === id) || null;
}

export function generateConversationId(){
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function deriveTitle(text){
  if(!text) return 'New conversation';
  const clean = text.trim().replace(/\s+/g, ' ');
  return clean.length > 42 ? clean.slice(0, 42).trimEnd() + '…' : clean;
}

export function upsertConversation(id, title, messages){
  const all = readAll();
  const existingIndex = all.findIndex((c) => c.id === id);
  const record = { id, title, messages, updatedAt: Date.now() };
  if(existingIndex >= 0) all[existingIndex] = record;
  else all.unshift(record);
  writeAll(all.slice(0, MAX_CONVERSATIONS));
}

export function deleteConversation(id){
  writeAll(readAll().filter((c) => c.id !== id));
}
