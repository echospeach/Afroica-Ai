// Renders the message list: bubbles, avatars, typing indicator, and the
// streaming reply as tokens arrive.

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
      textEl.textContent = text;
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
    streamingBubble.textContent = text;
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
