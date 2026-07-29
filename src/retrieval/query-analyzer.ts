import { ChatOllama } from "@langchain/ollama";
import { queryIntentPrompt } from "@/prompts/prompt";
import { z } from "zod";
import { QueryIntent } from "@/core/types";
import { BaseMessage } from "@langchain/core/messages";

// Temperature 0 — classification is a deterministic judgment, not a creative task.
// The same query should always produce the same strategy.
const LLM = new ChatOllama({
  model: "qwen3:4b",
  temperature: 0,
});

// Zod schema is required (not a TypeScript type) because withStructuredOutput runs at runtime —
// TypeScript types are erased at compile time and don't exist when the LLM response arrives.
// z.enum enforces the allowed values at runtime — the LLM cannot return an unexpected string.
const schema = z.object({
  strategy: z
    .enum(["semantic", "summary"])
    .describe("The intent of the query, either 'summary' or 'semantic'"),
  confidence: z
    .number()
    .describe("Confidence level of the classification, between 0 and 1"),
  reasoning: z
    .string()
    .describe("The reasoning behind the classification in one short sentence"),
  rewrittenQuery: z.string().describe("Standalone version of the query"),
});

export async function queryAnalyzer(
  query: string,
  history: BaseMessage[],
): Promise<QueryIntent> {
  const normalizedQuery = query.toLowerCase();

  // withStructuredOutput pipes the LLM output through the Zod schema —
  // LangChain validates and coerces the JSON response before returning it.
  const chain = queryIntentPrompt.pipe(LLM.withStructuredOutput(schema));

  const result = await chain.invoke({ query: normalizedQuery, history });

  return result;
}
