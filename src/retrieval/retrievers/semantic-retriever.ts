import qdrant from "@/vector/client";
import prisma from "@/db/client";
import { RetrievedChunk } from "@/core/types";
import { embedText } from "@/embeddings/embedder";

async function semanticRetrieval(
  query: string,
  documentIds?: string[],
): Promise<RetrievedChunk[]> {
  const queryVector = await embedText(query);

  const searchResults = await qdrant.search("chunks", {
    vector: queryVector,
    limit: 5,
         ...(documentIds && documentIds.length > 0
      ? {                                                                                                                                                        
          filter: {
            must: [{ key: "documentId", match: { any: documentIds } }],                                                                                          
          },                                                                                                                                                     
        }
      : {}), 
  });

  const retrievedChunkIds = searchResults
    .map((item) => item.payload?.chunkId)
    .filter((v): v is string => !!v);

  const retrievedChunks = await prisma.chunk.findMany({
    where: {
      id: { in: retrievedChunkIds },
    },
  });

  const retrievedChunkSourceAndScore = new Map<
    string,
    {
      score: number;
      sourceType: "pdf" | "website" | "github";
    }
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
      const chunkMetadata = retrievedChunkSourceAndScore.get(chunk.id);

      if (!chunkMetadata) {
        return null;
      }

      return {
        chunkId: chunk.id,
        documentId: chunk.documentId,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        score: chunkMetadata.score,
        sourceType: chunkMetadata.sourceType,
      };
    })
    .filter((chunk): chunk is RetrievedChunk => chunk !== null);
}

export default semanticRetrieval;
