import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const ratelimitQuery = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "60 s"),
  prefix: "ratelimit:query",
});

const rateLimitIngest = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "300 s"),
  prefix: "ratelimit:ingest",
});

export async function checkRateLimit(
  userId: string,
  endpoint: "query" | "ingest",
) {
  const result =
    endpoint === "query"
      ? await ratelimitQuery.limit(userId)
      : await rateLimitIngest.limit(userId);

  return {
    success: result.success,
    remaining: result.remaining,
    reset: result.reset,
    limit: result.limit,
  };
}
