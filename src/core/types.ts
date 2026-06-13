interface Document {
  title: string;
  content: string;
  sourceType: "pdf" | "website" | "github";
  metadata: any;
}

interface Chunk {
  content: string;
  chunkIndex: number;
  metadata: any;
}

interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  score: number;
  sourceType: "pdf" | "website" | "github";
}

interface RetrievedChunkDebug {
  chunkId: string;
  documentId: string;
  sourceType: "pdf" | "website" | "github";
  sourceTitle: string; // document title from PostgreSQL
  chunkIndex: number; // position within the document
  score: number; // Qdrant similarity score (0–1)
  contentPreview: string; // first ~150 chars of chunk content
}

interface TokenUsage {
  promptTokens: number; // tokens sent to LLM (context + query)
  completionTokens: number; // tokens in the LLM response
  totalTokens: number;
  estimatedCost: string; // e.g. "$0.0012"
  ragUsed: boolean; // false if no retrieval happened
}

type RetrievalStrategy = "semantic" | "summary";

interface DebugInfo {
  selectedRetriever: RetrievalStrategy;
  retrievalReason: string[]; // why this retriever was chosen
  retrievedChunks: number; // how many chunks were fetched
  executionTime: number; // total ms for the query pipeline
  chunks: RetrievedChunkDebug[]; // each chunk ranked by score
  tokens?: TokenUsage; // LLM token + cost breakdown
}

export type {
  Document,
  Chunk,
  RetrievedChunk,
  RetrievalStrategy,
  DebugInfo,
  RetrievedChunkDebug,
  TokenUsage,
};
