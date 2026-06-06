import prisma from "./client";
import qdrant from "../vector/client";

async function main() {
  // Postgres Check
  await prisma.$connect();

  // Qdrant Check
  const info = await qdrant.getCollections();
  console.log("All connections are successful!", info);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
});
