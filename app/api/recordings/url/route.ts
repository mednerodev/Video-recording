import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { getS3Bucket, getS3Client } from "@/lib/s3";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { key } = (await request.json()) as { key?: string };

    if (!key || !key.startsWith("recordings/")) {
      return NextResponse.json({ error: "A valid recording key is required." }, { status: 400 });
    }

    const url = await getSignedUrl(
      getS3Client(),
      new GetObjectCommand({
        Bucket: getS3Bucket(),
        Key: key,
      }),
      { expiresIn: 60 * 15 },
    );

    return NextResponse.json({ url, expiresIn: 900 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create playback URL." },
      { status: 500 },
    );
  }
}
