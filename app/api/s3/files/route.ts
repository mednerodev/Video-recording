import { NextResponse } from "next/server";
import { getStorageBucketName, listBackblazeFiles, safeName } from "@/lib/backblaze";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const prefix = safeName(url.searchParams.get("prefix") || "");
    const bucket = getStorageBucketName();
    const response = await listBackblazeFiles(prefix);
    const folderSet = new Set<string>();
    const files = response
      .filter((item) => item.fileName && item.fileName !== prefix)
      .filter((item) => {
        const key = item.fileName || "";
        const rest = key.slice(prefix.length);
        const slashIndex = rest.indexOf("/");

        if (slashIndex >= 0) {
          folderSet.add(`${prefix}${rest.slice(0, slashIndex + 1)}`);
          return false;
        }

        return true;
      })
      .map((item) => ({
        key: item.fileName,
        name: item.fileName?.split("/").filter(Boolean).pop() || item.fileName,
        size: item.contentLength || 0,
        lastModified: item.uploadTimestamp ? new Date(item.uploadTimestamp).toISOString() : null,
      }));

    return NextResponse.json({
      bucket,
      prefix,
      folders: Array.from(folderSet).sort(),
      files,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to list Backblaze files." },
      { status: 500 },
    );
  }
}
