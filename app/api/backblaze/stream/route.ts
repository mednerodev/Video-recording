import { NextResponse } from "next/server";
import { downloadBackblazeFile } from "@/lib/backblaze";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const key = new URL(request.url).searchParams.get("key");

    if (!key) {
      return NextResponse.json({ error: "File key is required." }, { status: 400 });
    }

    const file = await downloadBackblazeFile(key);

    return new Response(file.body, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.body.length),
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to stream file." },
      { status: 500 },
    );
  }
}
