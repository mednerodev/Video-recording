import { DeleteObjectsCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getS3Bucket, getS3Client } from "@/lib/s3";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { key } = (await request.json()) as { key?: string };

    if (!key || !key.startsWith("recordings/")) {
      return NextResponse.json({ error: "A valid recording key is required." }, { status: 400 });
    }

    const bucket = getS3Bucket();
    const client = getS3Client();
    const head = await client
      .send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      )
      .catch(() => null);
    const fallbackThumbnailKey = key.replace(/\.[^.]+$/, "-thumbnail.jpg");
    const thumbnailKey = head?.Metadata?.thumbnailkey || fallbackThumbnailKey;
    const keysToDelete = Array.from(new Set([key, thumbnailKey])).filter(Boolean);

    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: keysToDelete.map((deleteKey) => ({ Key: deleteKey })),
          Quiet: true,
        },
      }),
    );

    return NextResponse.json({ deleted: true, keys: keysToDelete });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to delete recording." },
      { status: 500 },
    );
  }
}
