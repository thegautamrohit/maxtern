import { NextRequest, NextResponse } from "next/server";
import denseRetrieval from "@/retrieval/retrievers/dense-retriever";
import semanticRetrieval from "@/retrieval/retrievers/semantic-retriever";
import { generateAnswer } from "@/llm/llm";

//  this route is made just for comparison of dense and hybrid retrieval methods, it is not used in the main application flow
export async function POST(request: NextRequest) {
  try {
    const { query, documentIds } = await request.json();

    if (!query) {
      return NextResponse.json({ error: "No query provided" }, { status: 400 });
    }

    const [denseChunks, hybridChunks] = await Promise.all([
      denseRetrieval(query, documentIds),
      semanticRetrieval(query, documentIds),
    ]);

    const [denseAnswer, hybridAnswer] = await Promise.all([
      generateAnswer(query, denseChunks),
      generateAnswer(query, hybridChunks),
    ]);

    return NextResponse.json({
      query,
      dense: {
        answer: denseAnswer,
        chunksUsed: denseChunks.length,
        chunkIds: denseChunks.map((c) => c.chunkIndex),
      },
      hybrid: {
        answer: hybridAnswer,
        chunksUsed: hybridChunks.length,
        chunkIds: hybridChunks.map((c) => c.chunkIndex),
      },
    });
  } catch (error) {
    console.error("Compare error:", error);
    return NextResponse.json({ error: "Comparison failed" }, { status: 500 });
  }
}
