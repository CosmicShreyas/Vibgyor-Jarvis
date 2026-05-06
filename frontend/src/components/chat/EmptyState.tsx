import { Calculator, FileText, LampDesk, SwatchBook } from "lucide-react";
import { JarvisLogo } from "@/components/JarvisLogo";

const SUGGESTIONS = [
  {
    icon: Calculator,
    title: "Build a quote",
    prompt:
      "Build me a quote for a wall unit 4 ft x 2.5 ft, a base unit 120 cm x 85 cm, and a tall unit 24 in x 84 in in MR Ply with acrylic shutters.",
  },
  {
    icon: SwatchBook,
    title: "Suggest finishes",
    prompt:
      "Suggest three premium kitchen finish combinations for a modern warm-beige interior, including shutters, counters, and hardware mood.",
  },
  {
    icon: FileText,
    title: "Draft a client brief",
    prompt:
      "Create a polished client-facing summary for a 3BHK interior proposal with scope, design direction, deliverables, and next steps.",
  },
  {
    icon: LampDesk,
    title: "Plan a space",
    prompt:
      "Help me plan a compact modular kitchen layout for a 10 ft x 8 ft room with efficient storage, appliance placement, and workflow.",
  },
];

export function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center px-4">
      <div className="relative mb-6">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 rounded-2xl bg-foreground/20 blur-2xl"
        />
        <JarvisLogo
          alt="Jarvis"
          className="h-14 w-14 shadow-elevated ring-1 ring-foreground/10"
          roundedClassName="rounded-2xl"
        />
      </div>
      <h1 className="font-serif text-4xl tracking-tight text-foreground sm:text-5xl">
        How can I help you today?
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Ask anything. Attach files, paste images, or pick a starter below.
      </p>

      <div className="mt-10 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.title}
            onClick={() => onPick(s.prompt)}
            className="group flex items-start gap-3 rounded-xl border border-border bg-surface-elevated p-3 text-left shadow-soft transition hover:border-border-strong hover:shadow-elevated"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition group-hover:bg-foreground group-hover:text-background">
              <s.icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">{s.title}</div>
              <div className="truncate text-xs text-muted-foreground">{s.prompt}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
