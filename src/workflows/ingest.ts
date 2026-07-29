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
    // Step 1 — Normalize: decode HTML entities, collapse whitespace.
    // Normalization runs before hashing so that two documents with identical content
    // but different raw encodings (e.g. &amp; vs &) produce the same hash.
    const normalisedDoc = normalizeDocument(doc);

    // Step 2 — Deduplication: SHA-256 hash the normalized content.
    // Check if this (userId, contentHash) pair already exists in PostgreSQL.
    // The @@unique([userId, contentHash]) constraint means the same content can exist
    // once per user — two different users ingesting the same doc are independent.
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

    // Step 3 — Store document: write the Document row to PostgreSQL and get its ID.
    const storedDocId = await storeDocument({ ...normalisedDoc, contentHash });

    // Step 4 — Chunk: split the document into smaller pieces.
    // GitHub files are markdown — use MarkdownTextSplitter to preserve section structure.
    // PDF and Website use RecursiveCharacterTextSplitter (generic text splitting).
    const chunks =
      sourceType === "github"
        ? await markdownChunk(normalisedDoc)
        : await recursiveChunk(normalisedDoc);

    // Step 5 — Embed: generate dense and sparse vectors for all chunks in a single batch call.
    // embedTexts sends all chunk contents in one request — dramatically more efficient
    // than calling embedText per chunk (avoids N separate HTTP calls to Ollama).
    const vectors = await embedTexts(
      chunks?.map((chunk: Chunk) => chunk.content) || [],
    );

    // Sparse (BM25) vectors computed in-process — no network call needed.
    const sparseVectors = chunks?.map((chunk) =>
      computeSparseVector(chunk.content),
    );

    // Step 6 — Phase 1 (PostgreSQL transaction): write all chunks atomically with vectorized: false.
    // Using prisma.$transaction ensures all chunk rows commit together or none do.
    // vectorized: false marks chunks as "pending Qdrant upsert" — used for orphan detection.
    const savedChunks = await prisma.$transaction(async (tx) => {
      return await Promise.all(
        chunks?.map(async (chunk: Chunk, index: number) => {
          return await storeChunksInPostgres(tx, chunk, storedDocId);
        }),
      );
    });

    // Step 7 — Phase 2 (Qdrant upsert + compensating rollback):
    // Upsert all chunk vectors to Qdrant in parallel. On success, flip vectorized: true.
    // On failure, delete the PostgreSQL chunk rows (compensating rollback) and re-throw.
    // This is needed because Qdrant has no connection to PostgreSQL's transaction boundary —
    // a cross-system failure cannot be handled by prisma.$transaction alone.
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
      // Qdrant upsert failed — roll back the PostgreSQL chunk rows to avoid orphaned data
      // (content stored in PG with no corresponding vectors in Qdrant = unretrievable chunks).
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
    // Ensure the Qdrant "chunks" collection exists before any upsert.
    // ensureCollections() is idempotent — safe to call on every ingestion.
    // Guards against cold starts, Qdrant restarts, or wiped volumes.
    await ensureCollections();

    if (sourceType === "pdf") {
      const doc = await loadPDF(source);
      return await processSingleDocument({ ...doc, userId }, sourceType);
    } else if (sourceType === "website") {
      const doc = await loadWebsite(source);
      return await processSingleDocument({ ...doc, userId }, sourceType);
    } else if (sourceType === "github") {
      // GitHub loader returns Document[] — one document per file in the repo.
      // Process sequentially with for...of (not Promise.all) to avoid DB race conditions
      // at the document level — each document's full pipeline must complete before the next starts.
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
