import { ChatOllama } from "@langchain/ollama";
import { RetrievedChunk } from "@/core/types";
import { qaPrompt, generalPrompt } from "@/prompts/prompt";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { BaseMessage } from "@langchain/core/messages";
import { withBackoff } from "@/lib/backoff";
import { LLMError } from "@/lib/error";

export async function generateAnswer(
  query: string,
  chunks: RetrievedChunk[],
  transformedHistory?: BaseMessage[],
): Promise<string> {
  const LLM = new ChatOllama({
    model: "qwen3:4b",
    temperature: 0.6,
  });

  const parser = new StringOutputParser();

  const history = transformedHistory ?? [];

  if (chunks && chunks?.length === 0) {
    const chain = generalPrompt.pipe(LLM).pipe(parser);

    return withBackoff(async () => {
      try {
        return await chain.invoke({ userQuery: query, history });
      } catch (error) {
        throw new LLMError(
          error instanceof Error ? error.message : "LLM call failed",
        );
      }
    });
  }

  const chain = qaPrompt.pipe(LLM).pipe(parser);

  return withBackoff(async () => {
    try {
      return await chain.invoke({
        userQuery: query,
        context: chunks?.map((chunk) => chunk.content).join("\n"),
        history,
      });
    } catch (error) {
      throw new LLMError(
        error instanceof Error ? error.message : "LLM call failed",
      );
    }
  });
}
