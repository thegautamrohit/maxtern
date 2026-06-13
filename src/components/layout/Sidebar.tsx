"use client";

import { ChatSession } from "@/types/chat";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Plus, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

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
    <div className="flex flex-col h-full bg-muted/30">
      {/* Header */}
      <div className="p-4">
        <span className="font-semibold text-base tracking-tight">Maxtern</span>
      </div>

      <Separator />

      {/* New Chat button */}
      <div className="p-3">
        <Button
          onClick={onNewChat}
          variant="outline"
          className="w-full justify-start gap-2"
        >
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </div>

      <Separator />

      {/* Chat list */}
      <ScrollArea className="flex-1 px-2 py-2">
        {sessions.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center mt-4">
            No chats yet
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => onSelectChat(session.id)}
                className={cn(
                  "flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm text-left transition-colors hover:bg-accent hover:text-accent-foreground",
                  activeChatId === session.id &&
                    "bg-accent text-accent-foreground font-medium",
                )}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{session.title}</span>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
