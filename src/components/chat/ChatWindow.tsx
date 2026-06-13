"use client";

import { useState } from "react";
import { Message, ChatSession } from "@/types/chat";
import { DebugInfo } from "@/core/types";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import SourceSelector from "@/components/onboarding/SourceSelector";
import { toast } from "sonner";
import { FileText, Globe, GitBranch } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type ChatWindowProps = {
  session: ChatSession;
  onUpdateSession: (updated: ChatSession) => void;
};

export default function ChatWindow({
  session,
  onUpdateSession,
}: ChatWindowProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

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
        documentIds: data.documentIds,
        sourceLabel: source,
      });
      setSheetOpen(false);
      toast.success("Document ingested successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ingestion failed");
    } finally {
      setIngesting(false);
    }
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
        body: JSON.stringify({ query, documentIds: session.documentIds }),
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
      {/* Source badge — shown after ingest, click to change */}
      {session.sourceLabel && session.sourceType && (
        <div className="flex items-center justify-center px-4 py-2 border-b border-border/50 bg-muted/20">
          <button
            onClick={() => setSheetOpen(true)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer group"
          >
            {session.sourceType === "pdf" && <FileText className="h-3 w-3 shrink-0" />}
            {session.sourceType === "website" && <Globe className="h-3 w-3 shrink-0" />}
            {session.sourceType === "github" && <GitBranch className="h-3 w-3 shrink-0" />}
            <span className="truncate max-w-xs">{session.sourceLabel}</span>
            <span className="opacity-0 group-hover:opacity-60 text-[10px] transition-opacity ml-1">· change</span>
          </button>
        </div>
      )}

      <MessageList messages={session.messages} isLoading={isLoading} />

      {/* Source selector sheet — opens from paperclip button */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] rounded-t-2xl">
          <SourceSelector
            onIngest={handleIngest}
            onSkip={() => setSheetOpen(false)}
            disabled={ingesting}
          />
        </SheetContent>
      </Sheet>

      <MessageInput
        onSend={handleSend}
        onAttachClick={() => setSheetOpen(true)}
        disabled={isLoading || ingesting}
        placeholder={ingesting ? "Ingesting document..." : "Ask anything..."}
      />
    </div>
  );
}
