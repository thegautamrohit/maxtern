import qdrant from "./client";
import prisma from "../db/client";
import { Chunk, Document } from "@/../src/core/types";

export async function storeChunk(
  chunk: Chunk,
  vector: number[],
  documentid: string,
) {
  // Store in Postgres

  const savedChunk = await prisma.chunk.create({
    data: {
      content: chunk.content,
      chunkIndex: chunk.chunkIndex,
      metadata: chunk.metadata,
      documentId: documentid,
    },
  });

  // Store in Qdrant

  await qdrant.upsert("chunks", {
    points: [
      {
        id: savedChunk.id,
        vector: vector,
        payload: {
          chunkId: savedChunk.id,
          documentId: documentid,
          sourceType: chunk.metadata.sourceType,
        },
      },
    ],
  });
}

export async function storeDocument(doc: Document): Promise<string> {
  const savedDocument = await prisma.document.create({
    data: {
      ...doc,
    },
  });
  return savedDocument.id;
}
