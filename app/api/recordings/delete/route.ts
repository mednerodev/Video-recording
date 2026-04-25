import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getS3Bucket, getS3Client } from "@/lib/s3";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { key } = (await request.json()) as { key?: string };

    if (!key || !key.startsWith("recordings/")) {
      return NextResponse.json({ error: "A valid recording key is required." }, { status: 400 });
    }

    await getS3Client().send(
      new DeleteObjectCommand({
        Bucket: getS3Bucket(),
        Key: key,
      }),
    );

    return NextResponse.json({ deleted: true, key });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to delete recording." },
      { status: 500 },
    );
  }
}
