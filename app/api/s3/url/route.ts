import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { key } = (await request.json()) as { key?: string };

    if (!key) {
      return NextResponse.json({ error: "File key is required." }, { status: 400 });
    }

    const url = `/api/backblaze/stream?key=${encodeURIComponent(key)}`;

    return NextResponse.json({ url, expiresIn: 900 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create file URL." },
      { status: 500 },
    );
  }
}
