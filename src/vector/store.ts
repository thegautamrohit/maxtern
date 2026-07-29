import qdrant from "./client";
import prisma from "../db/client";
import { Chunk, Document, SparseVector } from "@/../src/core/types";

// Called inside prisma.$transaction — tx is a transaction-scoped client.
// Must use tx.chunk.create (not prisma.chunk.create) so the write is bound to the transaction.
// vectorized: false marks the chunk as pending Qdrant upsert — used for orphan detection
// and compensating rollback if the Qdrant phase fails.
export async function storeChunksInPostgres(
  tx: any,
  chunk: Chunk,
  documentId: string,
) {
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

// Upserts a single chunk point to Qdrant with both dense and sparse named vectors.
// The point ID is the same UUID as the PostgreSQL Chunk.id — shared key, no mapping layer needed.
// Payload stores only reference IDs and metadata — never content.
// Content lives exclusively in PostgreSQL (source of truth).
// userId in payload enables per-user filtering at Qdrant search time.
// This function must NOT swallow errors — if it fails, the caller runs the compensating rollback.
export async function upsertChunksInQdrant(
  chunk: Chunk,
  savedChunkId: string,
  documentId: string,
  sparseVector: SparseVector,
  vector: number[],
  userId: string,
) {
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

// Flips vectorized: true for all successfully upserted chunk IDs in a single updateMany call.
// Called only after ALL Qdrant upserts confirm — never per-chunk.
// A chunk with vectorized: false after ingestion is complete indicates a failed or partial upsert.
export async function markChunksVectorized(chunkIds: string[]) {
  await prisma.chunk.updateMany({
    where: { id: { in: chunkIds } },
    data: {
      vectorized: true,
    },
  });
}

// Writes the Document row to PostgreSQL and returns its ID.
// contentHash is spread from doc but also explicitly set — the non-null assertion (!)
// is safe here because contentHash is always set in ingest.ts before storeDocument is called.
export async function storeDocument(doc: Document): Promise<string> {
  const savedDocument = await prisma.document.create({
    data: {
      ...doc,
      contentHash: doc.contentHash!,
    },
  });
  return savedDocument.id;
}
