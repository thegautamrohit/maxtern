"use client";

import { Message } from "@/types/chat";
import { cn } from "@/lib/utils";
import DebugPanel from "@/components/debug/DebugPanel";

type MessageBubbleProps = {
  message: Message;
};

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[88%] md:max-w-[70%] rounded-2xl px-3 py-2.5 md:px-4 md:py-3 text-xs md:text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm shadow-md shadow-primary/20"
            : "bg-card text-foreground rounded-bl-sm border border-border/60 shadow-sm",
        )}
      >
        {message.content}
      </div>

      {/* Debug panel — only for assistant messages with debug info */}
      {!isUser && message.debug && (
        <div className="max-w-[85%] md:max-w-[70%] w-full">
          <DebugPanel debug={message.debug} />
        </div>
      )}
    </div>
  );
}
