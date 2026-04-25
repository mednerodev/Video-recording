import { RtcRole, RtcTokenBuilder } from "agora-token";

const TOKEN_TTL_SECONDS = 60 * 60;

export function getAgoraAppId() {
  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
  if (!appId) {
    throw new Error("NEXT_PUBLIC_AGORA_APP_ID is not configured.");
  }
  return appId;
}

export function buildRtcToken(channelName: string, uid: number | string) {
  const appId = getAgoraAppId();
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;
  if (!appCertificate) {
    throw new Error("AGORA_APP_CERTIFICATE is not configured.");
  }

  const now = Math.floor(Date.now() / 1000);
  return RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    Number(uid),
    RtcRole.PUBLISHER,
    now + TOKEN_TTL_SECONDS,
    now + TOKEN_TTL_SECONDS,
  );
}
