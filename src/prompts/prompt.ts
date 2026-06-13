import { PromptTemplate } from "@langchain/core/prompts";

const qaPrompt = new PromptTemplate({
  template: `You are a helpful assistant.
            Answer the question using ONLY the context below.
            If the answer is not present in the context, say:
            "I don't have enough information in the provided document."

            Context:
            {context}

            Question:
            {userQuery}

            Answer briefly and clearly.`,
  inputVariables: ["userQuery", "context"],
  validateTemplate: true,
});

export default qaPrompt;
