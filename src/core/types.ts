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

export type { Document, Chunk };
