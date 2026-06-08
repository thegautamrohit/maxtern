import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Chunk, Document } from "@/core/types";

export async function recursiveChunk(doc: Document): Promise<Chunk[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  const chunks = await splitter.createDocuments([doc.content]);
  const chunkedDocs: Chunk[] = chunks.map((chunk, index) => {
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

  return chunkedDocs;
}
