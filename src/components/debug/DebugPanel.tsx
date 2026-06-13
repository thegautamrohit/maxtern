"use client";

import { useState } from "react";
import { DebugInfo } from "@/core/types";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import DebugSummaryBar from "./DebugSummaryBar";
import RetrieverBadge from "./RetrieverBadge";
import ChunkList from "./ChunkList";
import TokenUsage from "./TokenUsage";
import { ChevronDown, ChevronUp } from "lucide-react";

type DebugPanelProps = {
  debug: DebugInfo;
};

export default function DebugPanel({ debug }: DebugPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-border/60 bg-card text-xs overflow-hidden shadow-sm">
      {/* Summary bar — always visible */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/40 transition-colors cursor-pointer"
      >
        <DebugSummaryBar debug={debug} />
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="flex flex-col px-3 py-3 gap-3">
          <Separator />

          <div>
            <p className="text-muted-foreground mb-1.5 font-medium">Retriever</p>
            <RetrieverBadge
              strategy={debug.selectedRetriever}
              reasons={debug.retrievalReason}
            />
          </div>

          <Separator />

          <div className="flex flex-col min-h-0">
            <p className="text-muted-foreground mb-1.5 font-medium">
              Retrieved Chunks ({debug.retrievedChunks})
            </p>
            <div className="max-h-48 overflow-y-auto">
              <ChunkList chunks={debug.chunks} />
            </div>
          </div>

          {debug.tokens && (
            <>
              <Separator />
              <div>
                <p className="text-muted-foreground mb-1.5 font-medium">Token Usage</p>
                <TokenUsage tokens={debug.tokens} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
