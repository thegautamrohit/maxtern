import { NextRequest, NextResponse } from "next/server";
import { ingestDocument } from "@/workflows/ingest";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      // PDF file upload
      const formData = await request.formData();
      const file = formData.get("file") as File | null;

      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      // Save to /tmp/ temporarily
      const buffer = Buffer.from(await file.arrayBuffer());
      const tmpPath = join(tmpdir(), `${randomUUID()}.pdf`);
      writeFileSync(tmpPath, buffer);

      try {
        const documentIds = await ingestDocument("pdf", tmpPath);
        return NextResponse.json({ documentIds, status: "completed" }, { status: 200 });
      } finally {
        unlinkSync(tmpPath); // always clean up
      }
    }

    // JSON — website or github
    const { source, type, branch } = await request.json();

    if (!source || !type) {
      return NextResponse.json({ error: "No source or type provided" }, { status: 400 });
    }

    const documentIds = await ingestDocument(type, source, branch);
    return NextResponse.json({ documentIds, status: "completed" }, { status: 200 });

  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
