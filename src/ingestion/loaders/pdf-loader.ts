import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { Document } from "../../core/types";

export async function loadPDF(filePath: string): Promise<Document> {
  const loader = new PDFLoader(filePath);
  const docs = await loader.load();
  const docContent = docs.map((doc) => doc.pageContent).join("\n");
  const docTitle = docs[0]?.metadata?.pdf?.info?.Title || "Untitled PDF";
  const totalPages = docs[0]?.metadata?.pdf?.totalPages || "Unknown";
  const sourceType = "pdf";
  return {
    title: docTitle,
    content: docContent,
    sourceType,
    metadata: {
      totalPages,
      filePath,
    },
  };
}

// loadPDF("./book.pdf").then((docs) => {
//   console.log(docs);
// });
