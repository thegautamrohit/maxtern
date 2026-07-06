import { StateGraph, START, END } from "@langchain/langgraph";
import { GraphState } from "./state";
import {
  analyzerNode,
  retrieverNode,
  evaluatorNode,
  generatorNode,
  webSearchNode,
} from "./nodes";
import { routeAfterEval, routeAfterAnalyzer } from "./edges";

export const compiledGraph = new StateGraph(GraphState)
  // add nodes
  .addNode("analyzer", analyzerNode)
  .addNode("retriever", retrieverNode)
  .addNode("evaluator", evaluatorNode)
  .addNode("generator", generatorNode)
  .addNode("webSearch", webSearchNode)
  // add edges
  .addEdge(START, "analyzer")
  .addEdge("retriever", "evaluator")
  .addEdge("webSearch", "generator")
  .addEdge("generator", END)
  // conditional edges
  .addConditionalEdges("analyzer", routeAfterAnalyzer, {
    retrieve: "retriever",
    generate: "generator",
  })
  .addConditionalEdges("evaluator", routeAfterEval, {
    web_search: "webSearch",
    generate: "generator",
  })
  .compile(); // compile the graph
