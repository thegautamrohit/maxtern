export class CircuitBreaker {
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private failureCount: number = 0;
  private openedAt: number | null = null;

  failureThreshold: number = 0;
  cooldownMs: number = 0;
  execute: <T>(fn: () => Promise<T>) => Promise<T>;

  constructor({
    failureThreshold,
    cooldownMs,
  }: {
    failureThreshold: number;
    cooldownMs: number;
  }) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;

    this.execute = async (fn) => {
      if (this.state === "OPEN") {
        let isExpired = Date.now() - this.openedAt! > cooldownMs;

        if (isExpired) {
          this.state = "HALF_OPEN";
        } else {
          throw Error("Circuit breaker is open");
        }
      }
      try {
        let result = await fn();
        this.failureCount = 0;
        this.state = "CLOSED";
        this.openedAt = null;
        return result;
      } catch (error) {
        this.failureCount++;

        if (
          this.state === "HALF_OPEN" ||
          this.failureCount >= failureThreshold
        ) {
          this.state = "OPEN";
          this.openedAt = Date.now();
        }
        throw error;
      }
    };
  }
}
