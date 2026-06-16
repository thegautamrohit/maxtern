"use client";

import { useState, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SendHorizontal, Paperclip } from "lucide-react";

type MessageInputProps = {
  onSend: (message: string) => void;
  onAttachClick?: () => void;
  disabled?: boolean;
  placeholder?: string;
};

export default function MessageInput({
  onSend,
  onAttachClick,
  disabled = false,
  placeholder = "Ask anything...",
}: MessageInputProps) {
  const [value, setValue] = useState("");

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-border/50 bg-background px-3 md:px-4 pt-2.5 md:pt-3 pb-3 md:pb-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-end gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 focus-within:border-primary/40 focus-within:bg-muted/60 transition-colors">
          <Button
            onClick={onAttachClick}
            disabled={disabled}
            size="icon"
            variant="ghost"
            className="h-8 w-8 flex-shrink-0 text-muted-foreground hover:text-foreground mb-0.5"
          >
            <Paperclip className="h-4 w-4" />
          </Button>

          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="flex-1 resize-none min-h-[36px] max-h-32 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/50 text-sm"
          />

          <Button
            onClick={handleSend}
            disabled={disabled || !value.trim()}
            size="icon"
            className="h-8 w-8 flex-shrink-0 rounded-lg mb-0.5"
          >
            <SendHorizontal className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-center text-[10px] text-muted-foreground/40 mt-2">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
