import qdrant from "./client";
import prisma from "../db/client";
import { Chunk, Document, SparseVector } from "@/../src/core/types";

export async function storeChunksInPostgres(
  tx: any,
  chunk: Chunk,
  documentId: string,
) {
  // Store in Postgres

  const savedChunk = await tx.chunk.create({
    data: {
      content: chunk.content,
      chunkIndex: chunk.chunkIndex,
      metadata: chunk.metadata,
      documentId,
      vectorized: false,
    },
  });

  return savedChunk;
}

export async function upsertChunksInQdrant(
  chunk: Chunk,
  savedChunkId: string,
  documentId: string,
  sparseVector: SparseVector,
  vector: number[],
  userId: string,
) {
  // Store in Qdrant
  await qdrant.upsert("chunks", {
    points: [
      {
        id: savedChunkId,
        vector: { dense: vector, sparse: sparseVector },
        payload: {
          chunkId: savedChunkId,
          documentId: documentId,
          sourceType: chunk.metadata.sourceType,
          userId,
        },
      },
    ],
  });
}

export async function markChunksVectorized(chunkIds: string[]) {
  await prisma.chunk.updateMany({
    where: { id: { in: chunkIds } },
    data: {
      vectorized: true,
    },
  });
}

export async function storeDocument(doc: Document): Promise<string> {
  const savedDocument = await prisma.document.create({
    data: {
      ...doc,
      contentHash: doc.contentHash!,
    },
  });
  return savedDocument.id;
}
