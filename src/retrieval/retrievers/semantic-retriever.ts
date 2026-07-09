import qdrant from "@/vector/client";
import prisma from "@/db/client";
import { RetrievedChunk, SourceType } from "@/core/types";
import { embedText } from "@/embeddings/embedder";
import { computeSparseVector } from "@/embeddings/sparse-embedder";

async function semanticRetrieval(
  query: string,
  userId: string,
  documentIds?: string[],
): Promise<RetrievedChunk[]> {
  const queryDenseVector = await embedText(query);
  const querySparseVector = computeSparseVector(query);

  const filter = {
    must: [
      { key: "userId", match: { value: userId } },
      ...(documentIds && documentIds.length > 0
        ? [{ key: "documentId", match: { any: documentIds } }]
        : []),
    ],
  };

  const denseResults = await qdrant.search("chunks", {
    vector: { name: "dense", vector: queryDenseVector },
    limit: 20,
    filter,
  });

  const sparseResults = await qdrant.search("chunks", {
    vector: { name: "sparse", vector: querySparseVector },
    limit: 20,
    filter,
  });

  // RRF (Reciprocal Rank Fusion) Implementation, (for ranking of chunks from both searches)
  const K = 60;
  const rrfScores = new Map<string, number>();

  denseResults.forEach((item, index) => {
    // treating index as rank here
    const id = item.payload?.chunkId as string;
    rrfScores.set(id, (rrfScores.get(id) ?? 0) + 1 / (K + index + 1));
  });

  sparseResults.forEach((item, index) => {
    const id = item?.payload?.chunkId as string;
    rrfScores.set(id, (rrfScores?.get(id) ?? 0) + 1 / (K + index + 1));
  });

  // Sort by RRF scores to get top chunks
  const topChunks = [...rrfScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  const retrievedChunks = await prisma.chunk.findMany({
    where: {
      id: { in: topChunks },
    },
  });

  const retrievedChunkSource = new Map<
    string,
    {
      sourceType: SourceType;
    }
  >(
    [...denseResults, ...sparseResults].map((item) => [
      item.payload?.chunkId as string,
      {
        sourceType: item.payload?.sourceType as SourceType,
      },
    ]),
  );

  return retrievedChunks
    .map((chunk) => {
      const chunkSource = retrievedChunkSource.get(chunk.id);
      const chunkScore = rrfScores.get(chunk.id);

      if (!chunkSource || !chunkScore) {
        return null;
      }

      return {
        chunkId: chunk.id,
        documentId: chunk.documentId,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        score: chunkScore,
        sourceType: chunkSource.sourceType,
      };
    })
    .filter((chunk): chunk is RetrievedChunk => chunk !== null);
}

export default semanticRetrieval;
