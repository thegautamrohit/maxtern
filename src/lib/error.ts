export class LLMRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMRateLimitError";
  }
}
export class LLMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMError";
  }
}
export class QdrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QdrantError";
  }
}
