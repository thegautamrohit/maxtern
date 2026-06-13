"use client";

import { ChatSession } from "@/types/chat";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import ThemeToggle from "./ThemeToggle";

type SidebarProps = {
  sessions: ChatSession[];
  activeChatId?: string;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
};

export default function Sidebar({
  sessions,
  activeChatId,
  onNewChat,
  onSelectChat,
}: SidebarProps) {
  return (
    <div className="flex flex-col h-full bg-sidebar">
      {/* Header */}
      <div className="px-4 py-4">
        <span className="font-semibold text-xs tracking-widest uppercase text-primary">
          Maxtern
        </span>
      </div>

      {/* New Chat button */}
      <div className="px-3 pb-3">
        <Button
          onClick={onNewChat}
          variant="outline"
          className="w-full justify-start gap-2 h-9 text-xs border-border/60 bg-transparent hover:bg-accent hover:text-accent-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          New Chat
        </Button>
      </div>

      <div className="mx-3 mb-1 h-px bg-border/40" />

      {/* Chat list */}
      <ScrollArea className="flex-1 px-2 py-2">
        {sessions.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center mt-6">
            No chats yet
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => onSelectChat(session.id)}
                className={cn(
                  "flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-xs text-left transition-colors cursor-pointer text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  activeChatId === session.id &&
                    "bg-accent text-accent-foreground font-medium",
                )}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
                <span className="truncate">{session.title}</span>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Footer — theme toggle */}
      <div className="mx-3 h-px bg-border/40" />
      <div className="px-3 py-3">
        <ThemeToggle />
      </div>
    </div>
  );
}
