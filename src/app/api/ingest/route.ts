import { NextRequest, NextResponse } from "next/server";
import { ingestDocument } from "@/workflows/ingest";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { auth } from "@clerk/nextjs/server";
import {
  validateWebsiteUrl,
  validateGithubUrl,
  MAX_PDF_SIZE,
} from "@/lib/ingest-validation";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }

    const { success, reset } = await checkRateLimit(userId, "ingest");

    if (!success) {
      const retryAfter = Math.ceil((reset - Date.now()) / 1000);
      return NextResponse.json(
        { error: `Too many requests. Retry after ${retryAfter} seconds` },
        { status: 429 },
      );
    }

    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;

      if (!file) {
        return NextResponse.json(
          { error: "No file provided" },
          { status: 400 },
        );
      }

      if (!file.name.toLowerCase().endsWith(".pdf")) {
        return NextResponse.json(
          { error: "Only PDF files are allowed" },
          { status: 400 },
        );
      }

      if (file.size > MAX_PDF_SIZE) {
        return NextResponse.json(
          { error: "File size exceeds 50MB limit" },
          { status: 400 },
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const tmpPath = join(tmpdir(), `${randomUUID()}.pdf`);
      writeFileSync(tmpPath, buffer);

      try {
        const documentIds = await ingestDocument("pdf", tmpPath, userId);
        return NextResponse.json(
          { documentIds, status: "completed" },
          { status: 200 },
        );
      } finally {
        unlinkSync(tmpPath);
      }
    }

    // JSON — website or github
    const { source, type, branch } = await request.json();

    if (!source || !type) {
      return NextResponse.json(
        { error: "No source or type provided" },
        { status: 400 },
      );
    }

    if (!["pdf", "website", "github"].includes(type)) {
      return NextResponse.json(
        { error: "Invalid source type" },
        { status: 400 },
      );
    }

    if (type === "website") {
      const error = await validateWebsiteUrl(source);
      if (error) return NextResponse.json({ error }, { status: 400 });
    }

    if (type === "github") {
      const error = validateGithubUrl(source);
      if (error) return NextResponse.json({ error }, { status: 400 });
    }

    const documentIds = await ingestDocument(type, source, userId, branch);
    return NextResponse.json(
      { documentIds, status: "completed" },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
