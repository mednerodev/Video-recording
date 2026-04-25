import { NextResponse } from "next/server";
import { getStorageBucketName, safeName, uploadBackblazeFile } from "@/lib/backblaze";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const thumbnail = formData.get("thumbnail");
    const channelName = safeName(String(formData.get("channelName") || "call"));
    const title = String(formData.get("title") || "Untitled recording").slice(0, 120);
    const duration = String(formData.get("duration") || "0");
    const format = safeName(String(formData.get("format") || "webm"));

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Recording file is required." }, { status: 400 });
    }

    const extension = safeName(file.name.split(".").pop() || "webm") || "webm";
    const key = `recordings/${channelName}/${Date.now()}-${safeName(file.name) || `recording.${extension}`}`;
    const thumbnailKey =
      thumbnail instanceof File ? key.replace(/\.[^.]+$/, "-thumbnail.jpg") : "";

    if (thumbnail instanceof File) {
      await uploadBackblazeFile({
        key: thumbnailKey,
        body: Buffer.from(await thumbnail.arrayBuffer()),
        contentType: thumbnail.type || "image/jpeg",
        fileInfo: {
          title,
          room: channelName,
          sourceKey: key,
        },
      });
    }

    await uploadBackblazeFile({
      key,
      body: Buffer.from(await file.arrayBuffer()),
      contentType: file.type || `video/${extension}`,
      fileInfo: {
        title,
        room: channelName,
        duration,
        format,
        uploadedAt: new Date().toISOString(),
        thumbnailKey,
      },
    });

    return NextResponse.json({
      bucket: getStorageBucketName(),
      key,
      s3Uri: `b2://${getStorageBucketName()}/${key}`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to upload recording." },
      { status: 500 },
    );
  }
}
