import { MarkdownTextSplitter } from "@langchain/textsplitters";
import { Chunk, Document } from "@/core/types";

export async function markdownChunk(doc: Document): Promise<Chunk[]> {
  const markdownSplitter = new MarkdownTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  const chunks = await markdownSplitter.createDocuments([doc.content]);
  const chunkedDocs = chunks?.map((chunk, index) => {
    return {
      content: chunk.pageContent,
      metadata: {
        ...doc.metadata,
        title: doc.title,
        sourceType: doc.sourceType,
      },
      chunkIndex: index,
    };
  });
  return chunkedDocs || [];
}
