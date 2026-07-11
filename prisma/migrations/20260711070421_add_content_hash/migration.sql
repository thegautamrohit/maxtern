/*
  Warnings:

  - A unique constraint covering the columns `[userId,contentHash]` on the table `Document` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `contentHash` to the `Document` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "contentHash" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Document_userId_contentHash_key" ON "Document"("userId", "contentHash");
