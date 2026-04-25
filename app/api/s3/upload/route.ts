import { NextResponse } from "next/server";
import { getStorageBucketName, safeName, uploadBackblazeFile } from "@/lib/backblaze";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const prefix = safeName(String(formData.get("prefix") || ""));

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File is required." }, { status: 400 });
    }

    const key = `${prefix}${prefix && !prefix.endsWith("/") ? "/" : ""}${safeName(file.name)}`;

    await uploadBackblazeFile({
      key,
      body: Buffer.from(await file.arrayBuffer()),
      contentType: file.type || "application/octet-stream",
    });

    return NextResponse.json({ key, s3Uri: `b2://${getStorageBucketName()}/${key}` });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to upload file." },
      { status: 500 },
    );
  }
}
