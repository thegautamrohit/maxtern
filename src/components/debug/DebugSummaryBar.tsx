"use client";

import { DebugInfo } from "@/core/types";
import { Zap, Layers, Clock } from "lucide-react";

type DebugSummaryBarProps = {
  debug: DebugInfo;
};

export default function DebugSummaryBar({ debug }: DebugSummaryBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        <Zap className="h-3 w-3" />
        {debug.selectedRetriever}
      </span>
      <span className="flex items-center gap-1">
        <Layers className="h-3 w-3" />
        {debug.retrievedChunks} chunks
      </span>
      <span className="flex items-center gap-1">
        <Clock className="h-3 w-3" />
        {debug.executionTime}ms
      </span>
      {debug.tokens && <span>{debug.tokens.estimatedCost}</span>}
    </div>
  );
}
