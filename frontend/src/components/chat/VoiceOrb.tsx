import { AudioLines, Loader2, Mic, MicOff, Volume2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VoiceAssistantMode } from "@/lib/use-voice-assistant";

interface Props {
  open: boolean;
  mode: VoiceAssistantMode;
  level: number;
  transcript: string;
  error?: string | null;
  onClose: () => void;
}

function getStatusCopy(mode: VoiceAssistantMode, error?: string | null) {
  switch (mode) {
    case "listening":
      return {
        icon: <Mic className="h-3.5 w-3.5" />,
        title: "Listening",
        body: "Speak naturally. I will send it once you pause.",
      };
    case "processing":
      return {
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
        title: "Processing",
        body: "Jarvis is working on your request now.",
      };
    case "speaking":
      return {
        icon: <Volume2 className="h-3.5 w-3.5" />,
        title: "Speaking",
        body: "Jarvis voice is reading the spoken version aloud.",
      };
    case "unsupported":
      return {
        icon: <MicOff className="h-3.5 w-3.5" />,
        title: "Unsupported",
        body: error ?? "This browser does not support voice capture.",
      };
    case "error":
      return {
        icon: <MicOff className="h-3.5 w-3.5" />,
        title: "Voice error",
        body: error ?? "Something went wrong with voice interaction.",
      };
    default:
      return {
        icon: <AudioLines className="h-3.5 w-3.5" />,
        title: "Ready",
        body: "Voice interaction is standing by.",
      };
  }
}

export function VoiceOrb({ open, mode, level, transcript, error, onClose }: Props) {
  if (!open) return null;

  const scale = 1 + level * 0.35;
  const glow = 0.3 + level * 0.7;
  const copy = getStatusCopy(mode, error);

  return (
    <div
      className="absolute bottom-full left-0 right-0 z-30 mb-3 animate-in fade-in slide-in-from-bottom-4 duration-300"
      role="dialog"
      aria-label="Voice interaction"
    >
      <div className="relative overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-elevated">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(120% 80% at 50% 100%, oklch(from var(--foreground) l c h / 0.08), transparent 60%)",
          }}
        />

        <div className="flex items-center justify-between px-4 pt-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            {copy.icon}
            <span>{copy.title}</span>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Close voice interaction"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative flex h-52 items-center justify-center">
          <div
            className={cn(
              "relative flex items-center justify-center",
              mode === "processing" ? "orb-breathe" : "orb-spin",
            )}
            style={{
              transform: `scale(${scale})`,
              transition: "transform 90ms ease-out",
            }}
          >
            <div
              className="absolute h-44 w-44 rounded-full blur-2xl"
              style={{
                background:
                  "radial-gradient(circle at 50% 50%, oklch(0.85 0.12 250 / " +
                  glow * 0.7 +
                  "), transparent 65%)",
              }}
            />
            <div
              className="absolute h-32 w-32 rounded-full blur-xl"
              style={{
                background:
                  "radial-gradient(circle at 30% 30%, oklch(0.92 0.15 320 / " +
                  glow +
                  "), oklch(0.7 0.18 230 / " +
                  glow * 0.8 +
                  ") 50%, transparent 75%)",
              }}
            />
            <div className="orb-core relative h-28 w-28 rounded-full">
              <div className="orb-shine absolute inset-0 rounded-full" />
              <div className="orb-highlight absolute inset-0 rounded-full" />
            </div>
          </div>
        </div>

        <div className="px-4 pb-4">
          <div className="text-center text-[11px] text-muted-foreground/78">{copy.body}</div>
          <div
            className={cn(
              "mt-3 min-h-16 rounded-2xl border border-border/70 bg-background/40 px-4 py-3 text-sm leading-6",
              transcript ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {transcript || (mode === "listening" ? "Start speaking..." : "Waiting for voice activity...")}
          </div>
        </div>
      </div>
    </div>
  );
}
