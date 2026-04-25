import { CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getS3Bucket, getS3Client, safeName } from "@/lib/s3";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { key, title } = (await request.json()) as {
      key?: string;
      title?: string;
    };

    if (!key || !key.startsWith("recordings/")) {
      return NextResponse.json({ error: "A valid recording key is required." }, { status: 400 });
    }

    if (!title?.trim()) {
      return NextResponse.json({ error: "Recording title is required." }, { status: 400 });
    }

    const bucket = getS3Bucket();
    const client = getS3Client();
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const pathParts = key.split("/");
    const extension = key.split(".").pop() || "webm";
    const fileName = `${Date.now()}-${safeName(title)}.${extension}`;
    const newKey = [...pathParts.slice(0, -1), fileName].join("/");

    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: newKey,
        CopySource: `${bucket}/${encodeURIComponent(key).replace(/%2F/g, "/")}`,
        ContentType: head.ContentType,
        MetadataDirective: "REPLACE",
        Metadata: {
          ...(head.Metadata || {}),
          title: title.trim().slice(0, 120),
        },
      }),
    );
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));

    return NextResponse.json({ key: newKey });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to rename recording." },
      { status: 500 },
    );
  }
}
