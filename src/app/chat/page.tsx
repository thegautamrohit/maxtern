"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChatSession } from "@/types/chat";
import ChatLayout from "@/components/layout/ChatLayout";
import Sidebar from "@/components/layout/Sidebar";
import ChatWindow from "@/components/chat/ChatWindow";

function createSession(): ChatSession {
  return {
    id: crypto.randomUUID(),
    title: "New Chat",
    messages: [],
    createdAt: new Date(),
  };
}

export default function ChatPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<ChatSession[]>([createSession()]);
  const [activeChatId, setActiveChatId] = useState<string>(sessions[0].id);

  const activeSession = sessions.find((s) => s.id === activeChatId) ?? sessions[0];

  const handleNewChat = () => {
    const session = createSession();
    setSessions((prev) => [session, ...prev]);
    setActiveChatId(session.id);
  };

  const handleUpdateSession = (updated: ChatSession) => {
    setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

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
