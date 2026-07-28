// Voice notes: transcribes speech into the prompt box via the browser's
// built-in Web Speech API. Nothing is recorded or sent anywhere — the
// browser does the recognition locally/via its own vendor service.

export function createVoiceController({ micBtn, promptInput, canListen, onChange, onStop }){
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = !!SpeechRecognitionCtor;
  let recognition = null;
  let listening = false;
  let baseText = '';

  if(!supported){
    micBtn.title = 'Voice input not supported in this browser — try Chrome or Edge';
  }else{
    recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    recognition.onresult = (event) => {
      let transcript = '';
      for(let i = 0; i < event.results.length; i++){
        transcript += event.results[i][0].transcript;
      }
      onChange((baseText + ' ' + transcript).trim());
    };
    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      stop();
    };
    recognition.onend = () => stop();
  }

  function start(){
    if(!recognition || listening || !canListen()) return;
    baseText = promptInput.value.trim();
    try{
      recognition.start();
      listening = true;
      micBtn.classList.add('active');
      promptInput.placeholder = 'Listening…';
    }catch(err){
      console.error(err);
    }
  }

  function stop(){
    if(!recognition) return;
    if(listening){
      try{ recognition.stop(); }catch(err){ /* already stopped */ }
    }
    listening = false;
    micBtn.classList.remove('active');
    if(onStop) onStop();
  }

  micBtn.addEventListener('click', () => {
    if(listening) stop();
    else start();
  });

  return {
    supported,
    isListening: () => listening,
    stop
  };
}
