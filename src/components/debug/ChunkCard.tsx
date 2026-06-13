"use client";

import { RetrievedChunkDebug } from "@/core/types";
import { Badge } from "@/components/ui/badge";

type ChunkCardProps = {
  chunk: RetrievedChunkDebug;
  rank: number;
};

export default function ChunkCard({ chunk, rank }: ChunkCardProps) {
  return (
    <div className="rounded-lg border border-border bg-background p-3 text-xs flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-medium">#{rank}</span>
          <span className="font-medium truncate max-w-[150px]">{chunk.sourceTitle}</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {chunk.sourceType}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>chunk {chunk.chunkIndex}</span>
          <span className="font-mono text-green-600 dark:text-green-400">
            {(chunk.score * 100).toFixed(1)}%
          </span>
        </div>
      </div>
      <p className="text-muted-foreground leading-relaxed line-clamp-3">
        {chunk.contentPreview}
      </p>
    </div>
  );
}
