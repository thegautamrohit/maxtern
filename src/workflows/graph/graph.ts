import { StateGraph, START, END } from "@langchain/langgraph";
import { GraphState } from "./state";
import {
  analyzerNode,
  retrieverNode,
  evaluatorNode,
  generatorNode,
} from "./nodes";
import { routeAfterEval, routeAfterAnalyzer } from "./edges";

export const compiledGraph = new StateGraph(GraphState)
  // add nodes
  .addNode("analyzer", analyzerNode)
  .addNode("retriever", retrieverNode)
  .addNode("evaluator", evaluatorNode)
  .addNode("generator", generatorNode)
  // add edges
  .addEdge(START, "analyzer")
  .addEdge("retriever", "evaluator")
  .addEdge("generator", END)
  // conditional edges
  .addConditionalEdges("evaluator", routeAfterEval, {
    retry: "retriever",
    generate: "generator",
  })
  .addConditionalEdges("analyzer", routeAfterAnalyzer, {
    retrieve: "retriever",
    generate: "generator",
  })
  .compile(); // compile the graph
