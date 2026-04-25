import { NextResponse } from "next/server";
import { deleteBackblazeFiles, findBackblazeFile } from "@/lib/backblaze";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { key } = (await request.json()) as { key?: string };

    if (!key || !key.startsWith("recordings/")) {
      return NextResponse.json({ error: "A valid recording key is required." }, { status: 400 });
    }

    const file = await findBackblazeFile(key);
    const fallbackThumbnailKey = key.replace(/\.[^.]+$/, "-thumbnail.jpg");
    const thumbnailKey = file?.fileInfo?.thumbnailKey || fallbackThumbnailKey;
    const keysToDelete = Array.from(new Set([key, thumbnailKey])).filter(Boolean);
    await deleteBackblazeFiles(keysToDelete);

    return NextResponse.json({ deleted: true, keys: keysToDelete });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to delete recording." },
      { status: 500 },
    );
  }
}
