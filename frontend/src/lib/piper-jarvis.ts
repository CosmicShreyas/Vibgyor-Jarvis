import { TtsSession } from "@realtimex/piper-tts-web";

const JARVIS_VOICE_ID = "en_US-joe-medium";
const JARVIS_ONNX_URL = "/voice-models/jarvis/poppy_jarvis.onnx";
const JARVIS_CONFIG_URL = "/voice-models/jarvis/poppy_jarvis.onnx.json";
const PIPER_DIR = "piper";
const JARVIS_MODEL_FILENAME = `${JARVIS_VOICE_ID}.onnx`;
const JARVIS_CONFIG_FILENAME = `${JARVIS_VOICE_ID}.onnx.json`;

type LevelCallback = (level: number) => void;

let sessionPromise: Promise<TtsSession> | null = null;
let currentAudio: HTMLAudioElement | null = null;
let currentCleanup: (() => void) | null = null;

async function getPiperDirectory() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(PIPER_DIR, { create: true });
}

async function hasOpfsFile(name: string) {
  try {
    const dir = await getPiperDirectory();
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function writeOpfsFile(name: string, sourceUrl: string) {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to load local voice asset: ${sourceUrl}`);
  }

  const dir = await getPiperDirectory();
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(await response.blob());
  await writable.close();
}

async function ensureJarvisVoiceInstalled() {
  const modelExists = await hasOpfsFile(JARVIS_MODEL_FILENAME);
  const configExists = await hasOpfsFile(JARVIS_CONFIG_FILENAME);
  if (modelExists && configExists) {
    return;
  }

  await Promise.all([
    writeOpfsFile(JARVIS_MODEL_FILENAME, JARVIS_ONNX_URL),
    writeOpfsFile(JARVIS_CONFIG_FILENAME, JARVIS_CONFIG_URL),
  ]);
}

async function getJarvisSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      await ensureJarvisVoiceInstalled();
      return TtsSession.create({
        voiceId: JARVIS_VOICE_ID,
        allowLocalModels: true,
        fallbackStrategy: "auto",
        logger: () => {},
      });
    })();
  }
  return sessionPromise;
}

function clearPlaybackState() {
  currentCleanup?.();
  currentCleanup = null;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
}

export function stopJarvisSpeech() {
  clearPlaybackState();
}

export async function speakWithJarvis(text: string, onLevel?: LevelCallback) {
  stopJarvisSpeech();
  const cleanText = text.trim();
  if (!cleanText) {
    onLevel?.(0);
    return;
  }

  const session = await getJarvisSession();
  const wavBlob = await session.predict(cleanText);
  const audioUrl = URL.createObjectURL(wavBlob);
  const audio = new Audio(audioUrl);
  audio.preload = "auto";
  currentAudio = audio;

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new AudioCtx();
  const source = context.createMediaElementSource(audio);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.78;
  source.connect(analyser);
  analyser.connect(context.destination);

  const data = new Uint8Array(analyser.frequencyBinCount);
  let rafId: number | null = null;

  const cleanup = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    source.disconnect();
    analyser.disconnect();
    URL.revokeObjectURL(audioUrl);
    onLevel?.(0);
    void context.close().catch(() => {});
    if (currentAudio === audio) {
      currentAudio = null;
    }
    if (currentCleanup === cleanup) {
      currentCleanup = null;
    }
  };

  currentCleanup = cleanup;

  const animate = () => {
    analyser.getByteFrequencyData(data);
    const average = data.reduce((sum, value) => sum + value, 0) / Math.max(data.length, 1);
    onLevel?.(Math.min(1, average / 110));
    rafId = requestAnimationFrame(animate);
  };

  await context.resume();
  animate();

  await new Promise<void>((resolve, reject) => {
    audio.onended = () => {
      cleanup();
      resolve();
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("Failed to play Jarvis voice output."));
    };
    void audio.play().catch((error) => {
      cleanup();
      reject(error instanceof Error ? error : new Error("Failed to play Jarvis voice output."));
    });
  });
}
