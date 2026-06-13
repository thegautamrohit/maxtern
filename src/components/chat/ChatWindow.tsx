"use client";

import { useState } from "react";
import { Message, ChatSession } from "@/types/chat";
import { DebugInfo } from "@/core/types";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import SourceSelector from "@/components/onboarding/SourceSelector";
import { toast } from "sonner";
import { FileText, Globe, GitBranch } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type ChatWindowProps = {
  session: ChatSession;
  onUpdateSession: (updated: ChatSession) => void;
};

export default function ChatWindow({ session, onUpdateSession }: ChatWindowProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [sourceDetermined, setSourceDetermined] = useState(false);

  const hasStarted = sourceDetermined || session.messages.length > 0;

  const handleIngest = async (
    type: "pdf" | "website" | "github",
    source: string,
    branch?: string,
  ) => {
    setIngesting(true);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, source, branch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ingestion failed");

      onUpdateSession({
        ...session,
        sourceType: type,
        documentIds: data.documentId,
        sourceLabel: source,
      });
      setSourceDetermined(true);
      toast.success("Document ingested successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ingestion failed");
    } finally {
      setIngesting(false);
    }
  };

  const handleSkip = () => {
    setSourceDetermined(true);
  };

  const handleSend = async (query: string) => {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: query,
    };

    const updatedSession: ChatSession = {
      ...session,
      title: session.title === "New Chat" ? query.slice(0, 40) : session.title,
      messages: [...session.messages, userMessage],
    };
    onUpdateSession(updatedSession);
    setIsLoading(true);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Query failed");

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.answer,
        debug: data.debugInfo as DebugInfo,
      };

      onUpdateSession({
        ...updatedSession,
        messages: [...updatedSession.messages, assistantMessage],
      });
    } catch (err) {
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: err instanceof Error ? err.message : "Something went wrong.",
      };
      onUpdateSession({
        ...updatedSession,
        messages: [...updatedSession.messages, errorMessage],
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {!hasStarted ? (
        <div className="flex-1 flex items-center justify-center">
          <SourceSelector
            onIngest={handleIngest}
            onSkip={handleSkip}
            disabled={ingesting}
          />
        </div>
      ) : (
        <>
          {session.sourceLabel && session.sourceType && (
            <div className="flex items-center justify-center px-4 py-2 border-b border-border bg-muted/20">
              <Badge variant="outline" className="flex items-center gap-1.5 text-xs font-normal max-w-sm truncate">
                {session.sourceType === "pdf" && <FileText className="h-3 w-3 shrink-0" />}
                {session.sourceType === "website" && <Globe className="h-3 w-3 shrink-0" />}
                {session.sourceType === "github" && <GitBranch className="h-3 w-3 shrink-0" />}
                <span className="truncate">{session.sourceLabel}</span>
              </Badge>
            </div>
          )}
          <MessageList messages={session.messages} isLoading={isLoading} />
        </>
      )}

      <MessageInput
        onSend={handleSend}
        disabled={isLoading || ingesting}
        placeholder={ingesting ? "Ingesting document..." : "Ask anything..."}
      />
    </div>
  );
}
