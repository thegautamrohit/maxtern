import { GraphStateType } from "./state";
import { queryAnalyzer } from "@/retrieval/query-analyzer";
import { retrievalRouter } from "@/retrieval/retrieval-router";
import { generateAnswer } from "@/llm/llm";
import { z } from "zod";
import { ChatOllama } from "@langchain/ollama";
import { evaluationPrompt } from "@/prompts/prompt";
import { webSearchTool } from "@/tools/web-search";
import { getRerankChunks } from "@/retrieval/reranker";

// Analyzes the query intent using an LLM classifier.
// Returns a retrieval strategy ("semantic" or "summary") and the reasoning behind it.
// reasoning is renamed to queryReasoning to avoid naming collisions in shared graph state.
export const analyzerNode = async (state: GraphStateType) => {
  const { query } = state;

  const { strategy, reasoning } = await queryAnalyzer(query);

  return { strategy, queryReasoning: reasoning };
};

// Routes the query to the correct retriever based on the strategy set by analyzerNode.
// Passes userId so Qdrant filters to only this user's chunks (per-user isolation).
// documentIds scopes retrieval to the current session's ingested documents.
export const retrieverNode = async (state: GraphStateType) => {
  const { query, strategy, documentIds, userId } = state;

  const retrievedChunks = await retrievalRouter(
    strategy,
    query,
    userId,
    documentIds,
  );

  return { chunks: retrievedChunks };
};

// CRAG evaluator — classifies retrieval quality into three states: correct, incorrect, ambiguous.
// correct   → chunks directly answer the query → go to generator
// incorrect → chunks are off-topic or query is time-sensitive → discard, web search only
// ambiguous → chunks partially answer but are incomplete → combine with web search results
// Temperature 0 — deterministic judgment, no creativity needed.
// All chunks sent in one call — the evaluator asks the same question the generator will face.

export const evaluatorNode = async (state: GraphStateType) => {
  const { query, chunks } = state;

  const LLM = new ChatOllama({ model: "qwen3:4b", temperature: 0 });
  const chunksContext = chunks?.map((chunk) => chunk.content).join("\n\n");

  const schema = z.object({
    retrievalQuality: z.enum(["correct", "incorrect", "ambiguous"]),
    reason: z.string(),
  });

  const chain = evaluationPrompt.pipe(LLM.withStructuredOutput(schema));
  const result = await chain.invoke({ query, chunksContext });

  return {
    retrievalQuality: result.retrievalQuality,
    evalReason: result.reason,
  };
};

// Generates the final answer using the LLM.
// Receives chunks from one of three sources depending on the CRAG evaluation:
//   correct   → reranked vector chunks only
//   incorrect → web search chunks only
//   ambiguous → reranked vector chunks + web search chunks combined
// The generator doesn't know or care which source the chunks came from — same call either way.
export const generatorNode = async (state: GraphStateType) => {
  const { query, chunks, history } = state;

  const answer = await generateAnswer(query, chunks, history);

  return { answer };
};

// CRAG fallback — triggered for both "incorrect" and "ambiguous" evaluations.
// incorrect → replaces retrieved chunks entirely with web results
// ambiguous → combines existing reranked chunks with web results (best of both sources)
// Web results are mapped to RetrievedChunk shape so the generator handles them identically.
// chunkId and documentId are set to the URL — no PostgreSQL entry exists for web results.
// score is hardcoded to 1 as a sentinel — web results have no vector similarity score.

export const webSearchNode = async (state: GraphStateType) => {
  const { query, chunks, retrievalQuality } = state;

  const webChunks = await webSearchTool.invoke({ query });
  const parsedChunks = JSON.parse(webChunks)?.map(
    (chunk: { title: string; url: string; content: string }) => ({
      chunkId: chunk.url,
      documentId: chunk.url,
      content: chunk.content,
      chunkIndex: 0,
      score: 1,
      sourceType: "web" as const,
    }),
  );

  if (retrievalQuality === "ambiguous") {
    // keep existing retrieved+reranked chunks, add web results
    return { chunks: [...chunks, ...parsedChunks] };
  }

  // incorrect → discard retrieved chunks entirely, web-only
  return { chunks: parsedChunks };
};

// Re-scores the retrieved chunks using a cross-encoder model (ms-marco-MiniLM-L-6-v2).
// Cross-encoders attend to query AND chunk together — more accurate than cosine similarity.
// Runs after retrieverNode and before evaluatorNode so the evaluator sees the best-ranked chunks.
// Early return on empty chunks to avoid unnecessary model calls.
export const rerankerNode = async (state: GraphStateType) => {
  const { query, chunks } = state;

  if (chunks.length === 0) return { chunks: [] };

  const rerankedChunks = await getRerankChunks(query, chunks);

  return { chunks: rerankedChunks };
};
