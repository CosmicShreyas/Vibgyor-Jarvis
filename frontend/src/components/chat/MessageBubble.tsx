import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Pencil,
  RefreshCw,
  SendHorizonal,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import type { Message } from "@/lib/chat-types";
import { Markdown } from "./Markdown";
import { AttachmentChip } from "./AttachmentChip";
import { JarvisLogo } from "@/components/JarvisLogo";

function parseThinking(content: string) {
  let answer = "";
  const thinkingParts: string[] = [];
  let cursor = 0;

  while (cursor < content.length) {
    const start = content.indexOf("<think>", cursor);
    if (start === -1) {
      answer += content.slice(cursor);
      break;
    }

    answer += content.slice(cursor, start);
    const thinkStart = start + "<think>".length;
    const end = content.indexOf("</think>", thinkStart);
    if (end === -1) {
      thinkingParts.push(content.slice(thinkStart));
      cursor = content.length;
      break;
    }

    thinkingParts.push(content.slice(thinkStart, end));
    cursor = end + "</think>".length;
  }

  return {
    thinking: thinkingParts.join("\n\n").trim(),
    answer: answer.trim(),
  };
}

export function MessageBubble({
  message,
  onRegenerate,
  onRate,
  onEdit,
}: {
  message: Message;
  onRegenerate: (assistantMessageId: string) => void;
  onRate: (assistantMessageId: string, feedback: "like" | "dislike") => void;
  onEdit: (userMessageId: string, content: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const isUser = message.role === "user";
  const parsed = useMemo(() => parseThinking(message.content), [message.content]);
  const displayText = parsed.answer || message.content;
  const hasThinking = Boolean(parsed.thinking);

  useEffect(() => {
    if (!editing) {
      setDraft(message.content);
    }
  }, [editing, message.content]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(displayText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  };

  const submitEdit = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === message.content) {
      setEditing(false);
      setDraft(message.content);
      return;
    }

    onEdit(message.id, trimmed);
    setEditing(false);
  };

  if (isUser) {
    return (
      <div className="group flex justify-end">
        <div className="max-w-[85%] space-y-2">
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {message.attachments.map((a) => (
                <AttachmentChip key={a.id} att={a} />
              ))}
            </div>
          )}
          {message.content && (
            <>
              <div className="rounded-2xl rounded-tr-md border border-border bg-surface-elevated px-4 py-2.5 text-[15px] leading-relaxed text-foreground shadow-soft">
                {editing ? (
                  <div className="space-y-3">
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          submitEdit();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setEditing(false);
                          setDraft(message.content);
                        }
                      }}
                      autoFocus
                      rows={Math.max(3, Math.min(8, draft.split("\n").length || 3))}
                      className="w-full resize-none rounded-xl border border-border/70 bg-background/50 px-3 py-2 text-[15px] leading-relaxed text-foreground outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          setEditing(false);
                          setDraft(message.content);
                        }}
                        className="flex h-8 items-center gap-1 rounded-full border border-border px-3 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                        aria-label="Cancel edit"
                      >
                        <X className="h-3.5 w-3.5" />
                        Cancel
                      </button>
                      <button
                        onClick={submitEdit}
                        className="flex h-8 items-center gap-1 rounded-full bg-foreground px-3 text-xs font-medium text-background transition hover:opacity-90"
                        aria-label="Send edited message"
                      >
                        <SendHorizonal className="h-3.5 w-3.5" />
                        Send
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{message.content}</div>
                )}
              </div>

              {!editing && (
                <div className="flex justify-end opacity-0 transition group-hover:opacity-100">
                  <button
                    onClick={() => setEditing(true)}
                    className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    aria-label="Edit message"
                  >
                    <Pencil className="h-3 w-3" />
                    Edit
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="group flex gap-4">
      <JarvisLogo
        alt="Jarvis"
        className="mt-0.5 h-8 w-8 shrink-0 rounded-lg border border-border/60 bg-background object-cover shadow-soft"
        roundedClassName="rounded-lg"
      />
      <div className="min-w-0 flex-1 pt-0.5">
        {message.streaming && !message.content ? (
          <div className="flex min-h-8 items-center gap-1.5 py-1">
            <span className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            <span className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            <span className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3 pt-0.5">
            {hasThinking && (
              <div className="overflow-hidden rounded-2xl border border-border bg-muted/35">
                <button
                  onClick={() => setThinkingOpen((open) => !open)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span className="shimmer-text text-sm font-bold">Thinking...</span>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition ${thinkingOpen ? "" : "-rotate-90"}`}
                  />
                </button>
                {thinkingOpen && (
                  <div className="border-t border-border px-4 py-3">
                    <div className="text-sm opacity-85">
                      <Markdown content={parsed.thinking} />
                    </div>
                  </div>
                )}
              </div>
            )}
            {parsed.answer ? (
              <div className="text-[1.02rem] leading-8">
                <Markdown content={parsed.answer} />
              </div>
            ) : message.streaming && hasThinking ? null : (
              <div className="text-[1.02rem] leading-8">
                <Markdown content={message.content} />
              </div>
            )}
          </div>
        )}

        {!message.streaming && displayText && (
          <div
            className={`mt-2 flex items-center gap-0.5 transition ${
              message.feedback ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            <button
              onClick={onCopy}
              className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Copy"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </button>
            <button
              onClick={() => onRegenerate(message.id)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Regenerate"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
            <button
              onClick={() => onRate(message.id, "like")}
              className={`flex h-7 w-7 items-center justify-center rounded-md border transition ${
                message.feedback === "like"
                  ? "border-primary/30 bg-primary/15 text-primary"
                  : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              aria-label="Good response"
            >
              <ThumbsUp className="h-3 w-3" />
            </button>
            <button
              onClick={() => onRate(message.id, "dislike")}
              className={`flex h-7 w-7 items-center justify-center rounded-md border transition ${
                message.feedback === "dislike"
                  ? "border-destructive/30 bg-destructive/15 text-destructive"
                  : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              aria-label="Bad response"
            >
              <ThumbsDown className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
