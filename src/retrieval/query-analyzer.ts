import { RetrievalStrategy } from "@/core/types";

export function queryAnalyzer(query: string): RetrievalStrategy {
  const summaryKeywords = ["summary", "summarise", "overview"];
  const normalizedQuery = query.toLowerCase();

  return summaryKeywords.some((keyword) => normalizedQuery.includes(keyword))
    ? "summary"
    : "semantic";
}
