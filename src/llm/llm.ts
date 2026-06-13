import { ChatOllama } from "@langchain/ollama";
import { RetrievedChunk } from "@/core/types";
import qaPrompt from "@/prompts/prompt";
import { StringOutputParser } from "@langchain/core/output_parsers";

export async function generateAnswer(
  query: string,
  chunks: RetrievedChunk[],
): Promise<string> {
  const LLM = new ChatOllama({
    model: "llama3",
  });

  const parser = new StringOutputParser();

  const responseChain = qaPrompt.pipe(LLM).pipe(parser);

  const response = await responseChain.invoke({
    userQuery: query,
    context: chunks.map((chunk) => chunk.content).join("\n"),
  });

  return response;
}
