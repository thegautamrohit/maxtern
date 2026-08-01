import {
  LLMError,
  LLMRateLimitError,
  QdrantError,
} from "./error";

const BASE_DELAY = 500;

function isRetryable(error: unknown): boolean {
  return (
    error instanceof LLMError ||
    error instanceof LLMRateLimitError ||
    error instanceof QdrantError
  );
}

const jitteredDelay = (attempt: number): number => {
  const max = BASE_DELAY * Math.pow(2, attempt);
  return Math.random() * max;
};

export async function withBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryable(error)) throw error;

      lastError = error;

      if (attempt < maxRetries) {
        const delay = jitteredDelay(attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
