import { NextResponse } from "next/server";
import { deleteBackblazeFiles } from "@/lib/backblaze";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { keys } = (await request.json()) as { keys?: string[] };
    const filteredKeys = (keys || []).filter(Boolean);

    if (!filteredKeys.length) {
      return NextResponse.json({ error: "At least one file key is required." }, { status: 400 });
    }

    await deleteBackblazeFiles(filteredKeys);

    return NextResponse.json({ deleted: true, keys: filteredKeys });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to delete files." },
      { status: 500 },
    );
  }
}
