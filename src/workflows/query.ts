import { DebugInfo } from "@/core/types";
import { BaseMessage } from "@langchain/core/messages";
import prisma from "@/db/client";
import { compiledGraph } from "./graph/graph";

export async function handleQuery(
  userQuery: string,
  userId: string,
  documentIds?: string[],
  transformedHistory?: BaseMessage[],
): Promise<{ answer: string; debugInfo: DebugInfo }> {
  try {
    const initTime = Date.now();

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

    const isRagUsed = !!(retrievedChunks && retrievedChunks.length > 0);

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
        retrievalReason: [queryReasoning],
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
