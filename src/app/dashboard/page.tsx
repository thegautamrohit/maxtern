import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import {
  getQueryVolume,
  getStrategyDistribution,
  getRetrievalStats,
  getCragFallbackRate,
  getRecentLogs,
  getTokenUsageStats,
} from "@/observability/analytics";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // All six analytics queries fire in parallel — none depends on another.
  // Promise.allSettled never rejects — each result is { status: "fulfilled", value }
  // or { status: "rejected", reason }. Failed sections show "Failed to load" independently
  // instead of crashing the entire page.
  const results = await Promise.allSettled([
    getQueryVolume(),
    getStrategyDistribution(),
    getRetrievalStats(),
    getCragFallbackRate(),
    getRecentLogs(),
    getTokenUsageStats(),
  ]);

  const [volume, strategy, retrieval, crag, recentLogs, tokens] = results.map(
    (r) => (r.status === "fulfilled" ? r.value : null),
  );

  // Derived values for stat cards — null-safe, falls back to "—" if that query failed
  const totalQueries = retrieval?._count?.id ?? "—";
  const avgScore = retrieval?._avg?.avgScore?.toFixed(3) ?? "—";
  const avgLatency = retrieval?._avg?.executionTimeMs
    ? Math.round(retrieval._avg.executionTimeMs) + "ms"
    : "—";
  const fallbackRate = crag
    ? (crag.fallbackRate * 100).toFixed(1) + "%"
    : "—";

  // Bar chart scale — at least 1 to avoid division by zero when no data
  const maxVolume = Math.max(...Object.values(volume ?? {}), 1);

  // Strategy bar chart — compute total once, not inside map
  const strategyTotal = (strategy ?? []).reduce((acc, s) => acc + s._count.id, 0);

  return (
    <div className="min-h-screen bg-background p-8 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Observability Dashboard</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Real-time query analytics from the QueryLog table.
      </p>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Queries" value={String(totalQueries)} />
        <StatCard label="Avg Retrieval Score" value={avgScore} />
        <StatCard label="CRAG Fallback Rate" value={fallbackRate} />
        <StatCard label="Avg Latency" value={avgLatency} />
      </div>

      {/* ── Charts Row ── */}
      <div className="grid grid-cols-2 gap-6 mb-8">

        {/* Query Volume */}
        <div className="border rounded-lg p-6">
          <h2 className="text-base font-semibold mb-4">Queries per Day (last 7 days)</h2>
          <div className="space-y-3">
            {!volume ? (
              <p className="text-sm text-red-500">Failed to load.</p>
            ) : Object.keys(volume).length === 0 ? (
              <p className="text-sm text-muted-foreground">No data yet.</p>
            ) : (
              Object.entries(volume).map(([day, count]) => (
                <div key={day} className="flex items-center gap-3">
                  <span className="w-14 text-xs text-muted-foreground">
                    {day.slice(5)} {/* MM-DD */}
                  </span>
                  <div className="flex-1 bg-muted rounded h-5 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded transition-all"
                      style={{ width: `${(count / maxVolume) * 100}%` }}
                    />
                  </div>
                  <span className="w-5 text-xs text-right">{count}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Strategy Distribution + Token Usage */}
        <div className="border rounded-lg p-6 flex flex-col gap-6">

          <div>
            <h2 className="text-base font-semibold mb-4">Strategy Distribution</h2>
            <div className="space-y-3">
              {!strategy ? (
                <p className="text-sm text-red-500">Failed to load.</p>
              ) : strategy.length === 0 ? (
                <p className="text-sm text-muted-foreground">No data yet.</p>
              ) : (
                strategy.map((s) => {
                  const pct =
                    strategyTotal > 0
                      ? (s._count.id / strategyTotal) * 100
                      : 0;
                  return (
                    <div key={s.strategy} className="flex items-center gap-3">
                      <span className="w-20 text-xs text-muted-foreground capitalize">
                        {s.strategy}
                      </span>
                      <div className="flex-1 bg-muted rounded h-5 overflow-hidden">
                        <div
                          className="h-full bg-violet-500 rounded transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-5 text-xs text-right">{s._count.id}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div>
            <h2 className="text-base font-semibold mb-3">Token Usage</h2>
            {!tokens ? (
            <p className="text-sm text-red-500">Failed to load.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Total Prompt</p>
                <p className="font-medium">
                  {tokens._sum.promptTokens?.toLocaleString() ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Completion</p>
                <p className="font-medium">
                  {tokens._sum.completionTokens?.toLocaleString() ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg Prompt / Query</p>
                <p className="font-medium">
                  {tokens._avg.promptTokens?.toFixed(0) ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg Completion / Query</p>
                <p className="font-medium">
                  {tokens._avg.completionTokens?.toFixed(0) ?? "—"}
                </p>
              </div>
            </div>
          )}
          </div>

        </div>
      </div>

      {/* ── Recent Queries Table ── */}
      <div className="border rounded-lg p-6">
        <h2 className="text-base font-semibold mb-4">Recent Queries</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-3 pr-4 font-medium">Query</th>
                <th className="pb-3 pr-4 font-medium">Strategy</th>
                <th className="pb-3 pr-4 font-medium">Avg Score</th>
                <th className="pb-3 pr-4 font-medium">Latency</th>
                <th className="pb-3 pr-4 font-medium">RAG</th>
                <th className="pb-3 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {!recentLogs ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-red-500 text-sm">
                    Failed to load.
                  </td>
                </tr>
              ) : recentLogs.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground text-sm"
                  >
                    No queries logged yet.
                  </td>
                </tr>
              ) : (
                recentLogs.map((log) => (
                  <tr key={log.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="py-3 pr-4 max-w-xs">
                      <span className="block truncate" title={log.rewrittenQuery ?? log.query}>
                        {log.rewrittenQuery ?? log.query}
                      </span>
                    </td>
                    <td className="py-3 pr-4 capitalize">{log.strategy}</td>
                    <td className="py-3 pr-4">{log.avgScore.toFixed(3)}</td>
                    <td className="py-3 pr-4">{log.executionTimeMs}ms</td>
                    <td className="py-3 pr-4">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          log.ragUsed
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        }`}
                      >
                        {log.ragUsed ? "yes" : "no"}
                      </span>
                    </td>
                    <td className="py-3 text-muted-foreground text-xs">
                      {log.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-lg p-5">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}
