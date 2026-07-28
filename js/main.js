// ---------------------------------------------------------------
// AFROICA AI — ENTRY POINT
//
// Free tier: runs a real (text-only) language model entirely inside this
// browser tab via WebGPU (WebLLM) — zero server cost, capped at a daily
// message quota enforced by the backend (see js/usage.js).
//
// Pro tier: routes chat through the Python backend (see /backend) to a
// fast, vision-capable hosted Claude model instead of the local WebLLM
// engine — funded by the subscription, not by the free tier's compute.
// Image understanding is Pro-only for exactly this reason: the on-device
// model (js/engine.js) doesn't support it.
//
// Behavior/persona is controlled by persona.json (see js/persona.js and
// tools/persona_builder.py) — both the local model and the backend build
// their system prompt from that same file.
// ---------------------------------------------------------------
import * as webllm from "https://esm.run/@mlc-ai/web-llm";
import { createEngine } from './engine.js';
import { loadPersona, buildSystemPrompt } from './persona.js';
import { resizeImageFile } from './image.js';
import { createVoiceController } from './voice.js';
import { createChatView, makeHero } from './chat.js';
import { signup, login, logout, isLoggedIn, setToken, deleteAccount, forgotPassword, resetPassword } from './auth.js';
import { refreshAccount, getUser, getUsage, isPro, setUsage } from './account.js';
import { incrementUsage } from './usage.js';
import { startCheckout, openBillingPortal } from './billing.js';
import { buildAnthropicUserContent, streamProChat } from './proChat.js';

const chatInner = document.getElementById('chatInner');
const chatScroll = document.getElementById('chatScroll');
const promptInput = document.getElementById('promptInput');
const sendBtn = document.getElementById('sendBtn');
const newChatBtn = document.getElementById('newChatBtn');
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

const chat = createChatView(chatInner, chatScroll);

let engine = null;
let modelReady = false;
let generating = false;
let pendingImage = null; // { dataUrl, name }
// messages[0] is always the system prompt — kept as a real entry from the
// start (filled in once persona.json loads) so `messages.length = 1` in
// newChatBtn's handler can never leave a hole there. Pro-tier sends skip
// this entry (the backend builds its own system prompt from persona.json).
const messages = [{ role: 'system', content: '' }];

function isInteractive(){
  return (isPro() || modelReady) && !generating;
}

function updateSendState(){
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

// ---- Auth gate ----
function showAuthGate(){ authGate.classList.remove('hidden'); }
function hideAuthGate(){ authGate.classList.add('hidden'); }

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

// ---- Model loading (free tier only — Pro skips the local download) ----
async function loadSystemPrompt(){
  const persona = await loadPersona();
  messages[0].content = buildSystemPrompt(persona);
}

// Kicked off as soon as the page loads — before we know if this visitor is
// Pro — so the ~2-3GB download runs in the background while they're on the
// sign-in screen instead of starting only after they log in. Idempotent:
// safe to call again once auth resolves without restarting the download.
// If they turn out to be Pro, the guards below just stop touching the UI —
// the download quietly finishes and caches, at worst a bit of wasted
// bandwidth for someone who didn't need it.
let modelInitPromise = null;

function initModel(){
  if(modelInitPromise) return modelInitPromise;
  modelInitPromise = (async () => {
    if(!navigator.gpu){
      if(!isPro()) showLoadError('This browser has no WebGPU support — try latest Chrome or Edge on desktop.');
      return;
    }
    try{
      engine = await createEngine(webllm, (progress) => {
        if(isPro()) return; // Pro doesn't use the local model — don't fight its UI
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
      if(!isPro()){
        hideLoadBanner();
        setStatus(null, 'Ready · running on your device');
        enableChatUI(false);
      }
    }catch(err){
      console.error(err);
      if(!isPro()) showLoadError('Could not load the model. Check the console for details.');
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
    initModel();
  }
}

// ---- Sending messages ----
function beginSend(displayText, imageForMessage){
  const hero = document.getElementById('heroState');
  if(hero) hero.remove();

  chat.addMessage(displayText, 'user', imageForMessage ? imageForMessage.dataUrl : null);

  pendingImage = null;
  showAttachPreview();

  promptInput.value = '';
  promptInput.style.height = 'auto';
  generating = true;
  updateSendState();
  setStatus('loading', 'Thinking…');

  chat.addTyping();
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

async function sendFreeMessage(displayText, imageForMessage){
  try{
    const usage = await incrementUsage();
    setUsage(usage);
    renderAccountUI();
  }catch(err){
    if(err.status === 402){
      showPricingModal();
      return;
    }
    // The usage tracker had a hiccup — this feature is free either way
    // (local inference), so don't block it on a backend blip.
    console.error('Usage check failed, continuing on the free local model anyway:', err);
  }

  beginSend(displayText, imageForMessage);

  if(imageForMessage){
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: displayText },
        { type: 'image_url', image_url: { url: imageForMessage.dataUrl } }
      ]
    });
  }else{
    messages.push({ role: 'user', content: displayText });
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
  }catch(err){
    console.error(err);
    chat.removeTyping();
    if(isGpuDeviceLostError(err)){
      // The engine object still exists but is no longer usable — clear it
      // out so the next attempt reloads a fresh one instead of repeatedly
      // hitting the same dead device.
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
  }finally{
    endSend(modelReady ? 'Ready · running on your device' : 'Model unloaded — refresh the page to reload it');
  }
}

async function sendProMessage(displayText, imageForMessage){
  beginSend(displayText, imageForMessage);

  const content = buildAnthropicUserContent(displayText, imageForMessage ? imageForMessage.dataUrl : null);
  messages.push({ role: 'user', content });

  let started = false;

  try{
    // messages[0] is the local placeholder system entry — the backend
    // builds its own system prompt from persona.json, so it's never sent.
    const payload = messages.slice(1).map((m) => ({ role: m.role, content: m.content }));
    const fullReply = await streamProChat(payload, (partial) => {
      if(!started){
        chat.removeTyping();
        started = true;
      }
      chat.renderStreamingReply(partial);
    });

    if(!started){
      chat.removeTyping();
      chat.addMessage(fullReply || "I didn't manage to generate a reply — try rephrasing that.", 'ai');
    }
    messages.push({ role: 'assistant', content: fullReply });
  }catch(err){
    console.error(err);
    chat.removeTyping();
    if(err.status === 402){
      chat.addMessage('Your Pro subscription looks inactive — refresh the page or check your billing.', 'ai');
    }else if(err.status === 429){
      chat.addMessage("You've hit today's fair-use limit — try again tomorrow.", 'ai');
    }else{
      chat.addMessage('Something went wrong reaching the server. Check the console for details.', 'ai');
    }
  }finally{
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
  else await sendFreeMessage(displayText, imageForMessage);
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

document.querySelectorAll('.suggestion[data-q]').forEach(el => {
  el.addEventListener('click', () => {
    if(!isInteractive()) return;
    promptInput.value = el.dataset.q;
    autosize();
    sendMessage();
  });
});

const tryPhotoSuggestion = document.getElementById('tryPhotoSuggestion');
if(tryPhotoSuggestion){
  tryPhotoSuggestion.addEventListener('click', () => {
    if(!isInteractive()) return;
    imageInput.click();
  });
}

sendBtn.addEventListener('click', sendMessage);

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
  messages.length = 1; // keep system prompt, drop the rest
  pendingImage = null;
  showAttachPreview();
  updateSendState();
  closeSidebar();
});

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

async function boot(){
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
    initModel();
    showAuthGate();
    return;
  }

  if(isLoggedIn()){
    // Right after a Stripe redirect the backend can be momentarily slow
    // (webhook processing, occasional cold start) — be more patient there
    // than on an ordinary page load, so a subscribing user doesn't get
    // dumped on the sign-in screen over a few seconds of lag.
    const maxAttempts = checkoutStatus === 'success' ? 5 : 2;
    let authenticated = false;
    for(let attempt = 1; attempt <= maxAttempts && !authenticated; attempt++){
      try{
        await onAuthenticated();
        authenticated = true;
      }catch(err){
        if(err.status === 401){
          // The token itself is invalid/expired — this is a real logout,
          // no amount of retrying fixes a bad token.
          console.warn('Stored session was invalid, signing out:', err);
          logout();
          break;
        }
        console.warn(`Failed to load account (attempt ${attempt}/${maxAttempts}):`, err);
        if(attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    if(authenticated){
      if(checkoutStatus === 'success') await confirmCheckoutSuccess();
      return;
    }
    if(isLoggedIn()){
      // Not a bad token (that path already returned above via logout()) —
      // just couldn't reach the backend. Session stays intact for next
      // reload; don't silently pretend everything's fine either.
      console.error('Could not load your account after retrying — showing sign-in screen, but your session is still saved.');
    }
  }

  // Not (yet) authenticated — a first-time visitor is, by definition, not
  // yet a Pro subscriber, so start the on-device model download now,
  // in parallel with the sign-in screen, instead of making them wait for
  // it after logging in.
  initModel();
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
