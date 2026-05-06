import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { cn } from "@/lib/utils";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const order: Array<"light" | "dark" | "system"> = ["light", "dark", "system"];
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  if (compact) {
    return (
      <button
        onClick={() => setTheme(order[(order.indexOf(theme) + 1) % order.length])}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-foreground"
        aria-label="Toggle theme"
        title={`Theme: ${theme}`}
      >
        <Icon className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-0.5 rounded-full border border-sidebar-border bg-background/40 p-0.5">
      {order.map((opt) => {
        const Opt = opt === "light" ? Sun : opt === "dark" ? Moon : Monitor;
        const active = theme === opt;
        return (
          <button
            key={opt}
            onClick={() => setTheme(opt)}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full text-sidebar-foreground/60 transition",
              active && "bg-sidebar-accent text-sidebar-foreground shadow-soft",
            )}
            aria-label={`${opt} theme`}
            title={`${opt[0].toUpperCase()}${opt.slice(1)}`}
          >
            <Opt className="h-3 w-3" />
          </button>
        );
      })}
    </div>
  );
}
