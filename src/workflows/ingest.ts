import { loadPDF } from "../ingestion/loaders/pdf-loader";
import { loadWebsite } from "../ingestion/loaders/website-loader";
import { githubLoader } from "../ingestion/loaders/github-loader";
import { normalizeDocument } from "../ingestion/normalizers/document-normalizer";
import { storeChunk, storeDocument } from "../vector/store";
import { Chunk, Document, SourceType } from "../core/types";
import { markdownChunk } from "@/chunking/markdown-chunker";
import { recursiveChunk } from "@/chunking/recursive-chunker";
import { embedTexts } from "@/embeddings/embedder";
import { ensureCollections } from "@/vector/collection";
import { computeSparseVector } from "@/embeddings/sparse-embedder";

async function processSingleDocument(
  doc: Document,
  sourceType: SourceType,
): Promise<string[]> {
  try {
    const normalisedDoc = normalizeDocument(doc);
    const storedDocId = await storeDocument(normalisedDoc);
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

    await Promise.all(
      chunks?.map(async (chunk: Chunk, index: number) => {
        await storeChunk(
          chunk,
          vectors[index],
          storedDocId,
          sparseVectors[index],
          doc.userId
        );
      }),
    );

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
