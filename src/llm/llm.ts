import { ChatOllama } from "@langchain/ollama";
import { RetrievedChunk } from "@/core/types";
import { qaPrompt, generalPrompt } from "@/prompts/prompt";
import { StringOutputParser } from "@langchain/core/output_parsers";

export async function generateAnswer(
  query: string,
  chunks: RetrievedChunk[],
): Promise<string> {
  const LLM = new ChatOllama({
    model: "qwen3:4b",
    temperature: 0.6,
  });

  const parser = new StringOutputParser();

  if (chunks.length === 0) {
    const chain = generalPrompt.pipe(LLM).pipe(parser);
    return chain.invoke({ userQuery: query });
  }

  const chain = qaPrompt.pipe(LLM).pipe(parser);
  return chain.invoke({
    userQuery: query,
    context: chunks.map((chunk) => chunk.content).join("\n"),
  });
}
