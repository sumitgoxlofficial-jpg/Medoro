/// <reference lib="webworker" />
// Speech recognition inside the employee's browser: Whisper (multilingual) through transformers.js on WebGPU when the
// device has it, else WebAssembly. Free and private: the audio never leaves the device; only the recognised text is
// sent to the HRMS. The model is downloaded once from Hugging Face and kept in the browser's cache.
import { env, pipeline } from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;

type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;
let asr: Promise<Asr> | null = null, loadedModel = "";

const MODELS: Record<string, string> = { "whisper-base": "onnx-community/whisper-base", "whisper-small": "onnx-community/whisper-small" };

async function load(model: string, post: (m: Record<string, unknown>) => void): Promise<Asr> {
  if (asr && loadedModel === model) return asr;
  loadedModel = model;
  const webgpu = "gpu" in navigator && !!(await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
  const files = new Map<string, { loaded: number; total: number }>();
  asr = pipeline("automatic-speech-recognition", MODELS[model] ?? MODELS["whisper-base"], {
    device: webgpu ? "webgpu" : "wasm",
    dtype: webgpu ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === "progress" && p.file) {
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
        const all = [...files.values()], total = all.reduce((a, f) => a + f.total, 0), loaded = all.reduce((a, f) => a + f.loaded, 0);
        post({ type: "progress", loaded, total });
      }
    },
  }) as unknown as Promise<Asr>;
  asr.catch(() => { asr = null; });
  return asr;
}

self.onmessage = async (e: MessageEvent<{ id: number; type: "load" | "transcribe"; model: string; audio?: Float32Array; language?: string }>) => {
  const { id, type, model, audio, language } = e.data;
  const post = (m: Record<string, unknown>) => (self as unknown as Worker).postMessage({ id, ...m });
  try {
    const run = await load(model, post);
    if (type === "load") { post({ type: "ready" }); return; }
    const t0 = performance.now();
    const out = await run(audio!, { task: "transcribe", ...(language ? { language } : {}), chunk_length_s: 30, return_timestamps: false });
    const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text).trim();
    post({ type: "text", text, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    post({ type: "error", error: err instanceof Error ? err.message : String(err) });
  }
};
