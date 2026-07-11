import { ChatOllama } from "@langchain/ollama";
import { queryIntentPrompt } from "@/prompts/prompt";
import { z } from "zod";
import { QueryIntent } from "@/core/types";

const LLM = new ChatOllama({
  model: "qwen3:4b",
  temperature: 0,
});

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
});

export async function queryAnalyzer(query: string): Promise<QueryIntent> {
  const normalizedQuery = query.toLowerCase();

  const chain = queryIntentPrompt.pipe(LLM.withStructuredOutput(schema));

  const result = await chain.invoke({ query: normalizedQuery });

  return result;
}
