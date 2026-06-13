"use client";

import { useState, useEffect } from "react";
import { ChatSession } from "@/types/chat";
import ChatLayout from "@/components/layout/ChatLayout";
import Sidebar from "@/components/layout/Sidebar";
import ChatWindow from "@/components/chat/ChatWindow";

const SESSIONS_KEY = "maxtern:sessions";
const ACTIVE_KEY = "maxtern:activeChatId";

function createSession(): ChatSession {
  return {
    id: crypto.randomUUID(),
    title: "New Chat",
    messages: [],
    createdAt: new Date(),
  };
}

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [createSession()];
    const parsed = JSON.parse(raw) as ChatSession[];
    // createdAt is serialized as string — convert back to Date
    return parsed.map((s) => ({ ...s, createdAt: new Date(s.createdAt) }));
  } catch {
    return [createSession()];
  }
}

function loadActiveChatId(sessions: ChatSession[]): string {
  try {
    const saved = localStorage.getItem(ACTIVE_KEY);
    if (saved && sessions.find((s) => s.id === saved)) return saved;
  } catch {}
  return sessions[0].id;
}

export default function ChatPage() {
  const [sessions, setSessions] = useState<ChatSession[]>(() => [createSession()]);
  const [activeChatId, setActiveChatId] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage after mount (client-only)
  useEffect(() => {
    const loaded = loadSessions();
    setSessions(loaded);
    setActiveChatId(loadActiveChatId(loaded));
    setHydrated(true);
  }, []);

  // Persist sessions on every change
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  }, [sessions, hydrated]);

  // Persist active chat id
  useEffect(() => {
    if (!hydrated || !activeChatId) return;
    localStorage.setItem(ACTIVE_KEY, activeChatId);
  }, [activeChatId, hydrated]);

  const activeSession = sessions.find((s) => s.id === activeChatId) ?? sessions[0];

  const handleNewChat = () => {
    const session = createSession();
    setSessions((prev) => [session, ...prev]);
    setActiveChatId(session.id);
  };

  const handleUpdateSession = (updated: ChatSession) => {
    setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  if (!hydrated) return null;

  return (
    <ChatLayout
      sidebar={
        <Sidebar
          sessions={sessions}
          activeChatId={activeChatId}
          onNewChat={handleNewChat}
          onSelectChat={setActiveChatId}
        />
      }
    >
      <ChatWindow
        session={activeSession}
        onUpdateSession={handleUpdateSession}
      />
    </ChatLayout>
  );
}
