import { NextResponse } from "next/server";
import { getBackblazeDownloadUrl, getStorageBucketName, listBackblazeFiles } from "@/lib/backblaze";

export const runtime = "nodejs";

export async function GET() {
  try {
    const bucket = getStorageBucketName();
    const objects = (await listBackblazeFiles("recordings/")).filter((item) => {
      return !item.fileName.endsWith("/") && !item.fileName.endsWith(".json") && !item.fileName.endsWith("-thumbnail.jpg");
    });
    const allFiles = await listBackblazeFiles("recordings/");
    const fileNames = new Set(allFiles.map((file) => file.fileName));
    const recordings = await Promise.all(
      objects.map(async (item) => {
        const key = item.fileName;
        const fallbackThumbnailKey = key.replace(/\.[^.]+$/, "-thumbnail.jpg");
        const thumbnailKey =
          item.fileInfo?.thumbnailKey || (fileNames.has(fallbackThumbnailKey) ? fallbackThumbnailKey : "");
        const thumbnailUrl = thumbnailKey ? await getBackblazeDownloadUrl(thumbnailKey).catch(() => "") : "";

        return {
          key,
          name: key.split("/").pop() || key,
          size: item.contentLength || 0,
          lastModified: item.uploadTimestamp ? new Date(item.uploadTimestamp).toISOString() : null,
          metadata: {
            title: item.fileInfo?.title || "",
            room: item.fileInfo?.room || key.split("/")[1] || "",
            duration: Number(item.fileInfo?.duration || 0),
            format: item.fileInfo?.format || key.split(".").pop() || "",
            uploadedAt: item.fileInfo?.uploadedAt || "",
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
