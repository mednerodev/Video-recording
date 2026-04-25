import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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

    const client = getS3Client();
    const objects = (response.Contents || []).filter((item) => {
      return (
        item.Key &&
        !item.Key.endsWith("/") &&
        !item.Key.endsWith(".json") &&
        !item.Key.endsWith("-thumbnail.jpg")
      );
    });
    const recordings = await Promise.all(
      objects.map(async (item) => {
        const key = item.Key || "";
        const head = await client
          .send(
            new HeadObjectCommand({
              Bucket: bucket,
              Key: key,
            }),
          )
          .catch(() => null);

        const thumbnailKey = head?.Metadata?.thumbnailkey || "";
        const thumbnailUrl = thumbnailKey
          ? await getSignedUrl(
              client,
              new GetObjectCommand({
                Bucket: bucket,
                Key: thumbnailKey,
              }),
              { expiresIn: 60 * 15 },
            ).catch(() => "")
          : "";

        return {
          key,
          name: key.split("/").pop() || key,
          size: item.Size || 0,
          lastModified: item.LastModified?.toISOString() || null,
          metadata: {
            title: head?.Metadata?.title || "",
            room: head?.Metadata?.room || key.split("/")[1] || "",
            duration: Number(head?.Metadata?.duration || 0),
            format: head?.Metadata?.format || key.split(".").pop() || "",
            uploadedAt: head?.Metadata?.uploadedat || "",
            thumbnailKey,
            thumbnailUrl,
          },
        };
      }),
    );

    recordings
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
