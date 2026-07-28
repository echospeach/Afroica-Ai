// Thin wrapper around WebLLM engine creation — keeps the import + call
// site in one place so main.js doesn't need to know CreateMLCEngine's shape.
//
// Text-only, not vision-capable: swapped down from Phi-3.5-vision-instruct
// (~3.95GB VRAM) after that model reliably triggered GPU-out-of-memory /
// device-lost errors on modest hardware. Llama-3.2-3B-Instruct needs
// ~2.26GB VRAM instead — a real capability tradeoff (free tier loses
// on-device image understanding; Pro keeps it via the server-side model),
// made deliberately to fix reliability rather than as a silent downgrade.
const DESKTOP_MODEL_ID = "Llama-3.2-3B-Instruct-q4f16_1-MLC";
// Phones expose far less GPU memory to the browser than desktop GPUs do,
// even flagship devices — the 3B model reliably fails to load on mobile
// even where WebGPU itself is supported. Llama-3.2-1B needs only ~880MB
// VRAM; noticeably lower reply quality, but that's a better tradeoff than
// the free tier simply not working on phones at all.
const MOBILE_MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

const isMobileDevice = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

export const MODEL_ID = isMobileDevice ? MOBILE_MODEL_ID : DESKTOP_MODEL_ID;
// Both models above compile to the same context_window_size — matches
// their actual compiled config (see MLC's prebuiltAppConfig); going
// higher risks a runtime error the same way the old vision model's OOM did.
export const CHAT_OPTS = { context_window_size: 4096 };

export async function createEngine(webllm, onProgress){
  return webllm.CreateMLCEngine(
    MODEL_ID,
    { initProgressCallback: onProgress },
    CHAT_OPTS
  );
}
