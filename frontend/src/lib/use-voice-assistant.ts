import { useCallback, useEffect, useRef, useState } from "react";
import "../../external_modules/vibgyor-voicetype.js";
import { generateVoiceBrief } from "@/lib/api";
import { speakWithJarvis, stopJarvisSpeech } from "@/lib/piper-jarvis";

export type VoiceAssistantMode =
  | "idle"
  | "listening"
  | "processing"
  | "speaking"
  | "error"
  | "unsupported";

interface UseVoiceAssistantOptions {
  token: string | null;
  onSendVoiceMessage: (
    content: string,
    callbacks?: {
      onAssistantDone?: (assistantText: string) => void;
      onAssistantError?: (message: string) => void;
    },
  ) => void;
}

interface TranscriptData {
  final: string;
  interim: string;
  combined: string;
}

interface AudioData {
  volume: number;
}

interface ErrorData {
  type: string;
  message: string;
}

const FULL_RESPONSE_TTS_CHAR_LIMIT = 220;
const SUMMARY_TTS_CHAR_LIMIT = 120;
const ACTIVE_SILENCE_MS = 1350;
const FINALIZE_GRACE_MS = 850;

function clampLevel(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function useVoiceAssistant({ token, onSendVoiceMessage }: UseVoiceAssistantOptions) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<VoiceAssistantMode>("idle");
  const [level, setLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const voiceTypeRef = useRef<InstanceType<typeof window.VibgyorVoiceType> | null>(null);
  const activeSessionIdRef = useRef(0);
  const closingRef = useRef(false);
  const transcriptRef = useRef("");
  const meterStreamRef = useRef<MediaStream | null>(null);
  const meterContextRef = useRef<AudioContext | null>(null);
  const meterAnalyserRef = useRef<AnalyserNode | null>(null);
  const meterRafRef = useRef<number | null>(null);
  const silenceTimeoutRef = useRef<number | null>(null);
  const finalizeTimeoutRef = useRef<number | null>(null);
  const hasSpeechRef = useRef(false);
  const hasSubmittedSpeechRef = useRef(false);
  const recognitionRestartTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  const teardownVoiceType = useCallback(() => {
    const voiceType = voiceTypeRef.current;
    if (!voiceType) return;
    if (voiceType.isActive()) {
      voiceType.abort();
    }
    voiceTypeRef.current = null;
  }, []);

  const clearSilenceTimeout = useCallback(() => {
    if (silenceTimeoutRef.current !== null) {
      window.clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
  }, []);

  const clearRecognitionRestartTimeout = useCallback(() => {
    if (recognitionRestartTimeoutRef.current !== null) {
      window.clearTimeout(recognitionRestartTimeoutRef.current);
      recognitionRestartTimeoutRef.current = null;
    }
  }, []);

  const clearFinalizeTimeout = useCallback(() => {
    if (finalizeTimeoutRef.current !== null) {
      window.clearTimeout(finalizeTimeoutRef.current);
      finalizeTimeoutRef.current = null;
    }
  }, []);

  const stopMicMeter = useCallback(() => {
    if (meterRafRef.current !== null) {
      cancelAnimationFrame(meterRafRef.current);
      meterRafRef.current = null;
    }
    meterStreamRef.current?.getTracks().forEach((track) => track.stop());
    meterStreamRef.current = null;
    meterAnalyserRef.current = null;
    if (meterContextRef.current) {
      void meterContextRef.current.close().catch(() => {});
      meterContextRef.current = null;
    }
  }, []);

  const startMicMeter = useCallback(async () => {
    stopMicMeter();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new AudioCtx();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);

    meterStreamRef.current = stream;
    meterContextRef.current = context;
    meterAnalyserRef.current = analyser;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let index = 0; index < data.length; index += 1) {
        const value = (data[index] - 128) / 128;
        sum += value * value;
      }
      const rms = Math.sqrt(sum / Math.max(data.length, 1));
      setLevel((prev) => prev * 0.6 + clampLevel(rms * 4.2) * 0.4);
      meterRafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, [stopMicMeter]);

  const completeSpokenPrompt = useCallback(
    (
      spokenPrompt: string,
      callbacks?: {
        onAssistantDone?: (assistantText: string) => void;
        onAssistantError?: (message: string) => void;
      },
    ) => {
      if (!spokenPrompt.trim() || hasSubmittedSpeechRef.current) {
        return;
      }
      hasSubmittedSpeechRef.current = true;
      hasSpeechRef.current = false;
      clearSilenceTimeout();
      clearRecognitionRestartTimeout();
      clearFinalizeTimeout();
      stopMicMeter();
      setTranscript(spokenPrompt.trim());
      setMode("processing");
      onSendVoiceMessage(spokenPrompt.trim(), callbacks);
    },
    [
      clearFinalizeTimeout,
      clearRecognitionRestartTimeout,
      clearSilenceTimeout,
      onSendVoiceMessage,
      stopMicMeter,
    ],
  );

  const scheduleSilenceStop = useCallback(() => {
    clearSilenceTimeout();
    silenceTimeoutRef.current = window.setTimeout(() => {
      clearFinalizeTimeout();
      voiceTypeRef.current?.stop();
      finalizeTimeoutRef.current = window.setTimeout(() => {
        const spokenPrompt = transcriptRef.current.trim();
        if (!spokenPrompt || hasSubmittedSpeechRef.current || closingRef.current) {
          return;
        }
        teardownVoiceType();
        completeSpokenPrompt(spokenPrompt);
      }, FINALIZE_GRACE_MS);
    }, ACTIVE_SILENCE_MS);
  }, [clearFinalizeTimeout, clearSilenceTimeout, completeSpokenPrompt, teardownVoiceType]);

  const resetVisualState = useCallback(() => {
    setLevel(0);
    setTranscript("");
    setError(null);
  }, []);

  const closeVoiceUi = useCallback(() => {
    closingRef.current = true;
    activeSessionIdRef.current += 1;
    hasSpeechRef.current = false;
    clearSilenceTimeout();
    clearRecognitionRestartTimeout();
    clearFinalizeTimeout();
    teardownVoiceType();
    stopMicMeter();
    stopJarvisSpeech();
    setOpen(false);
    setMode("idle");
    resetVisualState();
    window.setTimeout(() => {
      closingRef.current = false;
    }, 0);
  }, [clearFinalizeTimeout, clearRecognitionRestartTimeout, clearSilenceTimeout, resetVisualState, stopMicMeter, teardownVoiceType]);

  const ensureVoiceType = useCallback(() => {
    if (voiceTypeRef.current) {
      return voiceTypeRef.current;
    }

    const VoiceType = window.VibgyorVoiceType;
    const instance = new VoiceType({
      language: "en-US",
      continuous: true,
      interimResults: true,
      visualizationSampleRate: 60,
      onStart: () => {
        clearRecognitionRestartTimeout();
        clearFinalizeTimeout();
        setMode("listening");
        setError(null);
      },
      onTranscript: (data: TranscriptData) => {
        setTranscript(data.combined);
        if (data.combined.trim()) {
          hasSpeechRef.current = true;
          scheduleSilenceStop();
        }
      },
      onAudioData: (_audioData: AudioData) => {},
      onError: (event: ErrorData) => {
        if (event.type === "aborted" && closingRef.current) {
          return;
        }
        if (event.type === "no-speech") {
          setMode("listening");
          setError(null);
          return;
        }
        if (!hasSpeechRef.current && (event.type === "audio-capture" || event.type === "network")) {
          return;
        }
        clearSilenceTimeout();
        clearRecognitionRestartTimeout();
        clearFinalizeTimeout();
        stopMicMeter();
        setMode(event.type === "not-supported" ? "unsupported" : "error");
        setError(event.message);
      },
      onEnd: ({ transcript: finalTranscript }) => {
        const sessionId = activeSessionIdRef.current;
        if (closingRef.current) {
          return;
        }

        const spokenPrompt = finalTranscript.trim() || transcriptRef.current.trim();
        clearSilenceTimeout();
        clearFinalizeTimeout();
        if (!spokenPrompt) {
          clearRecognitionRestartTimeout();
          setMode("listening");
          setError(null);
          recognitionRestartTimeoutRef.current = window.setTimeout(() => {
            if (sessionId !== activeSessionIdRef.current || closingRef.current || hasSpeechRef.current) {
              return;
            }
            try {
              void voiceTypeRef.current?.start();
            } catch {
              /* ignore */
            }
          }, 500);
          return;
        }

        completeSpokenPrompt(spokenPrompt, {
          onAssistantDone: async (assistantText) => {
            if (sessionId !== activeSessionIdRef.current) {
              return;
            }
            try {
              if (!token) {
                throw new Error("You need to be signed in to use voice replies.");
              }
              const response = await generateVoiceBrief(
                {
                  userPrompt: spokenPrompt,
                  assistantResponse: assistantText,
                  maxFullTextChars: FULL_RESPONSE_TTS_CHAR_LIMIT,
                  maxSummaryChars: SUMMARY_TTS_CHAR_LIMIT,
                },
                token,
              );
              if (sessionId !== activeSessionIdRef.current) {
                return;
              }
              setTranscript(response.speak_text);
              setMode("speaking");
              await speakWithJarvis(response.speak_text, (nextLevel) => {
                if (sessionId === activeSessionIdRef.current) {
                  setLevel(nextLevel);
                }
              });
              if (sessionId === activeSessionIdRef.current) {
                setOpen(false);
                setMode("idle");
                resetVisualState();
              }
            } catch (voiceError) {
              if (sessionId !== activeSessionIdRef.current) {
                return;
              }
              setMode("error");
              setError(
                voiceError instanceof Error
                  ? voiceError.message
                  : "Voice reply playback failed.",
              );
            }
          },
          onAssistantError: (message) => {
            if (sessionId !== activeSessionIdRef.current) {
              return;
            }
            setMode("error");
            setError(message);
          },
        });
      },
    });
    const patchedInstance = instance as unknown as {
      _initAudioVisualization?: () => Promise<void>;
      _stopAudioVisualization?: () => void;
    };
    patchedInstance._initAudioVisualization = async () => {};
    patchedInstance._stopAudioVisualization = () => {};

    voiceTypeRef.current = instance;
    return instance;
  }, [clearSilenceTimeout, onSendVoiceMessage, resetVisualState, scheduleSilenceStop, stopMicMeter, token]);

  const startListening = useCallback(async () => {
    if (!token) {
      setOpen(true);
      setMode("error");
      setError("Sign in to use voice interaction.");
      return;
    }
    const VoiceType = window.VibgyorVoiceType;
    if (!VoiceType?.isSupported()) {
      setOpen(true);
      setMode("unsupported");
      setError("Speech recognition is not supported in this browser.");
      return;
    }

    activeSessionIdRef.current += 1;
    closingRef.current = false;
    hasSpeechRef.current = false;
    hasSubmittedSpeechRef.current = false;
    clearSilenceTimeout();
    clearRecognitionRestartTimeout();
    clearFinalizeTimeout();
    resetVisualState();
    setOpen(true);
    setMode("listening");
    try {
      await startMicMeter();
    } catch (meterError) {
      setMode("error");
      setError(
        meterError instanceof Error ? meterError.message : "Unable to access microphone.",
      );
      return;
    }
    const voiceType = ensureVoiceType();
    try {
      await voiceType.start();
    } catch (voiceError) {
      stopMicMeter();
      setMode("error");
      setError(
        voiceError instanceof Error ? voiceError.message : "Failed to start voice recognition.",
      );
    }
  }, [clearFinalizeTimeout, clearRecognitionRestartTimeout, clearSilenceTimeout, ensureVoiceType, resetVisualState, startMicMeter, stopMicMeter, token]);

  const toggle = useCallback(() => {
    if (!open || mode === "idle" || mode === "error" || mode === "unsupported") {
      void startListening();
      return;
    }

    if (mode === "listening") {
      voiceTypeRef.current?.stop();
      return;
    }

    closeVoiceUi();
  }, [closeVoiceUi, mode, open, startListening]);

  useEffect(
    () => () => {
      teardownVoiceType();
      clearFinalizeTimeout();
      clearRecognitionRestartTimeout();
      clearSilenceTimeout();
      stopMicMeter();
      stopJarvisSpeech();
    },
    [clearFinalizeTimeout, clearRecognitionRestartTimeout, clearSilenceTimeout, stopMicMeter, teardownVoiceType],
  );

  return {
    open,
    mode,
    level,
    transcript,
    error,
    toggle,
    close: closeVoiceUi,
  };
}
