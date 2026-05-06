import { useState } from "react";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  MoreHorizontal,
  Pencil,
  Settings2,
  Trash2,
  Search,
  MessageSquare,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { JarvisLogo } from "@/components/JarvisLogo";
import type { Thread } from "@/lib/chat-types";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "./ThemeToggle";

interface Props {
  threads: Thread[];
  activeId: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onOpenQuoteBuilderData: () => void;
}

function groupThreads(threads: Thread[]) {
  const now = Date.now();
  const day = 86400000;
  const groups: Record<string, Thread[]> = {
    Today: [],
    Yesterday: [],
    "This week": [],
    Earlier: [],
  };
  for (const t of threads) {
    const age = now - t.updatedAt;
    if (age < day) groups.Today.push(t);
    else if (age < 2 * day) groups.Yesterday.push(t);
    else if (age < 7 * day) groups["This week"].push(t);
    else groups.Earlier.push(t);
  }
  return groups;
}

export function ThreadSidebar({
  threads,
  activeId,
  collapsed,
  onToggle,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onOpenQuoteBuilderData,
}: Props) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const filtered = query
    ? threads.filter((t) => t.title.toLowerCase().includes(query.toLowerCase()))
    : threads;
  const groups = groupThreads(filtered);

  if (collapsed) {
    return (
      <aside className="flex h-full w-14 flex-col items-center border-r border-sidebar-border bg-sidebar py-3">
        <button
          onClick={onToggle}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-foreground"
          aria-label="Open sidebar"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
        <button
          onClick={onNew}
          className="mt-2 flex h-9 w-9 items-center justify-center rounded-lg text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-foreground"
          aria-label="New chat"
        >
          <Plus className="h-4 w-4" />
        </button>
        <div className="mt-auto">
          <ThemeToggle compact />
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-3 pb-3 pt-3">
        <div className="flex min-w-0 items-center gap-3">
          <JarvisLogo
            alt="Jarvis"
            className="h-10 w-10 shrink-0 shadow-soft ring-1 ring-border/50"
            roundedClassName="rounded-xl"
          />
          <span className="truncate font-serif text-[1.45rem] leading-none text-sidebar-foreground">
            Jarvis
          </span>
        </div>
        <button
          onClick={onToggle}
          className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/60 transition hover:bg-sidebar-accent hover:text-sidebar-foreground"
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      {/* New chat */}
      <div className="px-3 pt-1">
        <button
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-surface-elevated px-3 py-2 text-sm font-medium text-sidebar-foreground shadow-soft transition hover:border-border-strong"
        >
          <Plus className="h-4 w-4" />
          New chat
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sidebar-foreground/50" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="w-full rounded-md border border-transparent bg-sidebar-accent/60 py-1.5 pl-8 pr-2 text-sm text-sidebar-foreground placeholder:text-sidebar-foreground/40 outline-none transition focus:border-border-strong focus:bg-sidebar-accent"
          />
        </div>
      </div>

      {/* Threads */}
      <nav className="mt-2 flex-1 overflow-y-auto px-2 pb-2">
        {threads.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-sidebar-foreground/50">
            No conversations yet.
            <br />
            Start a new chat below.
          </div>
        ) : (
          Object.entries(groups).map(
            ([label, list]) =>
              list.length > 0 && (
                <div key={label} className="mb-3">
          <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/40">
                    {label}
                  </div>
                  <ul className="space-y-0.5">
                    {list.map((t) => {
                      const isActive = t.id === activeId;
                      const isRenaming = renamingId === t.id;
                      return (
                        <li key={t.id}>
                          <div
                            className={cn(
                              "group relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition",
                              isActive
                                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                            )}
                          >
                            <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
                            {isRenaming ? (
                              <input
                                autoFocus
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onBlur={() => {
                                  onRename(t.id, renameValue);
                                  setRenamingId(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    onRename(t.id, renameValue);
                                    setRenamingId(null);
                                  } else if (e.key === "Escape") {
                                    setRenamingId(null);
                                  }
                                }}
                                className="flex-1 rounded border border-border-strong bg-background px-1 py-0.5 text-sm outline-none"
                              />
                            ) : (
                              <button
                                onClick={() => onSelect(t.id)}
                                className="flex-1 truncate text-left"
                              >
                                {t.title}
                              </button>
                            )}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  className={cn(
                                    "flex h-6 w-6 shrink-0 items-center justify-center rounded text-sidebar-foreground/60 opacity-0 transition hover:bg-background/40 hover:text-sidebar-foreground group-hover:opacity-100",
                                    isActive && "opacity-100",
                                  )}
                                  aria-label="Thread options"
                                >
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-40">
                                <DropdownMenuItem
                                  onClick={() => {
                                    setRenamingId(t.id);
                                    setRenameValue(t.title);
                                  }}
                                >
                                  <Pencil className="mr-2 h-3.5 w-3.5" />
                                  Rename
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => onDelete(t.id)}
                                >
                                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ),
          )
        )}
      </nav>

      {/* Footer */}
      <div className="space-y-3 border-t border-sidebar-border p-3">
        <div className="space-y-2">
          <div className="flex justify-end">
            <ThemeToggle />
          </div>
          <button
            onClick={onOpenQuoteBuilderData}
            className="flex w-full items-center gap-2 rounded-xl border border-sidebar-border bg-surface-elevated px-3 py-2 text-sm font-medium text-sidebar-foreground shadow-soft transition hover:border-border-strong hover:bg-sidebar-accent/40"
          >
            <Settings2 className="h-4 w-4" />
            Skill settings
          </button>
        </div>
        {user && (
          <div className="flex items-center gap-3 rounded-xl border border-sidebar-border bg-surface-elevated px-3 py-2.5 shadow-soft">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent text-sm font-medium text-accent-foreground">
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.full_name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span>{(user.full_name || user.email).slice(0, 1).toUpperCase()}</span>
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-sidebar-foreground">
                {user.full_name || user.email}
              </div>
              <div className="truncate text-[11px] text-sidebar-foreground/55">
                {user.email}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
