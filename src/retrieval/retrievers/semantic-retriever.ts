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
  // Generate both vector types for the query.
  // Dense = semantic meaning (768-dim float array via Ollama).
  // Sparse = keyword signal (BM25 TF-IDF via computeSparseVector — no network call).
  const queryDenseVector = await embedText(query);
  const querySparseVector = computeSparseVector(query);

  // Filter is applied inside Qdrant before scoring — not after.
  // Filtering after retrieval would discard high-ranking chunks that don't belong to this user/session
  // and keep low-ranking chunks that do. Pre-filter ensures Qdrant only scores relevant chunks.
  // userId is always required. documentIds are optional — omitting them searches all user docs.
  const filter = {
    must: [
      { key: "userId", match: { value: userId } },
      ...(documentIds && documentIds.length > 0
        ? [{ key: "documentId", match: { any: documentIds } }]
        : []),
    ],
  };

  // Two separate Qdrant searches — one per named vector.
  // Qdrant does not merge or RRF automatically when using the JS client's search() method.
  // limit: 20 for recall — we want the right chunk somewhere in the top-20, reranker handles precision.
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

  // RRF (Reciprocal Rank Fusion) — merges dense and sparse ranked lists.
  // Formula: score += 1 / (K + rank). K=60 is a smoothing constant that prevents
  // a single top-ranked result from dominating (compresses rank differences).
  // Chunks appearing in both lists accumulate two contributions — they float to the top.
  // Raw Qdrant scores (cosine / BM25) are discarded — RRF only uses rank position,
  // which makes the merge scale-invariant (cosine and BM25 are not on the same scale).
  const K = 60;
  const rrfScores = new Map<string, number>();

  denseResults.forEach((item, index) => {
    const id = item.payload?.chunkId as string;
    rrfScores.set(id, (rrfScores.get(id) ?? 0) + 1 / (K + index + 1));
  });

  sparseResults.forEach((item, index) => {
    const id = item?.payload?.chunkId as string;
    rrfScores.set(id, (rrfScores?.get(id) ?? 0) + 1 / (K + index + 1));
  });

  // Take top-5 chunk IDs by RRF score, then fetch their content from PostgreSQL.
  // Qdrant stores only reference IDs in payload — content lives exclusively in PostgreSQL.
  const topChunks = [...rrfScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  const retrievedChunks = await prisma.chunk.findMany({
    where: {
      id: { in: topChunks },
    },
  });

  // Build sourceType map from BOTH dense and sparse results.
  // Some chunk IDs may appear only in sparse results (not in dense) — if we only used
  // denseResults here, those sparse-only chunks would have no sourceType and get filtered out.
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

  // Combine PostgreSQL content with Qdrant metadata (sourceType, RRF score).
  // Filter out any chunks missing sourceType or score — defensive guard for payload inconsistencies.
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
