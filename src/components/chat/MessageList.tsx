"use client";

import { useEffect, useRef } from "react";
import { Message } from "@/types/chat";
import MessageBubble from "./MessageBubble";
import { ScrollArea } from "@/components/ui/scroll-area";

type MessageListProps = {
  messages: Message[];
  isLoading: boolean;
};

export default function MessageList({ messages, isLoading }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="flex flex-col gap-3 md:gap-4 px-3 md:px-4 py-4 md:py-6 max-w-3xl mx-auto w-full min-h-[calc(100vh-10rem)]">
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center select-none py-32">
            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
              <span className="text-lg font-bold text-primary">M</span>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold tracking-tight">How can I help?</p>
              <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
                Attach a PDF, website, or GitHub repo — or just ask anything.
              </p>
            </div>
          </div>
        )}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {isLoading && (
          <div className="flex items-start">
            <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-muted-foreground">
              <span className="animate-pulse">Thinking...</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
