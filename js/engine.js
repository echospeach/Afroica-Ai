// Thin wrapper around WebLLM engine creation — keeps the import + call
// site in one place so main.js doesn't need to know CreateMLCEngine's shape.

export const MODEL_ID = "Phi-3.5-vision-instruct-q4f16_1-MLC";
export const CHAT_OPTS = { context_window_size: 6144 };

export async function createEngine(webllm, onProgress){
  return webllm.CreateMLCEngine(
    MODEL_ID,
    { initProgressCallback: onProgress },
    CHAT_OPTS
  );
}
