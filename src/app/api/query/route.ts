import { NextRequest, NextResponse } from "next/server";
import { handleQuery } from "@/workflows/query";

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();
    if (!query) {
      return NextResponse.json({ error: "No query provided" }, { status: 400 });
    }

    const response = await handleQuery(query);

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
