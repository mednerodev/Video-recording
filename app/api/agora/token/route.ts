import { NextResponse } from "next/server";
import { buildRtcToken, getAgoraAppId } from "@/lib/agora";

export async function POST(request: Request) {
  try {
    const { channelName, uid } = (await request.json()) as {
      channelName?: string;
      uid?: number;
    };

    if (!channelName || typeof uid !== "number") {
      return NextResponse.json(
        { error: "channelName and numeric uid are required." },
        { status: 400 },
      );
    }

    return NextResponse.json({
      appId: getAgoraAppId(),
      token: buildRtcToken(channelName, uid),
      uid,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create token." },
      { status: 500 },
    );
  }
}
