import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const webSearchTool = tool(
  async ({ query }) => {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERPER_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query }),
    });
    const data = await response.json();

    const results = data.organic?.slice(0, 5)?.map((r: any) => ({
      title: r.title,
      url: r.link,
      content: r.snippet,
    }));

    return JSON.stringify(results);
  },
  {
    name: "web_search",
    description:
      "Search the web for recent or external information when the knowledge base does not have relevant results",
    schema: z.object({
      query: z.string().describe("The search query to look up"),
    }),
  },
);
