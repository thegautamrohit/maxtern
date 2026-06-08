import { OllamaEmbeddings } from "@langchain/ollama";

const embeddings = new OllamaEmbeddings({ model: "nomic-embed-text" });

export async function embedText(text: string): Promise<number[]> {
  const vector = await embeddings.embedQuery(text);
  return vector;
}

export async function embedTexts(text: string[]): Promise<number[][]> {
  const vectors = await embeddings.embedDocuments(text);
  return vectors;
}
