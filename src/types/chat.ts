import { DebugInfo } from "@/core/types";

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  debug?: DebugInfo;
};

export type ChatSession = {
  id: string;
  title: string;
  documentIds?: string[];
  sourceType?: "pdf" | "website" | "github";
  messages: Message[];
  createdAt: Date;
  sourceLabel?: string;
};
