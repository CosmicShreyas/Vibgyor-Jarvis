export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  /** data URL preview for images */
  preview?: string;
}

export type AssistantSkillId = "quote_builder";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
  createdAt: number;
  /** optional streaming flag */
  streaming?: boolean;
  feedback?: "like" | "dislike" | null;
}

export interface Thread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

export const STORAGE_KEY = "optimus.threads.v1";
