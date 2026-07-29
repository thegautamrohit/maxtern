import { GraphStateType } from "./state";

// CRAG routing — runs after the evaluator node.
// If the retrieved chunks are not relevant, discard them and fall back to web search.
// If relevant, proceed directly to generation with the vector-retrieved chunks.

export const routeAfterEval = (state: GraphStateType) => {
  const { retrievalQuality } = state;
  if (retrievalQuality === "correct") return "generate";
  return "web_search"; // both incorrect and ambiguous go here, node decides combine vs replace
};

// Routing after query analysis — determines whether retrieval is needed at all.
// If no documentIds are provided (user skipped source selection or asked a general question),
// skip retrieval entirely and go straight to the generator (direct LLM answer, no RAG).
// If documentIds exist, retrieval is scoped to those documents.
export const routeAfterAnalyzer = (state: GraphStateType) => {
  const { documentIds } = state;
  if (documentIds && documentIds.length > 0) {
    return "retrieve";
  }
  return "generate";
};
