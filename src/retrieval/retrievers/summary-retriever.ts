import qdrant from "@/vector/client";
import prisma from "@/db/client";
import { embedText } from "@/embeddings/embedder";
import { RetrievedChunk } from "@/core/types";

async function summaryRetriever(
  query: string,
  documentIds?: string[],
): Promise<RetrievedChunk[]> {
  const searchVector = await embedText(query);
  const searchResults = await qdrant.search("chunks", {
    limit: 20,
    vector: searchVector,
    ...(documentIds && documentIds.length > 0
      ? {
          filter: {
            must: [{ key: "documentId", match: { any: documentIds } }],
          },
        }
      : {}),
  });

  const retrievedChunkIds = searchResults
    .map((item) => item?.payload?.chunkId)
    .filter((v): v is string => !!v);

  const retrievedChunks = await prisma.chunk.findMany({
    where: {
      id: { in: retrievedChunkIds },
    },
  });

  const retrievedChunkSourceAndScore = new Map<
    string,
    { score: number; sourceType: "pdf" | "website" | "github" }
  >(
    searchResults.map((item) => [
      item.payload?.chunkId as string,
      {
        score: item.score as number,
        sourceType: item.payload?.sourceType as "pdf" | "website" | "github",
      },
    ]),
  );

  return retrievedChunks
    .map((chunk) => {
      const chunkMetaData = retrievedChunkSourceAndScore.get(chunk.id);

      if (!chunkMetaData) {
        return null;
      }

      return {
        chunkId: chunk.id,
        documentId: chunk.documentId,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        score: chunkMetaData.score,
        sourceType: chunkMetaData.sourceType,
      };
    })
    .filter((v): v is RetrievedChunk => !!v);
}

export default summaryRetriever;
