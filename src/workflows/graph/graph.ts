import { StateGraph, START, END } from "@langchain/langgraph";
import { GraphState } from "./state";
import {
  analyzerNode,
  retrieverNode,
  evaluatorNode,
  generatorNode,
  webSearchNode,
  rerankerNode,
} from "./nodes";
import { routeAfterEval, routeAfterAnalyzer } from "./edges";

// LangGraph pipeline — compiled once at module load, reused across all requests.
// Method chaining is required for TypeScript to correctly track node names.
// Each .addNode() call registers an async function that reads from and writes to shared state.
//
// Full flow:
//   START → analyzer → (retrieve | generate) via routeAfterAnalyzer
//   retrieve → retriever → reranker → evaluator → (web_search | generate) via routeAfterEval
//     correct   → generator → END                     (vector chunks only)
//     incorrect → webSearch → generator → END         (web chunks replace vector chunks)
//     ambiguous → webSearch → generator → END         (web chunks combined with vector chunks)
//   generate (direct, no documentIds) → generator → END
export const compiledGraph = new StateGraph(GraphState)
  .addNode("analyzer", analyzerNode)
  .addNode("retriever", retrieverNode)
  .addNode("evaluator", evaluatorNode)
  .addNode("generator", generatorNode)
  .addNode("webSearch", webSearchNode)
  .addNode("reranker", rerankerNode)

  // Fixed edges — always run in this order when reached
  .addEdge(START, "analyzer")
  .addEdge("retriever", "reranker")     // reranker always follows retrieval
  .addEdge("reranker", "evaluator")     // evaluator always follows reranking
  .addEdge("webSearch", "generator")    // web search results always go to generator
  .addEdge("generator", END)

  // Conditional edges — routing decisions made at runtime based on state
  .addConditionalEdges("analyzer", routeAfterAnalyzer, {
    retrieve: "retriever",    // documentIds present → run retrieval
    generate: "generator",    // no documentIds → skip retrieval, direct LLM answer
  })
  .addConditionalEdges("evaluator", routeAfterEval, {
    web_search: "webSearch",  // chunks not relevant → CRAG fallback to web search
    generate: "generator",    // chunks relevant → generate answer from retrieved context
  })
  .compile();
