import "server-only";
import { readdir } from "node:fs/promises";
import path from "node:path";

// Where the self-hosted browser speech files live on this server (see scripts/office/fetch-speech-model.sh).
//   models:  AI_SPEECH_MODELS_DIR, default /data/ai-speech/models  (<org>/<model>/… as on Hugging Face)
//   runtime: AI_SPEECH_RUNTIME_DIR, default ./ai-speech/ort       (onnxruntime-web WebAssembly, copied in the Docker build)
export function speechDirs(env: NodeJS.ProcessEnv = process.env) {
  return {
    models: path.resolve(/*turbopackIgnore: true*/ env.AI_SPEECH_MODELS_DIR || "/data/ai-speech/models"),
    runtime: path.resolve(/*turbopackIgnore: true*/ env.AI_SPEECH_RUNTIME_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "ai-speech", "ort")),
  };
}
const MODEL_IDS: Record<string, string> = { "whisper-base": "onnx-community/whisper-base", "whisper-small": "onnx-community/whisper-small" };

/** What is present for self-hosting, for Model status. */
export async function speechFilesStatus(model: string) {
  const d = speechDirs();
  const count = async (dir: string) => { try { return (await readdir(dir, { recursive: true })).length; } catch { return 0; } };
  const modelFiles = await count(path.join(/*turbopackIgnore: true*/ d.models, MODEL_IDS[model] ?? MODEL_IDS["whisper-base"]));
  const runtimeFiles = await count(d.runtime);
  return { modelFiles, runtimeFiles, ready: modelFiles >= 6 && runtimeFiles >= 2 };
}
