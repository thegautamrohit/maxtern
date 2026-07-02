import qdrant from "@/vector/client";
import prisma from "@/db/client";
import { RetrievedChunk } from "@/core/types";
import { embedText } from "@/embeddings/embedder";

// Dense Retrieval — semantic similarity
async function denseRetrieval(
  query: string,
  documentIds?: string[],
): Promise<RetrievedChunk[]> {
  const queryVector = await embedText(query);

  const filter =
    documentIds && documentIds.length > 0
      ? {
          must: [{ key: "documentId", match: { any: documentIds } }],
        }
      : undefined;

  const results = await qdrant.search("chunks", {
    vector: { name: "dense", vector: queryVector },
    limit: 5,
    filter,
  });

  const chunkIds = results
    .map((item) => item.payload?.chunkId)
    .filter((v): v is string => !!v);

  const chunks = await prisma.chunk.findMany({
    where: { id: { in: chunkIds } },
  });

  const scoreMap = new Map(
    results.map((item) => [
      item.payload?.chunkId as string,
      {
        score: item.score as number,
        sourceType: item.payload?.sourceType as "pdf" | "website" | "github",
      },
    ]),
  );

  return chunks
    .map((chunk) => {
      const meta = scoreMap.get(chunk.id);
      if (!meta) return null;
      return {
        chunkId: chunk.id,
        documentId: chunk.documentId,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        score: meta.score,
        sourceType: meta.sourceType,
      };
    })
    .filter((c): c is RetrievedChunk => c !== null)
    .sort((a, b) => b.score - a.score);
}

export default denseRetrieval;
