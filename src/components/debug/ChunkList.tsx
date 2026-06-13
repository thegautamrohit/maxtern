"use client";

import { RetrievedChunkDebug } from "@/core/types";
import ChunkCard from "./ChunkCard";

type ChunkListProps = {
  chunks: RetrievedChunkDebug[];
};

export default function ChunkList({ chunks }: ChunkListProps) {
  if (chunks.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No chunks retrieved.</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {chunks.map((chunk, i) => (
        <ChunkCard key={chunk.chunkId} chunk={chunk} rank={i + 1} />
      ))}
    </div>
  );
}
