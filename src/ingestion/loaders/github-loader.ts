import { GithubRepoLoader } from "@langchain/community/document_loaders/web/github";
import { Document } from "../../core/types";

export async function githubLoader(
  repoUrl: string,
  branch: string = "main",
): Promise<Document[]> {
  const loader = new GithubRepoLoader(repoUrl, { branch });
  const docs = await loader.load();
  if (!docs || docs.length === 0) {
    throw new Error(
      `Failed to load content from GitHub repository: ${repoUrl}`,
    );
  }

  const transformedDocs = docs?.map((doc) => {
    return {
      title: doc?.metadata?.source,
      content: doc.pageContent,
      sourceType: "github" as const,
      metadata: {
        source: doc?.metadata?.source,
        repositoryUrl: doc?.metadata?.repository,
        branch: doc?.metadata?.branch,
      },
    };
  });

  return transformedDocs;
}

// githubLoader("https://github.com/ed-roh/mern-social-media", "master")
//   .then((docs) => {
//     console.log(JSON.stringify(docs, null, 2));
//   })
//   .catch((err) => {
//     console.error("Error loading GitHub repository:", err);
//   });
