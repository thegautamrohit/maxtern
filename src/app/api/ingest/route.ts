import { NextRequest, NextResponse } from "next/server";
import { ingestDocument } from "@/workflows/ingest";

export async function POST(request: NextRequest) {
  try {
    const { source, type, branch } = await request.json();

    if (!source || !type) {
      return NextResponse.json(
        { error: "No source or type provided" },
        { status: 400 },
      );
    }

    const documentIds = await ingestDocument(type, source, branch);

    return NextResponse.json(
      {
        documentIds,
        status: "completed",
      },
      {
        status: 200,
      },
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
