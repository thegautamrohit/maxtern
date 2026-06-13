import { RetrievalStrategy, RetrievedChunk } from "@/core/types";
import semanticRetrieval from "./retrievers/semantic-retriever";
import summaryRetriever from "./retrievers/summary-retriever";

export function retrievalRouter(
  retrievalType: RetrievalStrategy,
  query: string,
): Promise<RetrievedChunk[]> {
  if (retrievalType === "semantic") {
    return semanticRetrieval(query);
  } else if (retrievalType === "summary") {
    return summaryRetriever(query);
  } else {
    throw new Error(`Unknown retrieval type: ${retrievalType}`);
  }
}
