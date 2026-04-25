import { NextResponse } from "next/server";
import { copyBackblazeFile, deleteBackblazeFiles, findBackblazeFile, safeName } from "@/lib/backblaze";

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

    const file = await findBackblazeFile(key);
    if (!file) {
      return NextResponse.json({ error: "Recording was not found." }, { status: 404 });
    }
    const pathParts = key.split("/");
    const extension = key.split(".").pop() || "webm";
    const fileName = `${Date.now()}-${safeName(title)}.${extension}`;
    const newKey = [...pathParts.slice(0, -1), fileName].join("/");
    const thumbnailKey = file.fileInfo?.thumbnailKey || key.replace(/\.[^.]+$/, "-thumbnail.jpg");
    const newThumbnailKey = newKey.replace(/\.[^.]+$/, "-thumbnail.jpg");

    if (thumbnailKey) {
      await copyBackblazeFile({
        sourceName: thumbnailKey,
        destinationName: newThumbnailKey,
        contentType: "image/jpeg",
        fileInfo: {
          title: title.trim().slice(0, 120),
          room: file.fileInfo?.room || "",
          sourceKey: newKey,
        },
      })
        .then(() => deleteBackblazeFiles([thumbnailKey]))
        .catch(() => undefined);
    }

    await copyBackblazeFile({
      sourceName: key,
      destinationName: newKey,
      contentType: file.contentType,
      fileInfo: {
        ...(file.fileInfo || {}),
        title: title.trim().slice(0, 120),
        thumbnailKey: newThumbnailKey,
      },
    });
    await deleteBackblazeFiles([key]);

    return NextResponse.json({ key: newKey });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to rename recording." },
      { status: 500 },
    );
  }
}
