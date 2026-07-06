import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";

export const qaPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are a helpful assistant. Answer the question using ONLY the context below.
    If the answer is not present in the context, say: "I don't have enough information in the provided document."
    Answer briefly and clearly.

Context:
{context}`,
  ],
  new MessagesPlaceholder("history"),
  ["human", "{userQuery}"],
]);

export const generalPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "You are a helpful, knowledgeable assistant.Answer the following question clearly and concisely. Do not mention documents or context — just answer directly",
  ],
  new MessagesPlaceholder("history"),
  ["human", "{userQuery}"],
]);

export const evaluationPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are a retrieval quality evaluator for a RAG system.

Your job is to decide whether the retrieved chunks contain enough information to answer the user's query — or whether a web search is needed.

## Query
{query}

## Retrieved Chunks
{chunksContext}

## Evaluation Rules
- If chunks directly address the query → relevant
- If chunks are loosely related but cannot actually answer the query → not relevant
- If the query asks about recent events, current affairs, latest releases, or anything time-sensitive → not relevant (your knowledge base may be outdated)
- If chunks are from the right topic but missing the specific detail asked → not relevant

## Response
Respond with JSON only. No explanation outside the JSON.


  {{
    "relevant": true | false,
  "reason": "one line — why chunks are sufficient or why they are not",
  "confidence": "high" | "medium" | "low"
  }}
`,
  ],
]);
