import {
  AutoTokenizer,
  AutoModelForSequenceClassification,
} from "@xenova/transformers";
import { RetrievedChunk } from "@/core/types";

let tokenizer: any = null;
let model: any = null;

async function getReranker() {
  if (!tokenizer || !model) {
    tokenizer = await AutoTokenizer.from_pretrained(
      "Xenova/ms-marco-MiniLM-L-6-v2",
    );
    model = await AutoModelForSequenceClassification.from_pretrained(
      "Xenova/ms-marco-MiniLM-L-6-v2",
    );
  }
  return { tokenizer, model };
}

export const getRerankChunks = async (
  query: string,
  chunks: RetrievedChunk[],
): Promise<RetrievedChunk[]> => {
  const { tokenizer, model } = await getReranker();

  const scores = await Promise.all(
    chunks.map(async (chunk) => {
      const input = tokenizer(query, {
        text_pair: chunk.content,
        truncation: true,
        max_length: 512,
        return_tensors: "pt",
      });
      const output = await model(input);
      return output.logits.data[0];
    }),
  );

  const scoredChunks = chunks.map((chunk, i) => ({
    ...chunk,
    score: scores[i],
  }));

  const sorted = scoredChunks.sort((a, b) => b.score - a.score);
  const filtered = sorted.filter((chunk) => chunk.score > 0);

  return filtered.length > 0 ? filtered : sorted.slice(0, 3);
};
