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

// CRAG evaluator — asks the LLM whether the retrieved chunks actually answer the query.
// Uses structured output (Zod schema) so the LLM returns { relevant: boolean }, not free text.
// Temperature 0 for deterministic judgment — no creativity needed for a binary classification.
// All chunks are sent in one call because the generator also sees all chunks together —
// the evaluator asks the same question the generator will face.
export const evaluatorNode = async (state: GraphStateType) => {
  const { query, chunks } = state;

  const LLM = new ChatOllama({
    model: "qwen3:4b",
    temperature: 0,
  });

  const chunksContext = chunks?.map((chunk) => chunk.content).join("\n\n");

  const schema = z.object({
    relevant: z
      .boolean()
      .describe("Whether the retrieved chunks are relevant to the query"),
  });

  const chain = evaluationPrompt.pipe(LLM.withStructuredOutput(schema));

  const result = await chain.invoke({
    query,
    chunksContext,
  });

  return { relevant: result.relevant };
};

// Generates the final answer using the LLM.
// Receives either vector-retrieved chunks (relevant path) or web search chunks (fallback path).
// The generator doesn't know or care which source the chunks came from — same call either way.
export const generatorNode = async (state: GraphStateType) => {
  const { query, chunks, history } = state;

  const answer = await generateAnswer(query, chunks, history);

  return { answer };
};

// CRAG fallback — triggered when the evaluator marks retrieved chunks as not relevant.
// Calls the Serper web search tool, parses the JSON string result, and maps each result
// to a RetrievedChunk shape so the generator can consume it identically to vector chunks.
// chunkId and documentId are set to the URL — no PostgreSQL entry exists for web results.
// score is hardcoded to 1 as a sentinel — web results have no vector similarity score.
export const webSearchNode = async (state: GraphStateType) => {
  const { query } = state;

  const webChunks = await webSearchTool.invoke({ query });

  const parsedChunks = JSON.parse(webChunks)?.map(
    (chunk: { title: string; url: string; content: string }) => {
      const { title, url, content } = chunk;
      return {
        chunkId: url,
        documentId: url,
        content,
        chunkIndex: 0,
        score: 1,
        sourceType: "web" as const,
      };
    },
  );

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
