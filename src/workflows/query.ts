import { queryAnalyzer } from "@/retrieval/query-analyzer";
import { retrievalRouter } from "@/retrieval/retrieval-router";
import { generateAnswer } from "@/llm/llm";
import { DebugInfo } from "@/core/types";
import prisma from "@/db/client";

export async function handleQuery(
  userQuery: string,
): Promise<{ answer: string; debugInfo: DebugInfo }> {
  const initTime = Date.now();
  const retrievalType = queryAnalyzer(userQuery);
  const retrievedChunks = await retrievalRouter(retrievalType, userQuery);
  const answer = await generateAnswer(userQuery, retrievedChunks);
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

  return {
    answer,
    debugInfo: {
      retrievalReason: [
        retrievalType === "summary"
          ? "Summary keywords detected in query"
          : "Precision request detected in query",
      ],
      retrievedChunks: retrievedChunks.length,
      executionTime: executionTime,
      selectedRetriever: retrievalType,
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
        ragUsed: true,
      },
    },
  };
}

export default handleQuery;
