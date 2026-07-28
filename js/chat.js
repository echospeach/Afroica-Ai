// Renders the message list: bubbles, avatars, typing indicator, and the
// streaming reply as tokens arrive.
import { marked } from "https://esm.run/marked";
import DOMPurify from "https://esm.run/dompurify";

// `breaks: true` so a single newline in the model's reply becomes a line
// break (chat-style), not swallowed the way standard Markdown treats it.
marked.setOptions({ breaks: true, gfm: true });

// AI replies are rendered as Markdown → HTML, so they MUST be sanitized —
// model output is untrusted content as far as the DOM is concerned (it
// could echo back something from the user's own message, or occasionally
// emit stray HTML-looking text). DOMPurify strips anything dangerous
// (script tags, event-handler attributes, etc.) after marked converts the
// Markdown, before it ever reaches innerHTML. Never skip this step.
function renderMarkdown(text){
  return DOMPurify.sanitize(marked.parse(text));
}

const COPY_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="2"/></svg>`;
const CHECK_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const REGEN_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.51 15a9 9 0 0014.85 3.36L23 14M1 10l4.64 4.36A9 9 0 0020.49 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// `onRegenerate` is called with no arguments when the regenerate button on
// the latest AI message is clicked — main.js owns what "regenerate" means
// (which tier to re-ask, popping the right state), this module only ever
// renders the button and reports the click.
export function createChatView(chatInner, chatScroll, { onRegenerate } = {}){
  let streamingBubble = null;
  let streamingRow = null;

  function scrollToBottom(){
    chatScroll.scrollTop = chatScroll.scrollHeight;
  }

  // Only the most recent AI message offers "regenerate" — regenerating an
  // older one would be ambiguous about what happens to everything after
  // it, so keep this to the one case that's unambiguous. Copy stays on
  // every AI message indefinitely.
  function markLatestAi(){
    const aiRows = chatInner.querySelectorAll('.msg-row.ai');
    aiRows.forEach((row, i) => {
      const regenBtn = row.querySelector('.msg-action-regenerate');
      if(regenBtn) regenBtn.classList.toggle('hidden', i !== aiRows.length - 1);
    });
  }

  function addActions(bubble, getText){
    const actions = document.createElement('div');
    actions.className = 'msg-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'msg-action-btn';
    copyBtn.setAttribute('aria-label', 'Copy reply');
    copyBtn.title = 'Copy';
    copyBtn.innerHTML = COPY_ICON;
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(getText()).then(() => {
        copyBtn.innerHTML = CHECK_ICON;
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.innerHTML = COPY_ICON;
          copyBtn.classList.remove('copied');
        }, 1500);
      }).catch((err) => console.error('Could not copy reply to clipboard:', err));
    });
    actions.appendChild(copyBtn);

    const regenBtn = document.createElement('button');
    regenBtn.type = 'button';
    regenBtn.className = 'msg-action-btn msg-action-regenerate hidden';
    regenBtn.setAttribute('aria-label', 'Regenerate this reply');
    regenBtn.title = 'Regenerate';
    regenBtn.innerHTML = REGEN_ICON;
    regenBtn.addEventListener('click', () => {
      if(onRegenerate) onRegenerate();
    });
    actions.appendChild(regenBtn);

    bubble.appendChild(actions);
  }

  function addMessage(text, sender, imageDataUrl){
    const row = document.createElement('div');
    row.className = 'msg-row ' + sender;

    const avatar = document.createElement('div');
    avatar.className = 'avatar ' + sender;
    if(sender === 'user') avatar.textContent = 'You';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    if(imageDataUrl){
      const img = document.createElement('img');
      img.className = 'msg-image';
      img.src = imageDataUrl;
      img.alt = 'Attached image';
      bubble.appendChild(img);
    }
    if(text){
      const textEl = document.createElement('div');
      textEl.className = 'msg-text';
      if(sender === 'ai'){
        textEl.innerHTML = renderMarkdown(text);
      }else{
        // User messages are shown as plain text, never interpreted as
        // Markdown/HTML — there's no reason to render formatting out of
        // something the user typed themselves.
        textEl.textContent = text;
      }
      bubble.appendChild(textEl);
    }

    if(sender === 'ai') addActions(bubble, () => text);

    row.appendChild(avatar);
    row.appendChild(bubble);
    chatInner.appendChild(row);
    scrollToBottom();
    if(sender === 'ai') markLatestAi();
    return bubble;
  }

  function addTyping(){
    const row = document.createElement('div');
    row.className = 'msg-row ai';
    row.id = 'typingRow';

    const avatar = document.createElement('div');
    avatar.className = 'avatar ai';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';

    row.appendChild(avatar);
    row.appendChild(bubble);
    chatInner.appendChild(row);
    scrollToBottom();
    return bubble;
  }

  function removeTyping(){
    const row = document.getElementById('typingRow');
    if(row) row.remove();
  }

  function renderStreamingReply(text){
    if(!streamingBubble){
      streamingRow = document.createElement('div');
      streamingRow.className = 'msg-row ai';

      const avatar = document.createElement('div');
      avatar.className = 'avatar ai';

      streamingBubble = document.createElement('div');
      streamingBubble.className = 'bubble';

      streamingRow.appendChild(avatar);
      streamingRow.appendChild(streamingBubble);
      chatInner.appendChild(streamingRow);
    }
    // Re-parsing the full text on every chunk (rather than diffing) is
    // simple and fast enough for chat-length replies — mid-stream, an
    // incomplete Markdown construct (an unclosed ** or code fence) can
    // render slightly oddly for a moment, but it self-corrects as soon
    // as the rest of the text arrives.
    streamingBubble.innerHTML = renderMarkdown(text);
    scrollToBottom();
  }

  // Attaches copy/regenerate actions to whatever streamingBubble holds
  // (even a partial reply, if generation was interrupted — see
  // js/main.js's stop-generating handling) before clearing the reference,
  // so the next message starts a fresh bubble.
  function resetStreaming(){
    if(streamingBubble){
      addActions(streamingBubble, () => streamingBubble.querySelector('.msg-text')?.textContent || '');
      markLatestAi();
    }
    streamingBubble = null;
    streamingRow = null;
  }

  // Used by "regenerate" (see js/main.js) to remove the reply being
  // replaced before a new one streams in. Works whether that reply had
  // already finished (a plain .msg-row.ai) or was cut short.
  function removeLastAiMessage(){
    const aiRows = chatInner.querySelectorAll('.msg-row.ai');
    const last = aiRows[aiRows.length - 1];
    if(last) last.remove();
  }

  function clear(){
    chatInner.innerHTML = '';
    streamingBubble = null;
    streamingRow = null;
  }

  return {
    addMessage,
    addTyping,
    removeTyping,
    renderStreamingReply,
    resetStreaming,
    removeLastAiMessage,
    clear,
    scrollToBottom
  };
}

export function makeHero(){
  const div = document.createElement('div');
  div.className = 'hero';
  div.id = 'heroState';
  div.innerHTML = `
    <div class="hero-mark"></div>
    <h1>Afroica <span>AI</span></h1>
    <p>An assistant built for African languages, culture, and everyday questions — running at zero server cost. Type, speak, or attach a photo to get started.</p>
  `;
  return div;
}
