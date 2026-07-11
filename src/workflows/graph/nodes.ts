import { GraphStateType } from "./state";
import { queryAnalyzer } from "@/retrieval/query-analyzer";
import { retrievalRouter } from "@/retrieval/retrieval-router";
import { generateAnswer } from "@/llm/llm";
import { z } from "zod";
import { ChatOllama } from "@langchain/ollama";
import { evaluationPrompt } from "@/prompts/prompt";
import { webSearchTool } from "@/tools/web-search";
import { getRerankChunks } from "@/retrieval/reranker";

export const analyzerNode = async (state: GraphStateType) => {
  const { query } = state;

  const { strategy, reasoning } = await queryAnalyzer(query);

  return { strategy, queryReasoning: reasoning };
};

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

export const generatorNode = async (state: GraphStateType) => {
  const { query, chunks, history } = state;

  const answer = await generateAnswer(query, chunks, history);

  return { answer };
};

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
        score: 1, // adding a fallback score of 1 for web search results
        sourceType: "web" as const,
      };
    },
  );

  return { chunks: parsedChunks };
};

export const rerankerNode = async (state: GraphStateType) => {
  const { query, chunks } = state;

  if (chunks.length === 0) return { chunks: [] };

  const rerankedChunks = await getRerankChunks(query, chunks);

  return { chunks: rerankedChunks };
};
