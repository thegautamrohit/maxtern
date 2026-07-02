import qdrant from "./client";

export async function ensureCollections() {
  const { collections } = await qdrant.getCollections();
  if (collections.some((item) => item.name === "chunks")) {
    console.log("Collection already exists. Skipping creation.");
    return;
  }

  await qdrant.createCollection("chunks", {
    vectors: {
      dense: {
        size: 768,
        distance: "Cosine",
      },
    },
    sparse_vectors: {
      sparse: {},
    },
  });
  console.log("Collection 'documents' created successfully.");
}
