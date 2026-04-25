import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getS3Bucket, getS3Client } from "@/lib/s3";

export const runtime = "nodejs";

export async function GET() {
  try {
    const bucket = getS3Bucket();
    const response = await getS3Client().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: "recordings/",
        MaxKeys: 100,
      }),
    );

    const recordings = (response.Contents || [])
      .filter((item) => item.Key && !item.Key.endsWith("/"))
      .map((item) => ({
        key: item.Key,
        name: item.Key?.split("/").pop() || item.Key,
        size: item.Size || 0,
        lastModified: item.LastModified?.toISOString() || null,
      }))
      .sort((a, b) => {
        return new Date(b.lastModified || 0).getTime() - new Date(a.lastModified || 0).getTime();
      });

    return NextResponse.json({ bucket, recordings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to list recordings." },
      { status: 500 },
    );
  }
}
