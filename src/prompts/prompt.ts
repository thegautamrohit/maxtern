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
