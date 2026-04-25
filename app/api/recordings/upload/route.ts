import { PutObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getS3Bucket, getS3Client, safeName } from "@/lib/s3";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const channelName = safeName(String(formData.get("channelName") || "call"));

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Recording file is required." }, { status: 400 });
    }

    const bucket = getS3Bucket();
    const extension = safeName(file.name.split(".").pop() || "webm") || "webm";
    const key = `recordings/${channelName}/${Date.now()}-${safeName(file.name) || `recording.${extension}`}`;

    await getS3Client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: Buffer.from(await file.arrayBuffer()),
        ContentType: file.type || `video/${extension}`,
      }),
    );

    return NextResponse.json({
      bucket,
      key,
      s3Uri: `s3://${bucket}/${key}`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to upload recording." },
      { status: 500 },
    );
  }
}
