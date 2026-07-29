import { DebugInfo } from "@/core/types";
import { BaseMessage } from "@langchain/core/messages";
import prisma from "@/db/client";
import { compiledGraph } from "./graph/graph";
import { logQuery } from "@/lib/query-logger";

export async function handleQuery(
  userQuery: string,
  userId: string,
  documentIds?: string[],
  transformedHistory?: BaseMessage[],
): Promise<{ answer: string; debugInfo: DebugInfo }> {
  try {
    const initTime = Date.now();

    // Run the full LangGraph pipeline — analyzer → retriever → reranker → evaluator → generator/webSearch.
    // Returns the final answer, retrieved chunks, selected strategy, and LLM reasoning for the strategy choice.
    const {
      answer,
      chunks: retrievedChunks,
      strategy: retrievalType,
      queryReasoning,
    } = await compiledGraph.invoke({
      query: userQuery,
      history: transformedHistory,
      userId,
      documentIds,
    });

    // RAG is considered used only if the graph actually retrieved and returned chunks.
    // If the query was answered directly by the LLM (no documentIds, or evaluator fell through),
    // retrievedChunks will be empty and ragUsed will be false.
    const isRagUsed = !!(retrievedChunks && retrievedChunks.length > 0);

    // Fetch document titles for all chunks in a single query — avoids N+1.
    // Build a Map for O(1) lookup per chunk instead of filtering inside .map().
    const retrievedDocIds = retrievedChunks.map((chunk) => chunk.documentId);
    const docTitles = await prisma.document.findMany({
      where: {
        id: { in: retrievedDocIds },
      },
      select: {
        title: true,
        id: true,
      },
    });

    const docIdMap = new Map(docTitles?.map((doc) => [doc.id, doc.title]));

    const executionTime = Date.now() - initTime;

    // Build log payload. topScore and avgScore are guarded against empty arrays —
    // when ragUsed is false, chunks is empty and score computations would crash or return NaN.
    const logData = {
      userId,
      query: userQuery,
      strategy: retrievalType,
      retrievedChunks: retrievedChunks.length,
      topScore: isRagUsed
        ? retrievedChunks.sort((a, b) => b.score - a.score)[0].score
        : 0,
      avgScore: isRagUsed
        ? retrievedChunks.reduce((acc, curr) => {
            return acc + curr.score;
          }, 0) / retrievedChunks.length
        : 0,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCost: "0",
      executionTimeMs: executionTime,
      ragUsed: isRagUsed,
    };

    // Fire-and-forget — logQuery never throws. A logging failure must not affect the query response.
    await logQuery(logData);

    return {
      answer,
      debugInfo: {
        retrievalReason: [queryReasoning],
        retrievedChunks: retrievedChunks.length,
        executionTime: executionTime,
        selectedRetriever: retrievalType,
        // Attach sourceTitle and a short content preview to each chunk for the debug panel.
        chunks: retrievedChunks.map((chunk) => ({
          ...chunk,
          sourceTitle: docIdMap.get(chunk.documentId) ?? "Unknown",
          contentPreview: chunk.content.substring(0, 150),
        })),
        tokens: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimatedCost: "$0",
          ragUsed: isRagUsed,
        },
      },
    };
  } catch (error: any) {
    console.error("Error handling query:", error);
    throw new Error(`Failed to handle query : ${error.message}`);
  }
}

export default handleQuery;
