import { NextRequest, NextResponse } from "next/server";
import { handleQuery } from "@/workflows/query";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { Message } from "@/types/chat";

export async function POST(request: NextRequest) {
  try {
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

    const response = await handleQuery(query, documentIds, transformedHistory);

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
