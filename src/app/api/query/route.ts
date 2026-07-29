import { NextRequest, NextResponse } from "next/server";
import { handleQuery } from "@/workflows/query";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { Message } from "@/types/chat";
import { auth } from "@clerk/nextjs/server";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { success, reset } = await checkRateLimit(userId, "query");

    if (!success) {
      const retryAfter = Math.ceil((reset - Date.now()) / 1000);
      return NextResponse.json(
        { error: `Too many requests. Retry after ${retryAfter} seconds` },
        { status: 429 },
      );
    }

    const { query, documentIds, history } = await request.json();
    if (!query) {
      return NextResponse.json({ error: "No query provided" }, { status: 400 });
    }

    const transformedHistory = history.map((message: Message) => {
      if (message.role === "user") {
        return new HumanMessage(message.content);
      } else {
        return new AIMessage(message.content);
      }
    });

    const response = await handleQuery(
      query,
      userId,
      documentIds,
      transformedHistory,
    );

    return NextResponse.json(
      {
        answer: response.answer,
        debugInfo: response.debugInfo,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
