import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ChatView } from "@/components/chat/ChatView";
import { Composer } from "@/components/chat/Composer";
import { EmptyState } from "@/components/chat/EmptyState";
import { QuoteBuilderDataDialog } from "@/components/chat/QuoteBuilderDataDialog";
import { ThreadSidebar } from "@/components/chat/ThreadSidebar";
import { CHAT_SKILLS } from "@/lib/skills";
import { useThreads } from "@/lib/use-threads";

export const Route = createFileRoute("/")({
  component: Index,
});

function truncateTitle(title: string, maxLength: number) {
  if (title.length <= maxLength) return title;
  return `${title.slice(0, maxLength).trimEnd()}...`;
}

function Index() {
  const navigate = useNavigate();
  const { token, loading, signOut } = useAuth();
  const {
    threads,
    active,
    activeId,
    setActiveId,
    newThread,
    deleteThread,
    renameThread,
    sendMessage,
    regenerateMessage,
    rateMessage,
    editMessage,
    enabledSkills,
    skillConfigs,
    setSkillEnabled,
    saveSkillMarkdown,
  } = useThreads();
  const [collapsed, setCollapsed] = useState(false);
  const [quoteBuilderDataOpen, setQuoteBuilderDataOpen] = useState(false);

  useEffect(() => {
    if (!loading && !token) {
      void navigate({ to: "/login" });
    }
  }, [loading, navigate, token]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Checking session...
      </div>
    );
  }

  if (!token) {
    return null;
  }

  const onLogout = () => {
    signOut();
    void navigate({ to: "/login" });
  };

  const headerTitle = truncateTitle(active?.title ?? "New conversation", 40);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <ThreadSidebar
        threads={threads}
        activeId={activeId}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        onSelect={setActiveId}
        onNew={newThread}
        onRename={renameThread}
        onDelete={deleteThread}
        onOpenQuoteBuilderData={() => setQuoteBuilderDataOpen(true)}
      />

      <main className="relative flex min-w-0 flex-1 flex-col bg-surface">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[28rem] bg-[radial-gradient(60%_60%_at_50%_0%,oklch(from_var(--foreground)_l_c_h/0.05),transparent_70%)]"
        />
        <header className="relative z-10 flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-border/60 px-5 py-3 backdrop-blur-sm">
          <div className="min-w-0 flex-1 pr-3">
            <span className="block truncate font-serif text-[1.6rem] leading-[1.05] text-foreground">
              {headerTitle}
            </span>
          </div>
          <button
            onClick={onLogout}
            className="shrink-0 rounded-lg border border-destructive/20 bg-destructive/12 px-3 py-1.5 text-[11px] font-medium text-destructive transition hover:bg-destructive/18"
          >
            Logout
          </button>
        </header>

        <div className="relative z-10 min-h-0 flex-1 overflow-y-auto">
          {!active || active.messages.length === 0 ? (
            <EmptyState onPick={(p) => sendMessage(p)} />
          ) : (
            <ChatView
              thread={active}
              onRegenerate={regenerateMessage}
              onRate={rateMessage}
              onEdit={editMessage}
            />
          )}
        </div>

        <div className="relative z-10">
          <Composer
            onSend={(content, attachments, callbacks) => sendMessage(content, attachments, callbacks)}
            skills={CHAT_SKILLS}
            enabledSkills={enabledSkills}
            skillConfigs={skillConfigs}
            onToggleSkill={setSkillEnabled}
            onSaveSkillMarkdown={saveSkillMarkdown}
          />
        </div>
      </main>

      <QuoteBuilderDataDialog
        open={quoteBuilderDataOpen}
        onOpenChange={setQuoteBuilderDataOpen}
      />
    </div>
  );
}
