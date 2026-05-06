declare module "../../external_modules/vibgyor-voicetype.js" {
  export {};
}

interface VibgyorVoiceTypeInstance {
  start(): Promise<void>;
  stop(): void;
  abort(): void;
  isActive(): boolean;
  getTranscript(): string;
}

interface VibgyorVoiceTypeConstructor {
  new (options?: {
    language?: string;
    continuous?: boolean;
    interimResults?: boolean;
    maxAlternatives?: number;
    onTranscript?: (data: { final: string; interim: string; combined: string }) => void;
    onInterim?: (data: { transcript: string; isFinal: boolean }) => void;
    onError?: (error: { type: string; message: string }) => void;
    onStart?: () => void;
    onEnd?: (data: { transcript: string }) => void;
    onAudioData?: (audioData: { volume: number }) => void;
    visualizationSampleRate?: number;
  }): VibgyorVoiceTypeInstance;
  isSupported(): boolean;
}

declare global {
  interface Window {
    VibgyorVoiceType: VibgyorVoiceTypeConstructor;
  }
}
