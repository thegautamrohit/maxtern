import { loadPDF } from "../ingestion/loaders/pdf-loader";
import { loadWebsite } from "../ingestion/loaders/website-loader";
import { githubLoader } from "../ingestion/loaders/github-loader";
import { normalizeDocument } from "../ingestion/normalizers/document-normalizer";
import { storeDocument } from "../vector/store";
import { Chunk, Document, SourceType } from "../core/types";
import { markdownChunk } from "@/chunking/markdown-chunker";
import { recursiveChunk } from "@/chunking/recursive-chunker";
import { embedTexts } from "@/embeddings/embedder";
import { ensureCollections } from "@/vector/collection";
import { computeSparseVector } from "@/embeddings/sparse-embedder";
import { createHash } from "crypto";
import prisma from "@/db/client";
import {
  markChunksVectorized,
  storeChunksInPostgres,
  upsertChunksInQdrant,
} from "../vector/store";

async function processSingleDocument(
  doc: Document,
  sourceType: SourceType,
): Promise<string[]> {
  try {
    const normalisedDoc = normalizeDocument(doc);
    const contentHash = createHash("sha256")
      .update(normalisedDoc.content)
      .digest("hex");

    const existingDoc = await prisma.document.findUnique({
      where: {
        userId_contentHash: {
          userId: doc?.userId,
          contentHash: contentHash,
        },
      },
    });

    if (existingDoc) {
      console.log(
        `Document with contentHash ${contentHash} already exists for this user. Skipping ingestion.`,
      );
      return [existingDoc.id];
    }

    const storedDocId = await storeDocument({ ...normalisedDoc, contentHash });
    const chunks =
      sourceType === "github"
        ? await markdownChunk(normalisedDoc)
        : await recursiveChunk(normalisedDoc);

    const vectors = await embedTexts(
      chunks?.map((chunk: Chunk) => chunk.content) || [],
    );

    const sparseVectors = chunks?.map((chunk) =>
      computeSparseVector(chunk.content),
    );

    const savedChunks = await prisma.$transaction(async (tx) => {
      return await Promise.all(
        chunks?.map(async (chunk: Chunk, index: number) => {
          return await storeChunksInPostgres(tx, chunk, storedDocId);
        }),
      );
    });

    try {
      await Promise.all(
        chunks?.map(async (chunk, index) => {
          return await upsertChunksInQdrant(
            chunk,
            savedChunks[index].id,
            storedDocId,
            sparseVectors[index],
            vectors[index],
            doc.userId,
          );
        }),
      );

      const savedIdsArr = savedChunks?.map((chunk: any) => chunk.id);
      await markChunksVectorized(savedIdsArr);
    } catch (error) {
      await prisma.chunk.deleteMany({
        where: {
          id: {
            in: savedChunks?.map((chunk: any) => chunk.id),
          },
        },
      });

      throw error;
    }

    return [storedDocId];
  } catch (error) {
    console.error("Error processing document:", error);
    throw new Error("Failed to process document");
  }
}

export async function ingestDocument(
  sourceType: "pdf" | "website" | "github",
  source: string,
  userId: string,
  branch?: string,
): Promise<string[]> {
  try {
    await ensureCollections();

    if (sourceType === "pdf") {
      const doc = await loadPDF(source);
      return await processSingleDocument({ ...doc, userId }, sourceType);
    } else if (sourceType === "website") {
      const doc = await loadWebsite(source);
      return await processSingleDocument({ ...doc, userId }, sourceType);
    } else if (sourceType === "github") {
      const docs = await githubLoader(source, branch);
      const storedDocIds = [];
      for (const doc of docs) {
        const storedDocId = await processSingleDocument(
          { ...doc, userId },
          sourceType,
        );
        storedDocIds.push(...storedDocId);
      }
      return [...storedDocIds];
    } else {
      throw new Error(`Unsupported source type: ${sourceType}`);
    }
  } catch (error) {
    console.error("Error ingesting document:", error);
    throw new Error("Failed to ingest document");
  }
}
