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

export const queryIntentPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `
             You are a query intent classifier for a Retrieval-Augmented Generation (RAG) system.

              Your task is to determine the most appropriate retrieval strategy for a user's query.
             
              ## Query
              {query}

              Return one of:

              1. semantic
              Use when the user is asking for:
              - a specific fact
              - a definition
              - an implementation detail
              - a function/class explanation
              - a comparison
              - a configuration value
              - debugging help
              - code behavior

              These questions can usually be answered using one or a few highly relevant chunks.

              Examples:
              - What is JWT?
              - How does authentication middleware work?
              - What does processChunk() do?
              - What port does Qdrant run on?
              - Difference between dense and sparse vectors?

              2. summary
              Use when the user wants a broad understanding of an entire topic,
              document, module, workflow, architecture, or codebase.

              These questions usually require retrieving multiple related chunks.

              Examples:
              - Summarize this document.
              - Give me an overview of this codebase.
              - Walk me through the architecture.
              - Explain the ingestion pipeline.
              - What is this repository about?
              - Explain authentication from start to finish.

              Rules:
              - Classify based on user intent, not only keywords.
              - If the query asks for an overall understanding, choose summary.
              - If it asks for a specific answer, choose semantic.
              - If mixed, choose the dominant intent.
              - If uncertain, choose semantic.

              Return ONLY valid JSON:

              {{
                "strategy": "semantic" | "summary",
                "confidence": 0.0-1.0,
                "reasoning": "One short sentence."
              }}
    `,
  ],
]);
