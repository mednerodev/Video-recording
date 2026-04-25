"use client";

import AgoraRTC from "agora-rtc-sdk-ng";
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

const recordingMimeTypes: Record<RecordingFormat, string[]> = {
  webm: ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"],
  mp4: ["video/mp4;codecs=avc1,mp4a", "video/mp4"],
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function getSupportedMimeType(format: RecordingFormat) {
  return recordingMimeTypes[format].find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
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
}: {
  label: string;
  track?: ICameraVideoTrack | IAgoraRTCRemoteUser["videoTrack"];
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
      <span className="tile-label">{label}</span>
    </div>
  );
}

export default function Home() {
  const [channelName, setChannelName] = useState("demo-room");
  const [uid] = useState(() => Math.floor(10000 + Math.random() * 90000));
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Ready. Enter a room name and join the call.");
  const [remoteUsers, setRemoteUsers] = useState<IAgoraRTCRemoteUser[]>([]);
  const [localTracks, setLocalTracks] = useState<LocalTracks | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [localRecording, setLocalRecording] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingFormat, setRecordingFormat] = useState<RecordingFormat>("webm");
  const [recordingExtension, setRecordingExtension] = useState<RecordingFormat>("webm");

  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const videoGridRef = useRef<HTMLDivElement | null>(null);
  const recordingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingUrlRef = useRef<string | null>(null);
  const recordingFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceNodesRef = useRef<MediaStreamAudioSourceNode[]>([]);
  const normalizedChannelName = useMemo(() => channelName.trim(), [channelName]);

  useEffect(() => {
    const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    clientRef.current = client;

    const syncUsers = () => setRemoteUsers([...client.remoteUsers]);

    client.on("user-published", async (user, mediaType) => {
      await client.subscribe(user, mediaType);
      if (mediaType === "audio") {
        user.audioTrack?.play();
      }
      syncUsers();
    });

    client.on("user-unpublished", syncUsers);
    client.on("user-left", syncUsers);

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
      const tracks = await AgoraRTC.createMicrophoneAndCameraTracks();

      await clientRef.current.join(appId, normalizedChannelName, token, uid);
      await clientRef.current.publish([tracks[0], tracks[1]]);

      setLocalTracks({ audioTrack: tracks[0], videoTrack: tracks[1] });
      setJoined(true);
      setMicEnabled(true);
      setCameraEnabled(true);
      setMessage(`Joined ${normalizedChannelName} as ${uid}.`);
    } catch (error) {
      setMessage(getErrorMessage(error));
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
      setMessage(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function toggleMic() {
    if (!localTracks) {
      return;
    }
    const next = !micEnabled;
    await localTracks.audioTrack.setEnabled(next);
    setMicEnabled(next);
  }

  async function toggleCamera() {
    if (!localTracks) {
      return;
    }
    const next = !cameraEnabled;
    await localTracks.videoTrack.setEnabled(next);
    setCameraEnabled(next);
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
      const audioTracks: MediaStreamTrack[] = [];

      if (localTracks?.audioTrack) {
        audioTracks.push(localTracks.audioTrack.getMediaStreamTrack());
      }
      remoteUsers.forEach((user) => {
        const track = user.audioTrack?.getMediaStreamTrack();
        if (track) {
          audioTracks.push(track);
        }
      });

      if (audioTracks.length > 0) {
        const audioWindow = window as WebkitAudioWindow;
        const AudioContextClass = audioWindow.AudioContext || audioWindow.webkitAudioContext;
        if (!AudioContextClass) {
          throw new Error("Audio recording is not supported in this browser.");
        }
        const audioContext = new AudioContextClass();
        await audioContext.resume();
        audioContextRef.current = audioContext;
        const destination = audioContext.createMediaStreamDestination();

        audioTracks.forEach((track) => {
          const source = audioContext.createMediaStreamSource(new MediaStream([track]));
          source.connect(destination);
          audioSourceNodesRef.current.push(source);
        });
        destination.stream.getAudioTracks().forEach((track) => outputStream.addTrack(track));
      }

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
      const mimeType = getSupportedMimeType(recordingFormat);

      if (!mimeType) {
        throw new Error(`${recordingFormat.toUpperCase()} recording is not supported in this browser.`);
      }

      const recorder = new MediaRecorder(outputStream, {
        mimeType,
      });
      setRecordingExtension(recordingFormat);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
        const url = URL.createObjectURL(blob);
        recordingUrlRef.current = url;
        setRecordingUrl(url);
        setLocalRecording(false);
        cleanupRecordingStream();
        recordingStreamRef.current = null;
        recorderRef.current = null;
        setMessage("Local recording is ready to download.");
      };

      recordingStreamRef.current = outputStream;
      recorderRef.current = recorder;
      recorder.start(1000);
      setLocalRecording(true);
      setMessage(`Local recording started with ${audioTracks.length} audio track(s).`);
    } catch (error) {
      setMessage(getErrorMessage(error));
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

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>Call Recorder</h1>
          <span>Channel audio/video with local browser recording</span>
        </div>
        <div className="status">
          <span className={`dot ${localRecording ? "recording" : joined ? "live" : ""}`} />
          {localRecording ? "Recording" : joined ? "Live" : "Offline"}
        </div>
      </header>

      <div className="content">
        <section className="stage">
          {joined ? (
            <div className="video-grid" ref={videoGridRef}>
              <VideoTile label={`You (${uid})`} track={localTracks?.videoTrack} />
              {remoteUsers.map((user) => (
                <VideoTile
                  key={String(user.uid)}
                  label={`Guest ${String(user.uid)}`}
                  track={user.videoTrack}
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
          </div>

          <button
            className="button primary full"
            onClick={startLocalRecording}
            disabled={!joined || busy || localRecording}
          >
            Start Local Recording
          </button>
          <div className="field">
            <label htmlFor="recording-format">Recording format</label>
            <select
              id="recording-format"
              value={recordingFormat}
              onChange={(event) => setRecordingFormat(event.target.value as RecordingFormat)}
              disabled={localRecording || busy}
            >
              <option value="webm">WebM</option>
              <option value="mp4">MP4</option>
            </select>
          </div>
          <button
            className="button danger full"
            onClick={() => stopLocalRecording()}
            disabled={!localRecording || busy}
          >
            Stop Recording
          </button>
          {recordingUrl ? (
            <a
              className="button full download"
              href={recordingUrl}
              download={`${normalizedChannelName || "call"}-recording.${recordingExtension}`}
            >
              Download Recording
            </a>
          ) : null}

          <div className="message">{message}</div>
        </aside>
      </div>
      <canvas ref={recordingCanvasRef} className="recording-canvas" aria-hidden="true" />
    </main>
  );
}
