import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  createThread as createThreadRequest,
  deleteThread as deleteThreadRequest,
  fetchThreads,
  renameThread as renameThreadRequest,
  setMessageFeedback,
  streamChatMessage,
  streamEditMessage,
  streamRegenerateMessage,
} from "@/lib/api";
import { CHAT_SKILLS } from "@/lib/skills";
import type { AssistantSkillId, Attachment, Message, Thread } from "./chat-types";

const THREAD_TITLE_PREVIEW_LENGTH = 120;
const SKILLS_STORAGE_KEY = "optimus.chat-skills.v1";
const SKILL_CONFIGS_STORAGE_KEY = "optimus.chat-skill-configs.v1";
const VALID_SKILL_IDS = new Set<AssistantSkillId>(CHAT_SKILLS.map((skill) => skill.id));

function normalizeStoredSkillId(value: unknown): AssistantSkillId | null {
  if (value === "kitchen_pricing") {
    return "quote_builder";
  }
  if (typeof value === "string" && VALID_SKILL_IDS.has(value as AssistantSkillId)) {
    return value as AssistantSkillId;
  }
  return null;
}

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

interface AssistantSendCallbacks {
  onAssistantDone?: (assistantText: string) => void;
  onAssistantError?: (message: string) => void;
}

export function useThreads() {
  const { token } = useAuth();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [enabledSkills, setEnabledSkills] = useState<AssistantSkillId[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(SKILLS_STORAGE_KEY) ?? "[]");
      if (!Array.isArray(parsed)) return [];
      return Array.from(
        new Set(
          parsed
            .map((item) => normalizeStoredSkillId(item))
            .filter((item): item is AssistantSkillId => item !== null),
        ),
      );
    } catch {
      return [];
    }
  });
  const [skillConfigs, setSkillConfigs] = useState<Partial<Record<AssistantSkillId, string>>>(() => {
    const defaults = Object.fromEntries(
      CHAT_SKILLS.map((skill) => [skill.id, skill.defaultMarkdown]),
    ) as Partial<Record<AssistantSkillId, string>>;
    if (typeof window === "undefined") return defaults;
    try {
      const parsed = JSON.parse(window.localStorage.getItem(SKILL_CONFIGS_STORAGE_KEY) ?? "{}");
      return { ...defaults, ...(parsed as Partial<Record<AssistantSkillId, string>>) };
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(enabledSkills));
  }, [enabledSkills]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SKILL_CONFIGS_STORAGE_KEY, JSON.stringify(skillConfigs));
  }, [skillConfigs]);

  useEffect(() => {
    if (!token) {
      setThreads([]);
      setActiveId(null);
      setHydrated(false);
      return;
    }

    setHydrated(false);
    void fetchThreads(token)
      .then((initial) => {
        setThreads(initial);
        setActiveId((prev) =>
          prev && initial.some((thread) => thread.id === prev) ? prev : (initial[0]?.id ?? null),
        );
      })
      .finally(() => setHydrated(true));
  }, [token]);

  const active = threads.find((thread) => thread.id === activeId) ?? null;

  const newThread = useCallback(() => {
    if (!token) return null;
    void createThreadRequest("New conversation", token).then((thread) => {
      setThreads((prev) => [thread, ...prev]);
      setActiveId(thread.id);
    });
    return null;
  }, [token]);

  const deleteThread = useCallback(
    (id: string) => {
      if (!token) return;
      void deleteThreadRequest(id, token).then(() => {
        setThreads((prev) => {
          const next = prev.filter((thread) => thread.id !== id);
          if (activeId === id) setActiveId(next[0]?.id ?? null);
          return next;
        });
      });
    },
    [activeId, token],
  );

  const renameThread = useCallback(
    (id: string, title: string) => {
      if (!token) return;
      void renameThreadRequest(id, title, token).then((thread) => {
        setThreads((prev) => prev.map((item) => (item.id === id ? thread : item)));
      });
    },
    [token],
  );

  const setSkillEnabled = useCallback((skillId: AssistantSkillId, enabled: boolean) => {
    setEnabledSkills((prev) => {
      if (enabled) {
        return prev.includes(skillId) ? prev : [...prev, skillId];
      }
      return prev.filter((item) => item !== skillId);
    });
  }, []);

  const saveSkillMarkdown = useCallback((skillId: AssistantSkillId, markdown: string) => {
    setSkillConfigs((prev) => ({ ...prev, [skillId]: markdown }));
    setEnabledSkills((prev) => (prev.includes(skillId) ? prev : [...prev, skillId]));
  }, []);

  const sendMessage = useCallback(
    (
      content: string,
      attachments: Attachment[] = [],
      callbacks?: AssistantSendCallbacks,
    ) => {
      if (!token) return;
      const now = Date.now();
      const currentThreadId = activeId;
      const tempThreadId = currentThreadId ?? `temp-${uid()}`;
      const userMessage: Message = {
        id: uid(),
        role: "user",
        content,
        attachments,
        createdAt: now,
      };
      const assistantPlaceholder: Message = {
        id: uid(),
        role: "assistant",
        content: "",
        createdAt: now + 1,
        streaming: true,
      };

      setThreads((prev) => {
        const existing = prev.find((thread) => thread.id === tempThreadId);
        if (!existing) {
          const nextThread: Thread = {
            id: tempThreadId,
            title: content.slice(0, THREAD_TITLE_PREVIEW_LENGTH) || "New conversation",
            createdAt: now,
            updatedAt: now,
            messages: [userMessage, assistantPlaceholder],
          };
          return [nextThread, ...prev];
        }

        return prev.map((thread) =>
          thread.id === tempThreadId
            ? {
                ...thread,
                title:
                  thread.messages.length === 0 || thread.title === "New conversation"
                    ? content.slice(0, THREAD_TITLE_PREVIEW_LENGTH) || thread.title
                    : thread.title,
                updatedAt: now,
                messages: [...thread.messages, userMessage, assistantPlaceholder],
              }
            : thread,
        );
      });
      setActiveId(tempThreadId);

      void streamChatMessage(
        { threadId: currentThreadId, content, attachments, skills: enabledSkills, skillConfigs },
        token,
        {
          onDelta: (delta) => {
            setThreads((prev) =>
              prev.map((thread) =>
                thread.id === tempThreadId
                  ? {
                      ...thread,
                      messages: thread.messages.map((item) =>
                        item.id === assistantPlaceholder.id
                          ? { ...item, content: item.content + delta, streaming: true }
                          : item,
                      ),
                    }
                  : thread,
              ),
            );
          },
          onDone: ({ thread, assistant_message_id }) => {
            setThreads((prev) => {
              const existingThread = prev.find((item) => item.id === tempThreadId || item.id === thread.id);
              const mergedThread =
                existingThread &&
                existingThread.messages.some((message) => message.id === assistantPlaceholder.id)
                  ? {
                      ...thread,
                      messages: existingThread.messages.map((message) =>
                        message.id === assistantPlaceholder.id
                          ? {
                              ...(thread.messages.find((item) => item.id === assistant_message_id) ?? message),
                              id: assistant_message_id,
                              streaming: false,
                            }
                          : message,
                      ),
                    }
                  : thread;
              const withoutOld = prev.filter(
                (item) => item.id !== tempThreadId && item.id !== thread.id,
              );
              return [mergedThread, ...withoutOld].sort((a, b) => b.updatedAt - a.updatedAt);
            });
            setActiveId(thread.id);
            const assistantMessage = thread.messages.find(
              (message) => message.id === assistant_message_id,
            );
            callbacks?.onAssistantDone?.(assistantMessage?.content ?? "");
          },
          onError: (message) => {
            setThreads((prev) =>
              prev.map((thread) =>
                thread.id === tempThreadId
                  ? {
                      ...thread,
                      messages: thread.messages.map((item) =>
                        item.id === assistantPlaceholder.id
                          ? { ...item, content: message, streaming: false }
                          : item,
                      ),
                    }
                  : thread,
              ),
            );
            callbacks?.onAssistantError?.(message);
          },
        },
      )
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Failed to send message";
          setThreads((prev) => {
            return prev.map((thread) =>
              thread.id === tempThreadId
                ? {
                    ...thread,
                    messages: thread.messages.map((item) =>
                      item.id === assistantPlaceholder.id
                        ? { ...item, content: message, streaming: false }
                        : item,
                    ),
                  }
                : thread,
            );
          });
          callbacks?.onAssistantError?.(message);
        });
    },
    [activeId, enabledSkills, skillConfigs, token],
  );

  const regenerateMessage = useCallback(
    (assistantMessageId: string) => {
      if (!token || !active) return;

      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === active.id
            ? {
                ...thread,
                updatedAt: Date.now(),
                messages: thread.messages.map((item) =>
                  item.id === assistantMessageId
                    ? {
                        ...item,
                        content: "",
                        streaming: true,
                        feedback: null,
                        createdAt: Date.now(),
                      }
                    : item,
                ),
              }
            : thread,
        ),
      );

      void streamRegenerateMessage(
        { threadId: active.id, assistantMessageId, skills: enabledSkills, skillConfigs },
        token,
        {
          onDelta: (delta) => {
            setThreads((prev) =>
              prev.map((thread) =>
                thread.id === active.id
                  ? {
                      ...thread,
                      messages: thread.messages.map((item) =>
                        item.id === assistantMessageId
                          ? { ...item, content: item.content + delta, streaming: true }
                          : item,
                      ),
                    }
                  : thread,
              ),
            );
          },
          onDone: ({ thread }) => {
            setThreads((prev) => prev.map((item) => (item.id === thread.id ? thread : item)));
            setActiveId(thread.id);
          },
          onError: (message) => {
            setThreads((prev) =>
              prev.map((thread) =>
                thread.id === active.id
                  ? {
                      ...thread,
                      messages: thread.messages.map((item) =>
                        item.id === assistantMessageId
                          ? { ...item, content: message, streaming: false }
                          : item,
                      ),
                    }
                  : thread,
              ),
            );
          },
        },
      ).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Failed to regenerate message";
        setThreads((prev) =>
          prev.map((thread) =>
            thread.id === active.id
              ? {
                  ...thread,
                  messages: thread.messages.map((item) =>
                    item.id === assistantMessageId
                      ? { ...item, content: message, streaming: false }
                      : item,
                  ),
                }
              : thread,
          ),
        );
      });
    },
    [active, enabledSkills, skillConfigs, token],
  );

  const rateMessage = useCallback(
    (messageId: string, feedback: "like" | "dislike") => {
      if (!token || !active) return;
      const current = active.messages.find((item) => item.id === messageId)?.feedback ?? null;
      const nextFeedback = current === feedback ? null : feedback;

      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === active.id
            ? {
                ...thread,
                messages: thread.messages.map((item) =>
                  item.id === messageId ? { ...item, feedback: nextFeedback } : item,
                ),
              }
            : thread,
        ),
      );

      void setMessageFeedback({ messageId, feedback: nextFeedback }, token).then(({ thread }) => {
        setThreads((prev) => prev.map((item) => (item.id === thread.id ? thread : item)));
      });
    },
    [active, token],
  );

  const editMessage = useCallback(
    (userMessageId: string, content: string) => {
      if (!token || !active) return;
      const trimmed = content.trim();
      if (!trimmed) return;

      const messageIndex = active.messages.findIndex((item) => item.id === userMessageId);
      if (messageIndex === -1) return;

      const now = Date.now();
      const assistantPlaceholder: Message = {
        id: uid(),
        role: "assistant",
        content: "",
        createdAt: now + 1,
        streaming: true,
      };

      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === active.id
            ? {
                ...thread,
                title:
                  messageIndex === 0
                    ? trimmed.slice(0, THREAD_TITLE_PREVIEW_LENGTH)
                    : thread.title,
                updatedAt: now,
                messages: [
                  ...thread.messages.slice(0, messageIndex).map((item) => ({ ...item })),
                  { ...thread.messages[messageIndex], content: trimmed, createdAt: now },
                  assistantPlaceholder,
                ],
              }
            : thread,
        ),
      );

      void streamEditMessage(
        { threadId: active.id, userMessageId, content: trimmed, skills: enabledSkills, skillConfigs },
        token,
        {
          onDelta: (delta) => {
            setThreads((prev) =>
              prev.map((thread) =>
                thread.id === active.id
                  ? {
                      ...thread,
                      messages: thread.messages.map((item) =>
                        item.id === assistantPlaceholder.id
                          ? { ...item, content: item.content + delta, streaming: true }
                          : item,
                      ),
                    }
                  : thread,
              ),
            );
          },
          onDone: ({ thread }) => {
            setThreads((prev) => prev.map((item) => (item.id === thread.id ? thread : item)));
            setActiveId(thread.id);
          },
          onError: (message) => {
            setThreads((prev) =>
              prev.map((thread) =>
                thread.id === active.id
                  ? {
                      ...thread,
                      messages: thread.messages.map((item) =>
                        item.id === assistantPlaceholder.id
                          ? { ...item, content: message, streaming: false }
                          : item,
                      ),
                    }
                  : thread,
              ),
            );
          },
        },
      ).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Failed to edit message";
        setThreads((prev) =>
          prev.map((thread) =>
            thread.id === active.id
              ? {
                  ...thread,
                  messages: thread.messages.map((item) =>
                    item.id === assistantPlaceholder.id
                      ? { ...item, content: message, streaming: false }
                      : item,
                  ),
                }
              : thread,
          ),
        );
      });
    },
    [active, enabledSkills, skillConfigs, token],
  );

  return {
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
    hydrated,
  };
}
