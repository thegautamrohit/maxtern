import { Document } from "@/core/types";
import he from "he";

export const normalizeContent = (content: string) => {
  return he
    .decode(content)
    .replace(/\n{3,}/g, "\n\n") // 3+ newlines → 2 newlines
    .replace(/[ \t]+/g, " ") // multiple spaces/tabs → single space
    .trim();
};

export const normalizeDocument = (doc: Document) => {
  const { title, content } = doc;
  const normalizedTitle = normalizeContent(title.trim());
  const normalizedContent = normalizeContent(content.trim());
  return {
    ...doc,
    title: normalizedTitle,
    content: normalizedContent,
  };
};

export const normalizeDocuments = (docs: Document[]) => {
  return docs.map(normalizeDocument);
};
