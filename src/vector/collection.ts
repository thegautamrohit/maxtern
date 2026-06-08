import qdrant from "./client";

export async function ensureCollections() {
  const { collections } = await qdrant.getCollections();
  if (collections.some((item) => item.name === "chunks")) {
    console.log("Collection already exists. Skipping creation.");
    return;
  }

  await qdrant.createCollection("chunks", {
    vectors: {
      size: 768,
      distance: "Cosine",
    },
  });
  console.log("Collection 'documents' created successfully.");
}
