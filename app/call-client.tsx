"use client";

import AgoraRTC from "agora-rtc-sdk-ng";
import Link from "next/link";
import type {
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  ICameraVideoTrack,
  IMicrophoneAudioTrack,
} from "agora-rtc-sdk-ng";
import { useEffect, useMemo, useRef, useState } from "react";

type LocalTracks = {
  audioTrack: IMicrophoneAudioTrack;
  videoTrack: ICameraVideoTrack;
};

type WebkitAudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

type RecordingFormat = "webm" | "mp4";
type NetworkQuality = {
  downlinkNetworkQuality?: number;
  uplinkNetworkQuality?: number;
};

const recordingMimeTypes: Record<RecordingFormat, string[]> = {
  webm: ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"],
  mp4: ["video/mp4;codecs=avc1,mp4a", "video/mp4"],
};

function getErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "Something went wrong.";
  }

  const text = `${error.name} ${error.message}`;

  if (text.includes("NotAllowedError") || text.includes("PERMISSION_DENIED")) {
    return "Camera or microphone permission was blocked. Click the lock icon in the address bar, allow camera and microphone, then try joining again.";
  }

  if (text.includes("NotFoundError") || text.includes("DEVICE_NOT_FOUND")) {
    return "No camera or microphone was found on this device.";
  }

  if (text.includes("NotReadableError") || text.includes("TRACK_IS_DISABLED")) {
    return "The camera or microphone could not be started. Close other apps using them, then try again.";
  }

  if (text.includes("NotSecureError")) {
    return "Camera and microphone require a secure page. Use http://127.0.0.1:3000 locally or HTTPS in production.";
  }

  if (error.message.includes("NEXT_PUBLIC_AGORA_APP_ID")) {
    return "Agora App ID is missing. Check .env.local and restart the dev server.";
  }

  if (error.message.includes("AGORA_APP_CERTIFICATE")) {
    return "Agora App Certificate is missing. Check .env.local and restart the dev server.";
  }

  if (error.message.includes("BACKBLAZE_")) {
    return `${error.message} Check .env.local and restart the dev server.`;
  }

  return error.message;
}

function getSupportedMimeType(format: RecordingFormat) {
  return recordingMimeTypes[format].find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

function canvasToBlob(canvas: HTMLCanvasElement, type = "image/jpeg", quality = 0.82) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Unable to create recording thumbnail."));
      }
    }, type, quality);
  });
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getNetworkLabel(value?: number) {
  if (!value) {
    return "Unknown";
  }
  if (value <= 2) {
    return "Good";
  }
  if (value <= 4) {
    return "Fair";
  }
  return "Poor";
}

function getNetworkTone(value?: number) {
  if (!value) {
    return "unknown";
  }
  if (value <= 2) {
    return "good";
  }
  if (value <= 4) {
    return "fair";
  }
  return "poor";
}

async function ensureMediaPermissions() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera and microphone are not available in this browser.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: true,
  });
  stream.getTracks().forEach((track) => track.stop());
}

async function postJson<T>(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }

  return payload;
}

function VideoTile({
  label,
  track,
  muted,
  cameraOff,
}: {
  label: string;
  track?: ICameraVideoTrack | IAgoraRTCRemoteUser["videoTrack"];
  muted?: boolean;
  cameraOff?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || !track) {
      return;
    }

    track.play(ref.current);
    return () => {
      track.stop();
    };
  }, [track]);

  return (
    <div className="tile">
      <div ref={ref} />
      <div className="tile-badges">
        {muted ? <span className="tile-badge">Mic off</span> : null}
        {cameraOff ? <span className="tile-badge">Cam off</span> : null}
      </div>
      <span className="tile-label">{label}</span>
    </div>
  );
}

function SignalBars({
  label,
  value,
}: {
  label: string;
  value?: number;
}) {
  const tone = getNetworkTone(value);
  const activeBars = value ? Math.max(1, 6 - value) : 0;

  return (
    <div className={`signal signal-${tone}`}>
      <span>{label}</span>
      <div className="signal-bars" aria-label={`${label} ${getNetworkLabel(value)}`}>
        {[1, 2, 3, 4, 5].map((bar) => (
          <i className={bar <= activeBars ? "active" : ""} key={bar} />
        ))}
      </div>
      <strong>{getNetworkLabel(value)}</strong>
    </div>
  );
}

export default function Home() {
  const [channelName, setChannelName] = useState("demo-room");
  const [displayName, setDisplayName] = useState("Guest");
  const [uid] = useState(() => Math.floor(10000 + Math.random() * 90000));
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Ready. Enter a room name and join the call.");
  const [connectionStatus, setConnectionStatus] = useState("Idle");
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>({});
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [remoteUsers, setRemoteUsers] = useState<IAgoraRTCRemoteUser[]>([]);
  const [localTracks, setLocalTracks] = useState<LocalTracks | null>(null);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState("");
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [localRecording, setLocalRecording] = useState(false);
  const [recordingTitle, setRecordingTitle] = useState("");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [thumbnailBlob, setThumbnailBlob] = useState<Blob | null>(null);
  const [recordingFormat, setRecordingFormat] = useState<RecordingFormat>("webm");
  const [recordingExtension, setRecordingExtension] = useState<RecordingFormat>("webm");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [recordingAudioCount, setRecordingAudioCount] = useState(0);

  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const videoGridRef = useRef<HTMLDivElement | null>(null);
  const recordingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingUrlRef = useRef<string | null>(null);
  const recordingFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceNodesRef = useRef<MediaStreamAudioSourceNode[]>([]);
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const recordedAudioTrackIdsRef = useRef<Set<string>>(new Set());
  const localRecordingRef = useRef(false);
  const recordingStartedAtRef = useRef<number | null>(null);
  const normalizedChannelName = useMemo(() => channelName.trim(), [channelName]);
  const normalizedDisplayName = useMemo(() => displayName.trim() || "Guest", [displayName]);
  const mp4Supported = getSupportedMimeType("mp4") !== undefined;
  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return "";
    }
    const url = new URL(window.location.href);
    url.searchParams.set("room", normalizedChannelName || "demo-room");
    return url.toString();
  }, [normalizedChannelName]);

  useEffect(() => {
    localRecordingRef.current = localRecording;
  }, [localRecording]);

  useEffect(() => {
    const room = new URLSearchParams(window.location.search).get("room");
    if (room) {
      setChannelName(room);
    }
  }, []);

  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((device) => device.kind === "audioinput");
    const videoInputs = devices.filter((device) => device.kind === "videoinput");
    setMicrophones(audioInputs);
    setCameras(videoInputs);
    setSelectedMicId((current) => current || audioInputs[0]?.deviceId || "");
    setSelectedCameraId((current) => current || videoInputs[0]?.deviceId || "");
  }

  useEffect(() => {
    refreshDevices().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!localRecording) {
      return;
    }

    const interval = window.setInterval(() => {
      if (recordingStartedAtRef.current) {
        setRecordingSeconds(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000));
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [localRecording]);

  useEffect(() => {
    AgoraRTC.setLogLevel(4);
    const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    clientRef.current = client;

    const syncUsers = () => {
      setRemoteUsers([...client.remoteUsers]);
      client.remoteUsers.forEach((user) => {
        setUserNames((names) => ({
          ...names,
          [String(user.uid)]: names[String(user.uid)] || `Guest ${String(user.uid)}`,
        }));
      });
    };

    client.on("user-published", async (user, mediaType) => {
      try {
        await client.subscribe(user, mediaType);
        if (mediaType === "audio") {
          user.audioTrack?.play();
          if (localRecordingRef.current) {
            addAudioTrackToRecording(user.audioTrack?.getMediaStreamTrack());
          }
        }
        syncUsers();
      } catch (error) {
        setMessage(`Agora subscribe failed: ${getErrorMessage(error)}`);
      }
    });

    client.on("user-unpublished", syncUsers);
    client.on("user-left", syncUsers);
    client.on("connection-state-change", (curState, prevState, reason) => {
      setConnectionStatus(reason ? `${curState} (${reason})` : curState);
    });
    client.on("network-quality", (stats) => {
      setNetworkQuality(stats);
    });

    return () => {
      client.removeAllListeners();
      client.leave().catch(() => undefined);
      stopLocalRecording(false);
      if (recordingUrlRef.current) {
        URL.revokeObjectURL(recordingUrlRef.current);
      }
    };
  }, []);

  async function joinCall() {
    if (!normalizedChannelName || !clientRef.current || busy) {
      return;
    }

    setBusy(true);
    try {
      const { appId, token } = await postJson<{ appId: string; token: string }>(
        "/api/agora/token",
        {
          channelName: normalizedChannelName,
          uid,
        },
      );
      await ensureMediaPermissions();
      await refreshDevices();
      const tracks = await AgoraRTC.createMicrophoneAndCameraTracks(
        selectedMicId ? { microphoneId: selectedMicId } : undefined,
        selectedCameraId ? { cameraId: selectedCameraId } : undefined,
      );

      await clientRef.current.join(appId, normalizedChannelName, token, uid);
      await clientRef.current.publish([tracks[0], tracks[1]]);

      setLocalTracks({ audioTrack: tracks[0], videoTrack: tracks[1] });
      setJoined(true);
      setMicEnabled(true);
      setCameraEnabled(true);
      setUserNames((names) => ({
        ...names,
        [String(uid)]: normalizedDisplayName,
      }));
      setMessage(`Joined ${normalizedChannelName} as ${uid}.`);
    } catch (error) {
      setMessage(`Join failed: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function leaveCall() {
    setBusy(true);
    try {
      if (localRecording) {
        stopLocalRecording(false);
      }

      localTracks?.audioTrack.close();
      localTracks?.videoTrack.close();
      await clientRef.current?.leave();

      setLocalTracks(null);
      setRemoteUsers([]);
      setJoined(false);
      setMessage("Left the call.");
    } catch (error) {
      setMessage(`Leave failed: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleMic() {
    if (!localTracks) {
      return;
    }
    try {
      const next = !micEnabled;
      await localTracks.audioTrack.setEnabled(next);
      setMicEnabled(next);
    } catch (error) {
      setMessage(`Mic toggle failed: ${getErrorMessage(error)}`);
    }
  }

  async function toggleCamera() {
    if (!localTracks) {
      return;
    }
    try {
      const next = !cameraEnabled;
      await localTracks.videoTrack.setEnabled(next);
      setCameraEnabled(next);
    } catch (error) {
      setMessage(`Camera toggle failed: ${getErrorMessage(error)}`);
    }
  }

  async function copyRoomLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setMessage("Room link copied.");
    } catch {
      setMessage(shareUrl);
    }
  }

  async function createAudioMixer(outputStream: MediaStream) {
    const audioWindow = window as WebkitAudioWindow;
    const AudioContextClass = audioWindow.AudioContext || audioWindow.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("Audio recording is not supported in this browser.");
    }

    const audioContext = new AudioContextClass();
    await audioContext.resume();
    audioContextRef.current = audioContext;
    audioDestinationRef.current = audioContext.createMediaStreamDestination();
    audioDestinationRef.current.stream.getAudioTracks().forEach((track) => outputStream.addTrack(track));
  }

  function addAudioTrackToRecording(track?: MediaStreamTrack) {
    const audioContext = audioContextRef.current;
    const destination = audioDestinationRef.current;

    if (!track || !audioContext || !destination || recordedAudioTrackIdsRef.current.has(track.id)) {
      return;
    }

    const source = audioContext.createMediaStreamSource(new MediaStream([track]));
    source.connect(destination);
    audioSourceNodesRef.current.push(source);
    recordedAudioTrackIdsRef.current.add(track.id);
    setRecordingAudioCount(recordedAudioTrackIdsRef.current.size);
  }

  async function startLocalRecording() {
    if (!joined) {
      return;
    }

    setBusy(true);
    try {
      if (recordingUrlRef.current) {
        URL.revokeObjectURL(recordingUrlRef.current);
        recordingUrlRef.current = null;
        setRecordingUrl(null);
        setRecordingBlob(null);
        setThumbnailBlob(null);
        setUploadProgress(0);
      }

      const canvas = recordingCanvasRef.current;
      const grid = videoGridRef.current;
      const context = canvas?.getContext("2d");

      if (!canvas || !grid || !context) {
        throw new Error("Recording canvas is not ready.");
      }

      canvas.width = 1280;
      canvas.height = 720;
      const canvasStream = canvas.captureStream(30);
      const outputStream = new MediaStream(canvasStream.getVideoTracks());
      setRecordingAudioCount(0);
      recordedAudioTrackIdsRef.current = new Set();
      await createAudioMixer(outputStream);
      addAudioTrackToRecording(localTracks?.audioTrack.getMediaStreamTrack());
      remoteUsers.forEach((user) => addAudioTrackToRecording(user.audioTrack?.getMediaStreamTrack()));

      const drawFrame = () => {
        const tiles = Array.from(grid.querySelectorAll<HTMLElement>(".tile"));
        const visibleTiles = tiles.filter((tile) => tile.querySelector("video"));
        const tileCount = Math.max(visibleTiles.length, 1);
        const columns = Math.ceil(Math.sqrt(tileCount));
        const rows = Math.ceil(tileCount / columns);
        const gap = 16;
        const cellWidth = (canvas.width - gap * (columns + 1)) / columns;
        const cellHeight = (canvas.height - gap * (rows + 1)) / rows;

        context.fillStyle = "#101215";
        context.fillRect(0, 0, canvas.width, canvas.height);

        visibleTiles.forEach((tile, index) => {
          const video = tile.querySelector("video");
          if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            return;
          }

          const column = index % columns;
          const row = Math.floor(index / columns);
          const x = gap + column * (cellWidth + gap);
          const y = gap + row * (cellHeight + gap);
          const videoRatio = video.videoWidth / Math.max(video.videoHeight, 1);
          const cellRatio = cellWidth / cellHeight;
          const drawWidth = videoRatio > cellRatio ? cellHeight * videoRatio : cellWidth;
          const drawHeight = videoRatio > cellRatio ? cellHeight : cellWidth / videoRatio;
          const drawX = x + (cellWidth - drawWidth) / 2;
          const drawY = y + (cellHeight - drawHeight) / 2;
          const label = tile.querySelector(".tile-label")?.textContent || "";

          context.save();
          context.beginPath();
          context.roundRect(x, y, cellWidth, cellHeight, 12);
          context.clip();
          context.fillStyle = "#060708";
          context.fillRect(x, y, cellWidth, cellHeight);
          context.drawImage(video, drawX, drawY, drawWidth, drawHeight);
          context.restore();

          if (label) {
            context.fillStyle = "rgba(0, 0, 0, 0.62)";
            context.roundRect(x + 14, y + cellHeight - 43, 148, 28, 14);
            context.fill();
            context.fillStyle = "#f4f7fb";
            context.font = "14px Arial";
            context.fillText(label.slice(0, 18), x + 26, y + cellHeight - 24);
          }
        });

        recordingFrameRef.current = requestAnimationFrame(drawFrame);
      };
      drawFrame();

      const chunks: BlobPart[] = [];
      let finalFormat = recordingFormat;
      let mimeType = getSupportedMimeType(finalFormat);

      if (!mimeType) {
        if (recordingFormat === "mp4") {
          finalFormat = "webm";
          mimeType = getSupportedMimeType("webm");
          setMessage("MP4 recording is not supported in this browser, so this recording will use WebM.");
        }

        if (!mimeType) {
          throw new Error(`${recordingFormat.toUpperCase()} recording is not supported in this browser.`);
        }
      }

      const recorder = new MediaRecorder(outputStream, {
        mimeType,
      });
      setRecordingExtension(finalFormat);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
        const thumbnail = await canvasToBlob(canvas).catch(() => null);
        const url = URL.createObjectURL(blob);
        recordingUrlRef.current = url;
        setRecordingUrl(url);
        setRecordingBlob(blob);
        setThumbnailBlob(thumbnail);
        setLocalRecording(false);
        cleanupRecordingStream();
        recordingStreamRef.current = null;
        recorderRef.current = null;
        setMessage(
          thumbnail
            ? "Local recording is ready. Uploading to Backblaze..."
            : "Local recording is ready. Thumbnail could not be generated, uploading video only...",
        );
        uploadBlob(blob, `${normalizedChannelName || "call"}-recording.${finalFormat}`, finalFormat, thumbnail);
      };

      recordingStreamRef.current = outputStream;
      recorderRef.current = recorder;
      recordingStartedAtRef.current = Date.now();
      setRecordingSeconds(0);
      recorder.start(1000);
      setLocalRecording(true);
      setMessage(`Local recording started with ${recordedAudioTrackIdsRef.current.size} audio track(s).`);
    } catch (error) {
      setMessage(`Recording failed: ${getErrorMessage(error)}`);
      cleanupRecordingStream();
      recordingStreamRef.current = null;
    } finally {
      setBusy(false);
    }
  }

  function cleanupRecordingStream() {
    if (recordingFrameRef.current) {
      cancelAnimationFrame(recordingFrameRef.current);
      recordingFrameRef.current = null;
    }
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioSourceNodesRef.current.forEach((source) => source.disconnect());
    audioSourceNodesRef.current = [];
    audioDestinationRef.current = null;
    recordedAudioTrackIdsRef.current = new Set();
    setRecordingAudioCount(0);
    recordingStartedAtRef.current = null;
    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
  }

  function stopLocalRecording(showMessage = true) {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      if (showMessage) {
        setMessage("Stopping local recording...");
      }
      return;
    }
    cleanupRecordingStream();
    recordingStreamRef.current = null;
    setLocalRecording(false);
  }

  function uploadBlob(
    blob: Blob,
    filename: string,
    format = recordingExtension,
    thumbnail = thumbnailBlob,
  ) {
    setUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append("file", blob, filename);
    formData.append("channelName", normalizedChannelName || "call");
    formData.append("title", recordingTitle.trim() || filename.replace(/\.[^.]+$/, ""));
    formData.append("duration", String(recordingSeconds));
    formData.append("format", format);
    if (thumbnail) {
      formData.append("thumbnail", thumbnail, filename.replace(/\.[^.]+$/, ".jpg"));
    }

    const request = new XMLHttpRequest();
    request.open("POST", "/api/recordings/upload");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setUploadProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onload = () => {
      setUploading(false);
      const payload = JSON.parse(request.responseText || "{}") as {
        error?: string;
        s3Uri?: string;
      };

      if (request.status < 200 || request.status >= 300) {
        setMessage(`Upload failed: ${payload.error || `HTTP ${request.status}`}`);
        return;
      }

      setUploadProgress(100);
      setMessage(`Uploaded recording to ${payload.s3Uri}.`);
    };
    request.onerror = () => {
      setUploading(false);
      setMessage("Upload failed: network error while sending the recording to Backblaze.");
    };
    request.send(formData);
  }

  function uploadRecording() {
    if (!recordingBlob) {
      return;
    }

    uploadBlob(recordingBlob, `${normalizedChannelName || "call"}-recording.${recordingExtension}`);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>Call Recorder</h1>
          <span>Channel audio/video with local browser recording</span>
        </div>
        <div className="status">
          <Link className="button" href="/recordings">
            Recordings
          </Link>
          <Link className="button" href="/s3">
            Files
          </Link>
          <span className={`dot ${localRecording ? "recording" : joined ? "live" : ""}`} />
          {localRecording ? "Recording" : joined ? "Live" : "Offline"}
        </div>
      </header>

      <div className="content">
        <section className="stage">
          <div className="stage-status">
            <div>
              <span className={`dot ${localRecording ? "recording" : joined ? "live" : ""}`} />
              <strong>{connectionStatus}</strong>
            </div>
            <SignalBars label="Upload" value={networkQuality.uplinkNetworkQuality} />
            <SignalBars label="Download" value={networkQuality.downlinkNetworkQuality} />
          </div>

          {joined ? (
            <div className="video-grid" ref={videoGridRef}>
              <VideoTile
                label={`${normalizedDisplayName} (${uid})`}
                track={localTracks?.videoTrack}
                muted={!micEnabled}
                cameraOff={!cameraEnabled}
              />
              {remoteUsers.map((user) => (
                <VideoTile
                  key={String(user.uid)}
                  label={userNames[String(user.uid)] || `Guest ${String(user.uid)}`}
                  track={user.videoTrack}
                  muted={!user.hasAudio}
                  cameraOff={!user.hasVideo}
                />
              ))}
            </div>
          ) : (
            <div className="empty">
              <p>Join a channel to start the camera preview and invite another user with the same room name.</p>
            </div>
          )}

          <div className="controls">
            <button className="button" onClick={toggleMic} disabled={!joined || busy}>
              {micEnabled ? "Mute" : "Unmute"}
            </button>
            <button className="button" onClick={toggleCamera} disabled={!joined || busy}>
              {cameraEnabled ? "Camera Off" : "Camera On"}
            </button>
            <button className="button danger" onClick={leaveCall} disabled={!joined || busy}>
              Leave
            </button>
          </div>
        </section>

        <aside className="side">
          <div className="field">
            <label htmlFor="display-name">Your name</label>
            <input
              id="display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={joined || busy}
              maxLength={40}
            />
            <label htmlFor="channel">Room name</label>
            <input
              id="channel"
              value={channelName}
              onChange={(event) => setChannelName(event.target.value)}
              disabled={joined || busy}
              maxLength={64}
            />
            <button
              className="button primary full"
              type="button"
              onClick={joinCall}
              disabled={joined || busy || !normalizedChannelName}
            >
              Join Call
            </button>
            <button className="button full" type="button" onClick={copyRoomLink} disabled={!normalizedChannelName}>
              Copy Room Link
            </button>
          </div>

          <div className="field">
            <label htmlFor="microphone">Microphone</label>
            <select
              id="microphone"
              value={selectedMicId}
              onChange={(event) => setSelectedMicId(event.target.value)}
              disabled={joined || busy}
            >
              {microphones.map((device, index) => (
                <option value={device.deviceId} key={device.deviceId}>
                  {device.label || `Microphone ${index + 1}`}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="camera">Camera</label>
            <select
              id="camera"
              value={selectedCameraId}
              onChange={(event) => setSelectedCameraId(event.target.value)}
              disabled={joined || busy}
            >
              {cameras.map((device, index) => (
                <option value={device.deviceId} key={device.deviceId}>
                  {device.label || `Camera ${index + 1}`}
                </option>
              ))}
            </select>
          </div>

          <button
            className="button primary full"
            onClick={startLocalRecording}
            disabled={!joined || busy || localRecording}
          >
            Start Local Recording
          </button>
          <div className="field">
            <label htmlFor="recording-title">Recording title</label>
            <input
              id="recording-title"
              value={recordingTitle}
              onChange={(event) => setRecordingTitle(event.target.value)}
              disabled={localRecording || busy}
              maxLength={80}
              placeholder="Meeting title"
            />
          </div>
          <div className="field">
            <label htmlFor="recording-format">Recording format</label>
            <select
              id="recording-format"
              value={recordingFormat}
              onChange={(event) => setRecordingFormat(event.target.value as RecordingFormat)}
              disabled={localRecording || busy}
            >
              <option value="webm">WebM</option>
              <option value="mp4">MP4{mp4Supported ? "" : " (unsupported)"}</option>
            </select>
            {!mp4Supported ? (
              <span className="hint">MP4 recording is not supported in this browser. WebM will be used instead.</span>
            ) : null}
          </div>
          <button
            className="button danger full"
            onClick={() => stopLocalRecording()}
            disabled={!localRecording || busy}
          >
            Stop Recording
          </button>
          {localRecording ? (
            <>
              <div className="meter">
                <span>Recording time</span>
                <strong>{formatDuration(recordingSeconds)}</strong>
              </div>
              <div className="meter">
                <span>Recording audio tracks</span>
                <strong>{recordingAudioCount}</strong>
              </div>
            </>
          ) : null}
          {recordingUrl ? (
            <a
              className="button full download"
              href={recordingUrl}
              download={`${normalizedChannelName || "call"}-recording.${recordingExtension}`}
            >
              Download Recording
            </a>
          ) : null}
          {recordingBlob ? (
            <>
              <button
                className="button full"
                type="button"
                onClick={uploadRecording}
                disabled={uploading || busy}
              >
              {uploading ? "Uploading..." : "Upload to Backblaze"}
              </button>
              {uploading || uploadProgress > 0 ? (
                <div className="progress" aria-label="Upload progress">
                  <span style={{ width: `${uploadProgress}%` }} />
                  <strong>{uploadProgress}%</strong>
                </div>
              ) : null}
            </>
          ) : null}

          <div className="message">{message}</div>
        </aside>
      </div>
      <canvas ref={recordingCanvasRef} className="recording-canvas" aria-hidden="true" />
    </main>
  );
}
