import prisma from "@/db/client";

export async function getQueryVolume(days: number = 7) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const logs = await prisma.queryLog.findMany({
    where: {
      createdAt: {
        gte: since,
      },
    },
    select: {
      createdAt: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const groupedLogs: Record<string, number> = {};
  for (const log of logs) {
    const day = log.createdAt.toISOString().slice(0, 10); // Get the date in YYYY-MM-DD format
    groupedLogs[day] = (groupedLogs[day] ?? 0) + 1;
  }

  return groupedLogs;
}

export async function getStrategyDistribution() {
  const logs = await prisma.queryLog.groupBy({
    by: ["strategy"],
    _count: { id: true },
  });

  return logs;
}
export async function getRetrievalStats() {
  const logs = await prisma.queryLog.aggregate({
    _avg: {
      avgScore: true,
      executionTimeMs: true,
    },
    _max: { topScore: true },
    _count: { id: true },
  });

  return logs;
}

export async function getCragFallbackRate() {
  const total = await prisma.queryLog.aggregate({ _count: { id: true } });
  const fallbacks = await prisma.queryLog.aggregate({
    _count: { id: true },
    where: {
      ragUsed: false,
    },
  });

  return {
    total: total._count.id,
    fallbacks: fallbacks._count.id,
    fallbackRate:
      total._count.id > 0 ? fallbacks._count.id / total._count.id : 0,
  };
}

export async function getRecentLogs() {
  const logs = await prisma.queryLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return logs;
}

export async function getTokenUsageStats() {
  const logs = await prisma.queryLog.aggregate({
    _sum: {
      promptTokens: true,
      completionTokens: true,
    },
    _avg: {
      promptTokens: true,
      completionTokens: true,
    },
  });

  return logs;
}
