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

export type { Document, Chunk, RetrievedChunk };
