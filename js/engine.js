// Thin wrapper around WebLLM engine creation — keeps the import + call
// site in one place so main.js doesn't need to know CreateMLCEngine's shape.
//
// Text-only, not vision-capable: swapped down from Phi-3.5-vision-instruct
// (~3.95GB VRAM) after that model reliably triggered GPU-out-of-memory /
// device-lost errors on modest hardware. Llama-3.2-3B-Instruct needs
// ~2.26GB VRAM instead — a real capability tradeoff (free tier loses
// on-device image understanding; Pro keeps it via the server-side model),
// made deliberately to fix reliability rather than as a silent downgrade.
export const MODEL_ID = "Llama-3.2-3B-Instruct-q4f16_1-MLC";
// Matches this model's compiled context_window_size (see MLC's
// prebuiltAppConfig) — going higher risks a runtime error the same way
// the old vision model's OOM did.
export const CHAT_OPTS = { context_window_size: 4096 };

export async function createEngine(webllm, onProgress){
  return webllm.CreateMLCEngine(
    MODEL_ID,
    { initProgressCallback: onProgress },
    CHAT_OPTS
  );
}
