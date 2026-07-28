// ---------------------------------------------------------------
// AFROICA AI — ENTRY POINT
//
// Free tier: fast by default, routing chat through the backend to an
// open-weight model on Groq's free, no-card-required tier (js/freeChat.js)
// — zero cost, shared org-wide across every free user. Automatically
// falls back to a (text-only) model running entirely on-device via
// WebGPU/WebLLM (js/engine.js) if Groq's shared quota is ever exhausted —
// slower, but still genuinely free no matter how much it's used, so the
// free tier never actually breaks even under heavy load.
//
// Pro tier: routes chat through the backend to a fast, vision-capable
// hosted Claude model instead — funded by the subscription. Image
// understanding is Pro-only: neither free-tier path (Groq or WebLLM)
// supports it.
//
// Behavior/persona is controlled by persona.json (see js/persona.js and
// tools/persona_builder.py) — the on-device model, the backend's Groq
// path, and the backend's Claude path all build an equivalent system
// prompt from that same file.
// ---------------------------------------------------------------
import * as webllm from "https://esm.run/@mlc-ai/web-llm";
import { createEngine } from './engine.js';
import { loadPersona, buildSystemPrompt } from './persona.js';
import { resizeImageFile } from './image.js';
import { createVoiceController } from './voice.js';
import { createChatView, makeHero } from './chat.js';
import { signup, login, logout, isLoggedIn, setToken, getToken, deleteAccount, forgotPassword, resetPassword } from './auth.js';
import { refreshAccount, getUser, getUsage, isPro, setUsage } from './account.js';
import { incrementUsage } from './usage.js';
import { startCheckout, openBillingPortal } from './billing.js';
import { buildAnthropicUserContent, streamProChat } from './proChat.js';
import { streamFreeChat } from './freeChat.js';
import { applyTheme, getStoredTheme } from './theme.js';
import {
  loadAllConversations, getConversation, generateConversationId,
  deriveTitle, upsertConversation, deleteConversation
} from './history.js';

const chatInner = document.getElementById('chatInner');
const chatScroll = document.getElementById('chatScroll');
const promptInput = document.getElementById('promptInput');
const sendBtn = document.getElementById('sendBtn');
const sendIcon = sendBtn.querySelector('.send-icon');
const stopIcon = sendBtn.querySelector('.stop-icon');
const newChatBtn = document.getElementById('newChatBtn');
const historyList = document.getElementById('historyList');
const sidebar = document.querySelector('.sidebar');
const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const loadBanner = document.getElementById('loadBanner');
const loadLabel = document.getElementById('loadLabel');
const loadPercent = document.getElementById('loadPercent');
const loadFill = document.getElementById('loadFill');
const attachBtn = document.getElementById('attachBtn');
const imageInput = document.getElementById('imageInput');
const micBtn = document.getElementById('micBtn');
const attachPreview = document.getElementById('attachPreview');
const attachPreviewImg = document.getElementById('attachPreviewImg');
const attachName = document.getElementById('attachName');
const attachRemoveBtn = document.getElementById('attachRemoveBtn');

const authGate = document.getElementById('authGate');
const authFormWrap = document.getElementById('authFormWrap');
const connectionError = document.getElementById('connectionError');
const connectionRetryBtn = document.getElementById('connectionRetryBtn');
const authForm = document.getElementById('authForm');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const authToggleModeBtn = document.getElementById('authToggleModeBtn');
const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
const authError = document.getElementById('authError');
const usageLabel = document.getElementById('usageLabel');
const upgradeBtn = document.getElementById('upgradeBtn');
const accountEmail = document.getElementById('accountEmail');
const proBadge = document.getElementById('proBadge');
const logoutBtn = document.getElementById('logoutBtn');
const deleteAccountBtn = document.getElementById('deleteAccountBtn');
const pricingModal = document.getElementById('pricingModal');
const pricingCloseBtn = document.getElementById('pricingCloseBtn');
const pricingError = document.getElementById('pricingError');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');
const themeGrid = document.getElementById('themeGrid');

const chat = createChatView(chatInner, chatScroll, { onRegenerate: () => regenerateLastReply() });

let engine = null;
let modelReady = false; // true once the on-device WebLLM fallback has finished loading
let usingFallback = false; // true once Groq's fast path has failed once this session — sticky for the rest of it, rather than re-trying a possibly-still-exhausted shared quota on every message
let generating = false;
// "Stop generating" support. activeAbortController covers the two
// fetch-based paths (Groq, Pro/Claude) — created fresh per request, torn
// down when it ends however it ends. The on-device WebLLM path has its
// own cancellation mechanism (engine.interruptGenerate()) rather than a
// signal, since it isn't a fetch. stopRequested distinguishes "the user
// deliberately stopped this" from a real failure, so the catch blocks
// below can show "stopped" instead of a scary error message.
let activeAbortController = null;
let stopRequested = false;
let pendingImage = null; // { dataUrl, name }
// messages[0] is always the system prompt — kept as a real entry from the
// start (filled in once persona.json loads) so `messages.length = 1` in
// newChatBtn's handler can never leave a hole there. Pro-tier sends skip
// this entry (the backend builds its own system prompt from persona.json).
const messages = [{ role: 'system', content: '' }];

// Chat history (js/history.js, localStorage-only — see its header comment
// on the privacy reasoning). historyMessages is a plain-text parallel to
// `messages` — never includes the system prompt or image data, just what
// gets saved/restored. currentConversationId is null until the first
// message of a new conversation is recorded.
let currentConversationId = null;
let historyMessages = []; // [{role:'user'|'ai', text}]

// Free tier no longer needs anything pre-loaded — Groq's fast path (the
// default) is ready the instant you're authenticated. Only blocked while
// actively loading the on-device fallback, and only once we know we need it.
function isInteractive(){
  if(generating) return false;
  if(isPro()) return true;
  if(usingFallback) return modelReady;
  return true;
}

function updateSendState(){
  sendIcon.classList.toggle('hidden', generating);
  stopIcon.classList.toggle('hidden', !generating);
  if(generating){
    // Always clickable while generating — it's now the stop button, not
    // gated by the same "is there something to send" logic below.
    sendBtn.disabled = false;
    sendBtn.setAttribute('aria-label', 'Stop generating');
    return;
  }
  sendBtn.setAttribute('aria-label', 'Send message');
  sendBtn.disabled = (promptInput.value.trim().length === 0 && !pendingImage) || !isInteractive();
}

function setStatus(state, text){
  statusDot.className = 'status-dot' + (state ? ' ' + state : '');
  statusText.textContent = text;
}

function hideLoadBanner(){
  loadBanner.classList.add('hidden');
}

function showLoadError(msg){
  loadBanner.classList.remove('hidden');
  loadBanner.classList.add('error');
  loadLabel.textContent = msg;
  loadPercent.textContent = '';
  loadFill.style.width = '100%';
  setStatus('error', 'Model unavailable');
}

function autosize(){
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 160) + 'px';
}

// allowImages: the free tier's on-device model (js/engine.js) is text-only
// — image understanding is a Pro-only feature, since that runs server-side
// against a vision-capable model instead.
function enableChatUI(allowImages){
  promptInput.disabled = false;
  promptInput.placeholder = 'Message Afroica AI...';
  attachBtn.disabled = !allowImages;
  attachBtn.title = allowImages ? '' : 'Image understanding is a Pro feature';
  if(voice.supported) micBtn.disabled = false;
  promptInput.focus();
}

// ---- Image attach ----
function showAttachPreview(){
  if(!pendingImage){
    attachPreview.classList.add('hidden');
    return;
  }
  attachPreviewImg.src = pendingImage.dataUrl;
  attachName.textContent = pendingImage.name;
  attachPreview.classList.remove('hidden');
}

attachBtn.addEventListener('click', () => {
  if(!isInteractive()) return;
  imageInput.click();
});

imageInput.addEventListener('change', async () => {
  const file = imageInput.files && imageInput.files[0];
  imageInput.value = '';
  if(!file || !file.type.startsWith('image/')) return;
  try{
    const dataUrl = await resizeImageFile(file);
    pendingImage = { dataUrl, name: file.name };
    showAttachPreview();
  }catch(err){
    console.error(err);
  }
  updateSendState();
});

attachRemoveBtn.addEventListener('click', () => {
  pendingImage = null;
  showAttachPreview();
  updateSendState();
});

// ---- Voice input ----
const voice = createVoiceController({
  micBtn,
  promptInput,
  canListen: () => isInteractive(),
  onChange: (value) => {
    promptInput.value = value;
    autosize();
    updateSendState();
  },
  onStop: () => {
    if(isInteractive()) promptInput.placeholder = 'Message Afroica AI...';
    promptInput.focus();
  }
});

// ---- Account / usage UI ----
function renderAccountUI(){
  const user = getUser();
  const usage = getUsage();
  if(!user || !usage) return;

  accountEmail.textContent = user.email;
  upgradeBtn.disabled = false;
  proBadge.classList.toggle('hidden', !usage.is_pro);
  upgradeBtn.classList.toggle('pro-tag', usage.is_pro);

  if(usage.is_pro){
    usageLabel.textContent = user.plan ? `${user.plan} · unlimited` : 'Pro · unlimited';
    upgradeBtn.textContent = 'Manage plan';
  }else{
    usageLabel.textContent = `${usage.remaining}/${usage.limit} messages left today`;
    upgradeBtn.textContent = 'Upgrade';
  }
}

upgradeBtn.addEventListener('click', () => {
  if(isPro()){
    openBillingPortal().catch((err) => console.error(err));
  }else{
    showPricingModal();
  }
});

logoutBtn.addEventListener('click', () => {
  logout();
  window.location.reload();
});

deleteAccountBtn.addEventListener('click', async () => {
  const password = window.prompt(
    'This permanently deletes your account and cannot be undone. Enter your password to confirm:'
  );
  if(!password) return;
  try{
    await deleteAccount(password);
    window.location.reload();
  }catch(err){
    window.alert(err.detail || err.message || 'Could not delete your account.');
  }
});

// ---- Pricing modal ----
function showPricingModal(){
  pricingError.textContent = '';
  pricingModal.classList.remove('hidden');
}
function hidePricingModal(){
  pricingModal.classList.add('hidden');
}
pricingCloseBtn.addEventListener('click', hidePricingModal);

document.querySelectorAll('.upgrade-choice-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    pricingError.textContent = '';
    btn.disabled = true;
    try{
      await startCheckout(btn.dataset.plan);
    }catch(err){
      console.error(err);
      pricingError.textContent = err.detail || err.message || 'Could not start checkout.';
      btn.disabled = false;
    }
  });
});

// ---- Settings modal (theme picker) ----
function markActiveThemeSwatch(){
  const current = getStoredTheme();
  themeGrid.querySelectorAll('.theme-swatch').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === current);
  });
}
function showSettingsModal(){
  markActiveThemeSwatch();
  settingsModal.classList.remove('hidden');
}
function hideSettingsModal(){
  settingsModal.classList.add('hidden');
}
settingsBtn.addEventListener('click', showSettingsModal);
settingsCloseBtn.addEventListener('click', hideSettingsModal);

themeGrid.querySelectorAll('.theme-swatch').forEach((btn) => {
  btn.addEventListener('click', () => {
    applyTheme(btn.dataset.theme);
    markActiveThemeSwatch();
  });
});

// ---- Auth gate ----
function showAuthGate(){
  authGate.classList.remove('hidden');
  authFormWrap.classList.remove('hidden');
  connectionError.classList.add('hidden');
}
function hideAuthGate(){ authGate.classList.add('hidden'); }

// Shown instead of the sign-in form when a stored session couldn't be
// verified because the backend was unreachable (not because the token
// was actually invalid) — a blank login form in that situation reads as
// "you got logged out," which isn't true, so say so explicitly instead.
function showConnectionError(){
  authGate.classList.remove('hidden');
  authFormWrap.classList.add('hidden');
  connectionError.classList.remove('hidden');
}

let authMode = 'signup';

authToggleModeBtn.addEventListener('click', () => {
  authMode = authMode === 'signup' ? 'login' : 'signup';
  authSubmitBtn.textContent = authMode === 'signup' ? 'Sign up' : 'Log in';
  authToggleModeBtn.textContent = authMode === 'signup'
    ? 'Already have an account? Log in'
    : 'New here? Sign up';
  authError.textContent = '';
});

forgotPasswordBtn.addEventListener('click', async () => {
  const email = window.prompt("Enter your account email — we'll send a reset link if it exists:");
  if(!email) return;
  try{
    await forgotPassword(email);
  }catch(err){
    console.error(err);
  }finally{
    // Same response either way — confirming or denying an email exists
    // would let anyone probe the user list.
    window.alert('If an account exists for that email, a reset link has been sent.');
  }
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';
  authSubmitBtn.disabled = true;
  try{
    if(authMode === 'signup') await signup(authEmail.value, authPassword.value);
    else await login(authEmail.value, authPassword.value);
    hideAuthGate();
    await onAuthenticated();
  }catch(err){
    authError.textContent = err.detail || err.message || 'Something went wrong.';
  }finally{
    authSubmitBtn.disabled = false;
  }
});

// ---- Model loading (on-device fallback only — triggered lazily, see
// sendFreeMessage, only if Groq's free fast path is ever unavailable) ----
async function loadSystemPrompt(){
  const persona = await loadPersona();
  messages[0].content = buildSystemPrompt(persona);
}

// Not called until sendFreeMessage() actually needs the fallback — Groq
// (the default free-tier path) needs nothing pre-loaded, so eagerly
// downloading a multi-hundred-MB model nobody may ever need would just
// slow down opening the app for the common case. Idempotent: safe to call
// again without restarting an in-flight or already-finished download.
let modelInitPromise = null;

function initModel(){
  if(modelInitPromise) return modelInitPromise;
  modelInitPromise = (async () => {
    if(!navigator.gpu){
      showLoadError('This browser has no WebGPU support — try latest Chrome or Edge on desktop.');
      return;
    }
    try{
      engine = await createEngine(webllm, (progress) => {
        const pct = Math.round((progress.progress || 0) * 100);
        loadPercent.textContent = pct + '%';
        loadFill.style.width = pct + '%';
        // WebLLM's own progress.text is a raw, wordy internal status
        // ("Fetching param cache[8/58]: 217MB fetched...") — a clean fixed
        // label reads far better than surfacing that verbatim.
        loadLabel.textContent = 'Loading Afroica AI…';
        setStatus('loading', 'Loading model…');
      });
      modelReady = true;
      hideLoadBanner();
    }catch(err){
      console.error(err);
      showLoadError('Could not load the model. Check the console for details.');
    }
  })();
  return modelInitPromise;
}

async function onAuthenticated(){
  await refreshAccount();
  renderAccountUI();

  if(isPro()){
    hideLoadBanner();
    setStatus(null, 'Ready · Pro · fast server-side responses');
    enableChatUI(true);
  }else{
    // Groq's fast path needs no preload — ready immediately. The
    // on-device fallback only loads lazily if that path ever fails.
    hideLoadBanner();
    setStatus(null, 'Ready · fast mode');
    enableChatUI(false);
  }
}

// ---- Chat history (sidebar) ----
function renderHistoryList(){
  const conversations = loadAllConversations();
  historyList.innerHTML = '';

  if(conversations.length === 0){
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = 'No saved conversations yet — start typing below.';
    historyList.appendChild(empty);
    return;
  }

  conversations.forEach((conv) => {
    const item = document.createElement('div');
    item.className = 'history-item' + (conv.id === currentConversationId ? ' active' : '');

    const title = document.createElement('span');
    title.className = 'history-item-title';
    title.textContent = conv.title;
    item.appendChild(title);

    const del = document.createElement('button');
    del.className = 'history-item-delete';
    del.type = 'button';
    del.setAttribute('aria-label', 'Delete conversation');
    del.textContent = '✕';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if(!window.confirm("Delete this conversation? This can't be undone.")) return;
      deleteConversation(conv.id);
      if(conv.id === currentConversationId) startNewConversation();
      renderHistoryList();
    });
    item.appendChild(del);

    item.addEventListener('click', () => loadConversationIntoView(conv.id));
    historyList.appendChild(item);
  });
}

function startNewConversation(){
  currentConversationId = null;
  historyMessages = [];
  messages.length = 1; // keep system prompt, drop the rest
}

function loadConversationIntoView(id){
  if(generating) return; // don't yank the view out from under an in-flight reply
  const conv = getConversation(id);
  if(!conv) return;

  if(voice.isListening()) voice.stop();
  chat.clear();
  currentConversationId = conv.id;
  historyMessages = conv.messages.map((m) => ({ ...m }));

  // Rebuild the API-format messages array (system prompt + plain turns).
  // Pro image content isn't restorable — it was never persisted in the
  // first place, see js/history.js.
  messages.length = 1;
  historyMessages.forEach((m) => {
    messages.push({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text });
    chat.addMessage(m.text, m.role, null);
  });

  pendingImage = null;
  showAttachPreview();
  updateSendState();
  renderHistoryList();
  closeSidebar();
}

function recordUserMessage(text){
  historyMessages.push({ role: 'user', text });
  saveCurrentConversation();
}

function recordAssistantMessage(text){
  historyMessages.push({ role: 'ai', text });
  saveCurrentConversation();
}

function saveCurrentConversation(){
  if(historyMessages.length === 0) return;
  if(!currentConversationId) currentConversationId = generateConversationId();
  const firstUser = historyMessages.find((m) => m.role === 'user');
  upsertConversation(currentConversationId, deriveTitle(firstUser ? firstUser.text : ''), historyMessages);
  renderHistoryList();
}

// ---- Sending messages ----
// skipUserMessage: true when regenerating (see regenerateLastReply) — the
// user message is already on screen and already recorded, so re-adding it
// would show/save a duplicate.
function beginSend(displayText, imageForMessage, opts = {}){
  const { skipUserMessage = false } = opts;
  if(!skipUserMessage){
    const hero = document.getElementById('heroState');
    if(hero) hero.remove();

    chat.addMessage(displayText, 'user', imageForMessage ? imageForMessage.dataUrl : null);
    recordUserMessage(displayText);

    pendingImage = null;
    showAttachPreview();

    promptInput.value = '';
    promptInput.style.height = 'auto';
  }
  generating = true;
  stopRequested = false;
  updateSendState();
  setStatus('loading', 'Thinking…');

  chat.addTyping();
}

function stopGenerating(){
  if(!generating) return;
  stopRequested = true;
  if(activeAbortController) activeAbortController.abort();
  if(engine && typeof engine.interruptGenerate === 'function') engine.interruptGenerate();
}

function endSend(readyStatusText){
  chat.resetStreaming();
  generating = false;
  setStatus(null, readyStatusText);
  updateSendState();
}

// WebGPU can lose the device mid-session (most often the GPU running out
// of VRAM) — WebLLM then throws ModelNotLoadedError on the next request
// instead of the original device-lost error. Recognize both so the app
// can reset its "model is ready" state instead of repeatedly retrying a
// dead engine.
function isGpuDeviceLostError(err){
  const msg = String((err && err.message) || err || '');
  return /device was lost|devicelostinfo|modelnotloadederror|out ?of ?memory/i.test(msg);
}

// The on-device fallback (only reached if Groq's fast path is
// unavailable — see sendFreeMessage). Loads the model first if it isn't
// already ready, then generates locally exactly as before this feature.
async function sendViaWebLLM(){
  if(!modelReady){
    loadBanner.classList.remove('hidden');
    loadBanner.classList.remove('error');
    loadLabel.textContent = 'Fast mode is busy — switching to on-device mode…';
    loadPercent.textContent = '0%';
    loadFill.style.width = '0%';
    setStatus('loading', 'Loading on-device model…');
    await initModel();
    if(!modelReady){
      // initModel() already showed its own error via showLoadError().
      chat.removeTyping();
      chat.addMessage('Could not load the on-device fallback either — please try again in a moment.', 'ai');
      endSend('Model unavailable');
      return;
    }
  }

  let started = false;
  let fullReply = '';

  try{
    const stream = await engine.chat.completions.create({
      messages,
      stream: true,
      temperature: 0.7,
    });

    for await (const chunk of stream){
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if(!delta) continue;
      if(!started){
        chat.removeTyping();
        started = true;
      }
      fullReply += delta;
      chat.renderStreamingReply(fullReply);
    }

    if(!started){
      chat.removeTyping();
      fullReply = fullReply || "I didn't manage to generate a reply — try rephrasing that.";
      chat.addMessage(fullReply, 'ai');
    }

    messages.push({ role: 'assistant', content: fullReply });
    recordAssistantMessage(fullReply);
  }catch(err){
    // engine.interruptGenerate() (see stopGenerating) may end the stream
    // cleanly (falling into the success branch above with whatever text
    // had streamed in) or may throw, depending on exactly when it lands —
    // handle both: a deliberate stop should never show a scary error.
    if(stopRequested){
      chat.removeTyping();
      if(fullReply){
        messages.push({ role: 'assistant', content: fullReply });
        recordAssistantMessage(fullReply);
      }
    }else{
      console.error(err);
      chat.removeTyping();
      if(isGpuDeviceLostError(err)){
        // The engine object still exists but is no longer usable — clear
        // it out so the next attempt reloads a fresh one instead of
        // repeatedly hitting the same dead device.
        engine = null;
        modelReady = false;
        modelInitPromise = null;
        chat.addMessage(
          'Your GPU ran out of memory and the on-device model was unloaded. Close other GPU-heavy tabs/apps, then refresh this page to reload it.',
          'ai'
        );
      }else{
        chat.addMessage('Something went wrong generating a reply on-device. Check the console for details.', 'ai');
      }
    }
  }finally{
    endSend(modelReady ? 'Ready · running on your device' : 'Model unloaded — refresh the page to reload it');
  }
}

// Free tier's default path: the backend's Groq-backed fast lane (see
// js/freeChat.js) — no client-side loading at all. Falls back to the
// on-device model only if Groq signals its shared free quota is
// unavailable (503) — see sendViaWebLLM above. Image attachments never
// reach here — free tier's attach button is Pro-gated (see enableChatUI).
async function sendFreeMessage(displayText, opts = {}){
  beginSend(displayText, null, opts);
  if(!opts.skipUserMessage){
    messages.push({ role: 'user', content: displayText });
  }

  if(!usingFallback){
    const payload = messages.slice(1).map((m) => ({ role: m.role, content: m.content }));
    let started = false;
    let lastPartial = '';
    activeAbortController = new AbortController();
    try{
      const fullReply = await streamFreeChat(payload, (partial) => {
        lastPartial = partial;
        if(!started){
          chat.removeTyping();
          started = true;
        }
        chat.renderStreamingReply(partial);
      }, activeAbortController.signal);
      if(!started){
        chat.removeTyping();
        chat.addMessage(fullReply || "I didn't manage to generate a reply — try rephrasing that.", 'ai');
      }
      messages.push({ role: 'assistant', content: fullReply });
      recordAssistantMessage(fullReply);
      endSend('Ready · fast mode');
      return;
    }catch(err){
      if(stopRequested || err.name === 'AbortError'){
        // User-initiated stop — finalize whatever text streamed in before
        // the abort as a normal (if incomplete) reply, not an error.
        chat.removeTyping();
        if(lastPartial){
          messages.push({ role: 'assistant', content: lastPartial });
          recordAssistantMessage(lastPartial);
        }
        endSend('Ready · fast mode');
        return;
      }
      if(err.status === 429){
        chat.removeTyping();
        chat.addMessage("You've hit today's free daily limit — upgrade to Pro for unlimited messages, or try again tomorrow.", 'ai');
        endSend('Ready · fast mode');
        showPricingModal();
        return;
      }
      if(err.status !== 503){
        console.error(err);
        chat.removeTyping();
        chat.addMessage('Something went wrong reaching the server. Check the console for details.', 'ai');
        endSend('Ready · fast mode');
        return;
      }
      // 503: Groq's shared free quota is temporarily exhausted — a
      // routine, expected fallback trigger, not a real error. The
      // backend never incremented today's usage count for a rejected
      // attempt, so do it here instead, same as the Groq-success path
      // does server-side — a fallback message should still count
      // against the daily free cap.
      console.warn('Fast mode unavailable, switching to on-device fallback for this session:', err);
      usingFallback = true;
      try{
        const usage = await incrementUsage();
        setUsage(usage);
        renderAccountUI();
      }catch(usageErr){
        if(usageErr.status === 402){
          chat.removeTyping();
          showPricingModal();
          endSend('Ready · fast mode');
          return;
        }
        console.error('Usage check failed, continuing with on-device fallback anyway:', usageErr);
      }
    }finally{
      activeAbortController = null;
    }
  }

  await sendViaWebLLM();
}

async function sendProMessage(displayText, imageForMessage, opts = {}){
  beginSend(displayText, imageForMessage, opts);

  if(!opts.skipUserMessage){
    const content = buildAnthropicUserContent(displayText, imageForMessage ? imageForMessage.dataUrl : null);
    messages.push({ role: 'user', content });
  }

  let started = false;
  let lastPartial = '';
  activeAbortController = new AbortController();

  try{
    // messages[0] is the local placeholder system entry — the backend
    // builds its own system prompt from persona.json, so it's never sent.
    const payload = messages.slice(1).map((m) => ({ role: m.role, content: m.content }));
    const fullReply = await streamProChat(payload, (partial) => {
      lastPartial = partial;
      if(!started){
        chat.removeTyping();
        started = true;
      }
      chat.renderStreamingReply(partial);
    }, activeAbortController.signal);

    if(!started){
      chat.removeTyping();
      chat.addMessage(fullReply || "I didn't manage to generate a reply — try rephrasing that.", 'ai');
    }
    messages.push({ role: 'assistant', content: fullReply });
    recordAssistantMessage(fullReply);
  }catch(err){
    if(stopRequested || err.name === 'AbortError'){
      // User-initiated stop — finalize whatever text streamed in before
      // the abort as a normal (if incomplete) reply, not an error.
      chat.removeTyping();
      if(lastPartial){
        messages.push({ role: 'assistant', content: lastPartial });
        recordAssistantMessage(lastPartial);
      }
    }else{
      console.error(err);
      chat.removeTyping();
      if(err.status === 402){
        chat.addMessage('Your Pro subscription looks inactive — refresh the page or check your billing.', 'ai');
      }else if(err.status === 429){
        chat.addMessage("You've hit today's fair-use limit — try again tomorrow.", 'ai');
      }else{
        chat.addMessage('Something went wrong reaching the server. Check the console for details.', 'ai');
      }
    }
  }finally{
    activeAbortController = null;
    endSend('Ready · Pro · fast server-side responses');
  }
}

async function sendMessage(){
  const text = promptInput.value.trim();
  if((!text && !pendingImage) || !isInteractive()) return;
  if(voice.isListening()) voice.stop();

  const imageForMessage = pendingImage;
  const displayText = text || (imageForMessage ? 'Describe this image.' : '');

  if(isPro()) await sendProMessage(displayText, imageForMessage);
  else await sendFreeMessage(displayText);
}

// Re-asks the last user message, replacing the last AI reply in place
// (DOM, API-format `messages`, and saved history all get the trailing
// assistant entry popped first). Only ever offered on the most recent
// reply — see chat.js's markLatestAi() — so there's no ambiguity about
// what "regenerate" means. Note: if that last exchange included an image
// (Pro only), the image itself isn't restorable — it was never persisted
// in history — so a regenerated reply to an image question re-asks as
// text-only, which can change the answer. An accepted, documented
// limitation rather than a bug.
async function regenerateLastReply(){
  if(generating) return;
  const lastUser = [...historyMessages].reverse().find((m) => m.role === 'user');
  if(!lastUser) return;

  chat.removeLastAiMessage();
  if(historyMessages.length && historyMessages[historyMessages.length - 1].role === 'ai'){
    historyMessages.pop();
  }
  if(messages.length && messages[messages.length - 1].role === 'assistant'){
    messages.pop();
  }
  saveCurrentConversation();

  if(isPro()) await sendProMessage(lastUser.text, null, { skipUserMessage: true });
  else await sendFreeMessage(lastUser.text, { skipUserMessage: true });
}

// ---- Wiring ----
promptInput.addEventListener('input', () => {
  autosize();
  updateSendState();
});
promptInput.addEventListener('keydown', (e) => {
  if(e.key === 'Enter' && !e.shiftKey){
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', () => {
  if(generating) stopGenerating();
  else sendMessage();
});

// ---- Mobile sidebar drawer (hidden off-canvas below 720px — see style.css) ----
function openSidebar(){
  sidebar.classList.add('open');
  sidebarBackdrop.classList.add('open');
}
function closeSidebar(){
  sidebar.classList.remove('open');
  sidebarBackdrop.classList.remove('open');
}
sidebarToggleBtn.addEventListener('click', () => {
  sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
});
sidebarBackdrop.addEventListener('click', closeSidebar);

newChatBtn.addEventListener('click', () => {
  if(generating) return;
  if(voice.isListening()) voice.stop();
  chat.clear();
  chatInner.appendChild(makeHero());
  startNewConversation();
  pendingImage = null;
  showAttachPreview();
  updateSendState();
  renderHistoryList();
  closeSidebar();
});

// Populate the sidebar with whatever's already saved — history is
// per-browser (localStorage), not tied to being logged in, so this runs
// unconditionally rather than waiting on auth.
renderHistoryList();

// ---- Boot ----
// Admin "impersonate" handoff: the admin dashboard opens this app with
// ?impersonate_token=<a real user access token> in a new tab. Treat it
// exactly like a completed login, then scrub it from the URL — it's a
// real credential and shouldn't linger in the address bar.
const bootUrl = new URL(window.location.href);
const impersonateToken = bootUrl.searchParams.get('impersonate_token');
// Forgot-password handoff: the emailed link is this page with
// ?reset_token=<one-time token>. Scrub it from the URL immediately —
// same reasoning as the impersonate token above — and prompt for a new
// password once boot() runs.
const resetToken = bootUrl.searchParams.get('reset_token');
// Stripe Checkout redirect: ?checkout=success or ?checkout=cancelled.
// Read it before scrubbing the URL — boot() uses it below to confirm the
// subscription once the account reloads.
const checkoutStatus = bootUrl.searchParams.get('checkout');
if(impersonateToken){
  setToken(impersonateToken);
  bootUrl.searchParams.delete('impersonate_token');
  window.history.replaceState({}, '', bootUrl);
}else if(resetToken){
  bootUrl.searchParams.delete('reset_token');
  window.history.replaceState({}, '', bootUrl);
}else if(checkoutStatus){
  const url = new URL(window.location.href);
  url.search = '';
  window.history.replaceState({}, '', url);
}

// Decodes (never verifies — that's the server's job) the stored token's
// own expiry claim and logs it, purely as a diagnostic. If a "why did it
// log me out" report ever comes up again, this turns "guess and re-test"
// into "check the console, see immediately whether the token had
// genuinely expired or something else (network, CORS, server) was at fault."
function logTokenDiagnostics(){
  const token = getToken();
  if(!token) return;
  try{
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    const expiresAt = payload.exp ? new Date(payload.exp * 1000) : null;
    const isExpired = expiresAt ? expiresAt.getTime() < Date.now() : null;
    console.info(
      '[auth] stored token expires:', expiresAt ? expiresAt.toISOString() : 'unknown',
      isExpired === null ? '' : isExpired ? '(ALREADY EXPIRED)' : '(still valid)'
    );
  }catch(err){
    console.warn('[auth] stored token could not be decoded for diagnostics (may be malformed):', err);
  }
}

// Stripe's webhook can take a moment to reach the backend — poll briefly
// for the subscription to land instead of telling someone who just paid
// that they're still on the free plan.
async function confirmCheckoutSuccess(){
  for(let attempt = 0; attempt < 5 && !isPro(); attempt++){
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try{
      await refreshAccount();
      renderAccountUI();
    }catch(err){
      console.warn('Retry while confirming subscription:', err);
    }
  }
  if(isPro()){
    window.alert(`Subscription successful — you're now on ${getUser().plan || 'Pro'}!`);
  }else{
    window.alert("Payment received! Activation is taking a little longer than usual — refresh the page in a moment if your plan hasn't updated yet.");
  }
}

// Tries to load the signed-in account, retrying on anything that isn't a
// definitive "this token is bad" response. Returns true on success. On a
// real 401 it signs out (correct — no amount of retrying fixes a bad
// token) and returns false. On anything else (network error, backend
// unreachable, CORS hiccup) it leaves the token alone and just returns
// false — the caller decides what to show for that case.
async function tryRestoreSession(maxAttempts){
  for(let attempt = 1; attempt <= maxAttempts; attempt++){
    try{
      await onAuthenticated();
      return true;
    }catch(err){
      if(err.status === 401){
        console.warn('Stored session was invalid, signing out:', err);
        logout();
        return false;
      }
      console.warn(`Failed to load account (attempt ${attempt}/${maxAttempts}):`, err);
      if(attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  return false;
}

connectionRetryBtn.addEventListener('click', async () => {
  connectionRetryBtn.disabled = true;
  connectionRetryBtn.textContent = 'Retrying…';
  const authenticated = await tryRestoreSession(2);
  if(authenticated){
    hideAuthGate();
  }else if(isLoggedIn()){
    connectionRetryBtn.disabled = false;
    connectionRetryBtn.textContent = 'Retry';
  }else{
    // tryRestoreSession found a real 401 and signed out — show the
    // actual sign-in form instead of the connection-error state.
    showAuthGate();
  }
});

async function boot(){
  logTokenDiagnostics();
  await loadSystemPrompt();

  if(resetToken){
    const password = window.prompt('Enter a new password (min 8 characters):');
    if(password){
      try{
        await resetPassword(resetToken, password);
        window.alert('Password updated — log in with your new password.');
      }catch(err){
        window.alert(err.detail || err.message || 'That reset link is invalid or expired.');
      }
    }
    showAuthGate();
    return;
  }

  if(isLoggedIn()){
    // Mobile connections (LTE handoffs, brief signal drops) and backend
    // cold starts both need real patience here — a subscribing user
    // right after a Stripe redirect needs even more.
    const maxAttempts = checkoutStatus === 'success' ? 8 : 6;
    const authenticated = await tryRestoreSession(maxAttempts);
    if(authenticated){
      if(checkoutStatus === 'success') await confirmCheckoutSuccess();
      return;
    }
    if(isLoggedIn()){
      // Not a bad token (that path already returned inside
      // tryRestoreSession via logout()) — just couldn't reach the
      // backend. Say so explicitly instead of showing a blank sign-in
      // form, which reads as "you got logged out" even though you didn't.
      showConnectionError();
      return;
    }
  }

  // Not (yet) authenticated. No preloading needed here anymore — Groq's
  // fast path (the free-tier default once signed in) needs nothing
  // downloaded up front, and the on-device fallback only ever loads
  // lazily if that path fails (see sendFreeMessage).
  showAuthGate();
}

// Mobile browsers (notably Android Chrome/Samsung Internet) restore a
// scrollable element's previous scroll position on reload, same as they
// do for window scroll — but chatScroll's content is freshly rendered
// (the hero, not whatever conversation was on screen before), so a
// restored non-zero offset lands it mid-scroll through nothing, looking
// like broken/cut-off layout. Force it back to the top on every load.
if('scrollRestoration' in history) history.scrollRestoration = 'manual';
chatScroll.scrollTop = 0;

boot();
