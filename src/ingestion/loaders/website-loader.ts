import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { Document } from "../../core/types";

export async function loadWebsite(url: string): Promise<Document> {
  const loader = new CheerioWebBaseLoader(url);
  const docs = await loader.load();
  if (!docs || docs.length === 0) {
    throw new Error(`Failed to load content from URL: ${url}`);
  }
  const docContent = docs.map((doc) => doc.pageContent).join("\n");
  const docTitle = docs[0]?.metadata?.title || "Untitled Website";
  const sourceType = "website";
  return {
    title: docTitle,
    content: docContent,
    sourceType,
    metadata: { ...docs[0].metadata },
  };
}

// loadWebsite(
//   "https://developer.nvidia.com/blog/nvidia-nemotron-3-ultra-powers-faster-more-efficient-reasoning-for-long-running-agents/",
// )
//   .then((doc) => {
//     console.log(doc);
//   })
//   .catch((err) => {
//     console.error("Error loading website:", err);
//   });
