interface Document {
  title: string;
  content: string;
  sourceType: "pdf" | "website" | "github";
  metadata: any;
}

export type { Document };