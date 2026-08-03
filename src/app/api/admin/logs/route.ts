import { NextResponse, NextRequest } from "next/server";
import { getAuth } from "@clerk/nextjs/server";
import {
  getQueryVolume,
  getStrategyDistribution,
  getRetrievalStats,
  getCragFallbackRate,
  getRecentLogs,
  getTokenUsageStats,
} from "@/observability/analytics";

export async function GET(request: NextRequest) {
  // auth check — only authenticated users
  const { userId } = getAuth(request);
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [volume, strategy, retrieval, crag, recentLogs, tokens] =
    await Promise.all([
      getQueryVolume(),
      getStrategyDistribution(),
      getRetrievalStats(),
      getCragFallbackRate(),
      getRecentLogs(),
      getTokenUsageStats(),
    ]);

  return NextResponse.json({
    volume,
    strategy,
    retrieval,
    crag,
    recentLogs,
    tokens,
  });
}
