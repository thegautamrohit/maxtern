import { GraphStateType } from "./state";
import { queryAnalyzer } from "@/retrieval/query-analyzer";
import { retrievalRouter } from "@/retrieval/retrieval-router";
import { generateAnswer } from "@/llm/llm";

export const analyzerNode = async (state: GraphStateType) => {
  const { query } = state;

  return { strategy: queryAnalyzer(query) };
};

export const retrieverNode = async (state: GraphStateType) => {
  const { query, strategy, attempts, documentIds } = state;

  const retrievedChunks = await retrievalRouter(strategy, query, documentIds);

  return { chunks: retrievedChunks, attempts: attempts + 1 };
};

export const evaluatorNode = async (state: GraphStateType) => {
  const retrievedChunks = state.chunks;

  const scoresArr = retrievedChunks.map((chunk) => chunk.score);

  const scoreAvg =
    scoresArr.reduce((acc, curr) => {
      return acc + curr;
    }, 0) / retrievedChunks.length;

  return { score: scoreAvg };
};

export const generatorNode = async (state: GraphStateType) => {
  const { query, chunks, history } = state;

  const answer = await generateAnswer(query, chunks, history);

  return { answer };
};
