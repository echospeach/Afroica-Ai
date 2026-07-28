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

export function createChatView(chatInner, chatScroll){
  let streamingBubble = null;

  function scrollToBottom(){
    chatScroll.scrollTop = chatScroll.scrollHeight;
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

    row.appendChild(avatar);
    row.appendChild(bubble);
    chatInner.appendChild(row);
    scrollToBottom();
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
      const row = document.createElement('div');
      row.className = 'msg-row ai';

      const avatar = document.createElement('div');
      avatar.className = 'avatar ai';

      streamingBubble = document.createElement('div');
      streamingBubble.className = 'bubble';

      row.appendChild(avatar);
      row.appendChild(streamingBubble);
      chatInner.appendChild(row);
    }
    // Re-parsing the full text on every chunk (rather than diffing) is
    // simple and fast enough for chat-length replies — mid-stream, an
    // incomplete Markdown construct (an unclosed ** or code fence) can
    // render slightly oddly for a moment, but it self-corrects as soon
    // as the rest of the text arrives.
    streamingBubble.innerHTML = renderMarkdown(text);
    scrollToBottom();
  }

  function resetStreaming(){
    streamingBubble = null;
  }

  function clear(){
    chatInner.innerHTML = '';
    streamingBubble = null;
  }

  return {
    addMessage,
    addTyping,
    removeTyping,
    renderStreamingReply,
    resetStreaming,
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
