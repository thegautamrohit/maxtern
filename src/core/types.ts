type SourceType = "pdf" | "website" | "github" | "web";

interface Document {
  userId: string;
  title: string;
  content: string;
  sourceType: SourceType;
  metadata: any;
  contentHash?: string;
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
  sourceType: SourceType;
}

interface RetrievedChunkDebug {
  chunkId: string;
  documentId: string;
  sourceType: SourceType;
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

interface SparseVector {
  indices: number[];
  values: number[];
}

interface QueryIntent {
  strategy: RetrievalStrategy;
  confidence: number;
  reasoning: string;
  rewrittenQuery: string;
}

interface QueryLog {
  userId: string;
  query: string;
  rewrittenQuery?: string;
  strategy: string;
  retrievedChunks: number;
  topScore: number;
  avgScore: number;
  rerankerTopScore?: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCost: string;
  executionTimeMs: number;
  ragUsed: boolean;
}

export type {
  Document,
  Chunk,
  RetrievedChunk,
  RetrievalStrategy,
  DebugInfo,
  RetrievedChunkDebug,
  TokenUsage,
  SparseVector,
  SourceType,
  QueryIntent,
  QueryLog,
};
