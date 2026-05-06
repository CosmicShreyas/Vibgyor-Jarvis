import type { AssistantSkillId, Attachment, Thread } from "./chat-types";
import type { QuoteBuilderConfig } from "./quote-builder-types";

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string | null;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  user: AuthUser;
}

interface VerificationStartResponse {
  message: string;
  expires_in_seconds: number;
}

interface VoiceBriefResponse {
  mode: "full" | "summary";
  speak_text: string;
}

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ??
  "http://localhost:8000/api/v1";

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let message = "Request failed";
    try {
      const payload = await response.json();
      message = payload.detail ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function getGoogleLoginUrl() {
  const redirectTo = `${window.location.origin}/login`;
  return `${API_BASE}/auth/google/login?redirect_to=${encodeURIComponent(redirectTo)}`;
}

export async function signInWithEmail(email: string, password: string) {
  return request<TokenResponse>("/auth/email/signin", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function signUpWithEmail(email: string, password: string) {
  return request<VerificationStartResponse>("/auth/email/request-code", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function verifyEmailSignUp(email: string, code: string) {
  return request<TokenResponse>("/auth/email/verify-signup", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

export async function fetchMe(token: string) {
  return request<AuthUser>("/auth/me", {}, token);
}

export async function fetchThreads(token: string) {
  return request<Thread[]>("/threads", {}, token);
}

export async function createThread(title: string, token: string) {
  return request<Thread>(
    "/threads",
    {
      method: "POST",
      body: JSON.stringify({ title }),
    },
    token,
  );
}

export async function renameThread(threadId: string, title: string, token: string) {
  return request<Thread>(
    `/threads/${threadId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ title }),
    },
    token,
  );
}

export async function deleteThread(threadId: string, token: string) {
  return request<void>(`/threads/${threadId}`, { method: "DELETE" }, token);
}

export async function fetchQuoteBuilderConfig(token: string) {
  return request<QuoteBuilderConfig>("/catalog/quote-builder", {}, token);
}

export async function updateQuoteBuilderConfig(config: QuoteBuilderConfig, token: string) {
  return request<QuoteBuilderConfig>(
    "/catalog/quote-builder",
    {
      method: "PUT",
      body: JSON.stringify({
        modules_by_group: config.modules_by_group,
        pricing_items: config.pricing_items,
      }),
    },
    token,
  );
}

export async function sendChatMessage(
  payload: {
    threadId?: string | null;
    content: string;
    attachments: Attachment[];
    skills?: AssistantSkillId[];
    skillConfigs?: Partial<Record<AssistantSkillId, string>>;
  },
  token: string,
) {
  return request<{ thread: Thread; assistant_message_id: string }>(
    "/chat/send",
    {
      method: "POST",
      body: JSON.stringify({
        thread_id: payload.threadId ?? null,
        content: payload.content,
        attachments: payload.attachments,
        skills: payload.skills ?? [],
        skill_configs: payload.skillConfigs ?? {},
      }),
    },
    token,
  );
}

export async function streamChatMessage(
  payload: {
    threadId?: string | null;
    content: string;
    attachments: Attachment[];
    skills?: AssistantSkillId[];
    skillConfigs?: Partial<Record<AssistantSkillId, string>>;
  },
  token: string,
  handlers: {
    onThread?: (threadId: string) => void;
    onDelta: (delta: string) => void;
    onDone: (result: { thread: Thread; assistant_message_id: string }) => void;
    onError: (message: string) => void;
  },
) {
  const response = await fetch(`${API_BASE}/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      thread_id: payload.threadId ?? null,
      content: payload.content,
      attachments: payload.attachments,
      skills: payload.skills ?? [],
      skill_configs: payload.skillConfigs ?? {},
    }),
  });

  if (!response.ok || !response.body) {
    let message = "Request failed";
    try {
      const parsed = await response.json();
      message = parsed.detail ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as
        | { type: "thread"; thread_id: string }
        | { type: "delta"; delta: string }
        | { type: "done"; thread: Thread; assistant_message_id: string }
        | { type: "error"; error: string };

      if (event.type === "thread") {
        handlers.onThread?.(event.thread_id);
      } else if (event.type === "delta") {
        handlers.onDelta(event.delta);
      } else if (event.type === "done") {
        handlers.onDone({ thread: event.thread, assistant_message_id: event.assistant_message_id });
      } else if (event.type === "error") {
        handlers.onError(event.error);
      }
    }
  }
}

export async function streamRegenerateMessage(
  payload: {
    threadId: string;
    assistantMessageId: string;
    skills?: AssistantSkillId[];
    skillConfigs?: Partial<Record<AssistantSkillId, string>>;
  },
  token: string,
  handlers: {
    onDelta: (delta: string) => void;
    onDone: (result: { thread: Thread; assistant_message_id: string }) => void;
    onError: (message: string) => void;
  },
) {
  const response = await fetch(`${API_BASE}/chat/regenerate-stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      thread_id: payload.threadId,
      assistant_message_id: payload.assistantMessageId,
      skills: payload.skills ?? [],
      skill_configs: payload.skillConfigs ?? {},
    }),
  });

  if (!response.ok || !response.body) {
    let message = "Request failed";
    try {
      const parsed = await response.json();
      message = parsed.detail ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as
        | { type: "delta"; delta: string }
        | { type: "done"; thread: Thread; assistant_message_id: string }
        | { type: "error"; error: string };

      if (event.type === "delta") {
        handlers.onDelta(event.delta);
      } else if (event.type === "done") {
        handlers.onDone({ thread: event.thread, assistant_message_id: event.assistant_message_id });
      } else if (event.type === "error") {
        handlers.onError(event.error);
      }
    }
  }
}

export async function setMessageFeedback(
  payload: { messageId: string; feedback: "like" | "dislike" | null },
  token: string,
) {
  return request<{ thread: Thread; assistant_message_id: string }>(
    `/chat/messages/${payload.messageId}/feedback`,
    {
      method: "PATCH",
      body: JSON.stringify({ feedback: payload.feedback }),
    },
    token,
  );
}

export async function streamEditMessage(
  payload: {
    threadId: string;
    userMessageId: string;
    content: string;
    skills?: AssistantSkillId[];
    skillConfigs?: Partial<Record<AssistantSkillId, string>>;
  },
  token: string,
  handlers: {
    onDelta: (delta: string) => void;
    onDone: (result: { thread: Thread; assistant_message_id: string }) => void;
    onError: (message: string) => void;
  },
) {
  const response = await fetch(`${API_BASE}/chat/edit-stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      thread_id: payload.threadId,
      user_message_id: payload.userMessageId,
      content: payload.content,
      skills: payload.skills ?? [],
      skill_configs: payload.skillConfigs ?? {},
    }),
  });

  if (!response.ok || !response.body) {
    let message = "Request failed";
    try {
      const parsed = await response.json();
      message = parsed.detail ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as
        | { type: "delta"; delta: string }
        | { type: "done"; thread: Thread; assistant_message_id: string }
        | { type: "error"; error: string };

      if (event.type === "delta") {
        handlers.onDelta(event.delta);
      } else if (event.type === "done") {
        handlers.onDone({ thread: event.thread, assistant_message_id: event.assistant_message_id });
      } else if (event.type === "error") {
        handlers.onError(event.error);
      }
    }
  }
}

export async function generateVoiceBrief(
  payload: {
    userPrompt: string;
    assistantResponse: string;
    model?: string | null;
    maxFullTextChars?: number;
    maxSummaryChars?: number;
  },
  token: string,
) {
  return request<VoiceBriefResponse>(
    "/chat/voice-brief",
    {
      method: "POST",
      body: JSON.stringify({
        user_prompt: payload.userPrompt,
        assistant_response: payload.assistantResponse,
        model: payload.model ?? null,
        max_full_text_chars: payload.maxFullTextChars ?? 220,
        max_summary_chars: payload.maxSummaryChars ?? 120,
      }),
    },
    token,
  );
}
