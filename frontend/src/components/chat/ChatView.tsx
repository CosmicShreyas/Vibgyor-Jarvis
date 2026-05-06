import { useEffect, useRef } from "react";
import type { Thread } from "@/lib/chat-types";
import { MessageBubble } from "./MessageBubble";

export function ChatView({
  thread,
  onRegenerate,
  onRate,
  onEdit,
}: {
  thread: Thread;
  onRegenerate: (assistantMessageId: string) => void;
  onRate: (assistantMessageId: string, feedback: "like" | "dislike") => void;
  onEdit: (userMessageId: string, content: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const lastMessage = thread.messages[thread.messages.length - 1];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread.messages.length, lastMessage?.content]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-7 px-4 pb-8 pt-8 sm:px-6">
      {thread.messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          onRegenerate={onRegenerate}
          onRate={onRate}
          onEdit={onEdit}
        />
      ))}
      <div ref={endRef} />
    </div>
  );
}
