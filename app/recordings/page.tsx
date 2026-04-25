"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Recording = {
  key: string;
  name: string;
  size: number;
  lastModified: string | null;
  metadata?: {
    title?: string;
    room?: string;
    duration?: number;
    format?: string;
    uploadedAt?: string;
    thumbnailKey?: string;
    thumbnailUrl?: string;
  };
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function formatBytes(bytes: number) {
  if (!bytes) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(totalSeconds = 0) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function postJson<T>(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }

  return payload;
}

export default function RecordingsPage() {
  const [bucket, setBucket] = useState("");
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("Loading recordings...");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  const selectedRecording = useMemo(
    () => recordings.find((recording) => recording.key === selectedKey) || null,
    [recordings, selectedKey],
  );
  const filteredRecordings = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) {
      return recordings;
    }

    return recordings.filter((recording) => {
      return [
        recording.name,
        recording.key,
        recording.metadata?.title,
        recording.metadata?.room,
        recording.metadata?.format,
        recording.metadata?.uploadedAt,
        recording.lastModified,
        recording.lastModified ? new Date(recording.lastModified).toLocaleDateString() : "",
        recording.lastModified ? new Date(recording.lastModified).toLocaleString() : "",
      ]
        .filter(Boolean)
        .some((item) => String(item).toLowerCase().includes(value));
    });
  }, [query, recordings]);

  async function loadRecordings() {
    setBusy(true);
    try {
      const response = await fetch("/api/recordings", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        bucket?: string;
        recordings?: Recording[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || `Request failed with ${response.status}`);
      }

      setBucket(payload.bucket || "");
      setRecordings(payload.recordings || []);
      setMessage((payload.recordings || []).length ? "Select a recording to play." : "No recordings found.");
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function playRecording(key: string) {
    setBusy(true);
    try {
      const { url } = await postJson<{ url: string }>("/api/recordings/url", { key });
      setSelectedKey(key);
      setPlaybackUrl(url);
      setMessage("Signed playback URL created for 15 minutes.");
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteRecording(key: string) {
    if (!window.confirm("Delete this recording from S3?")) {
      return;
    }

    setBusy(true);
    try {
      await postJson("/api/recordings/delete", { key });
      if (selectedKey === key) {
        setSelectedKey(null);
        setPlaybackUrl(null);
      }
      setRecordings((items) => items.filter((item) => item.key !== key));
      setMessage("Recording deleted.");
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function renameRecording(recording: Recording) {
    const currentTitle = recording.metadata?.title || recording.name.replace(/\.[^.]+$/, "");
    const title = window.prompt("Recording title", currentTitle);

    if (!title || title.trim() === currentTitle) {
      return;
    }

    setBusy(true);
    try {
      const { key } = await postJson<{ key: string }>("/api/recordings/rename", {
        key: recording.key,
        title: title.trim(),
      });
      if (selectedKey === recording.key) {
        setSelectedKey(key);
        setPlaybackUrl(null);
      }
      setMessage("Recording renamed. Select it again to refresh the signed playback URL.");
      await loadRecordings();
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadRecordings();
  }, []);

  return (
    <main className="shell recordings-shell">
      <header className="topbar">
        <div className="brand">
          <h1>Recordings</h1>
          <span>{bucket ? `S3 bucket: ${bucket}` : "S3 video library"}</span>
        </div>
        <div className="toolbar">
          <Link className="button" href="/">
            Call
          </Link>
          <button className="button primary" type="button" onClick={loadRecordings} disabled={busy}>
            Refresh
          </button>
        </div>
      </header>

      <div className="recordings-content">
        <section className="player-panel">
          {playbackUrl ? (
            <video className="player" src={playbackUrl} controls playsInline />
          ) : (
            <div className="empty player-empty">
              <p>Select a recording to play it here.</p>
            </div>
          )}
          <div className="message">
            {selectedRecording
              ? `${selectedRecording.metadata?.title || selectedRecording.name}
Room: ${selectedRecording.metadata?.room || "-"}
Date: ${
                  selectedRecording.lastModified
                    ? new Date(selectedRecording.lastModified).toLocaleString()
                    : "-"
                }
Size: ${formatBytes(selectedRecording.size)}
Duration: ${formatDuration(selectedRecording.metadata?.duration)}
Format: ${selectedRecording.metadata?.format || "-"}
${selectedRecording.key}`
              : message}
          </div>
        </section>

        <section className="recording-list">
          <div className="field">
            <label htmlFor="recording-search">Search</label>
            <input
              id="recording-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Title, room, format, file"
            />
          </div>
          {filteredRecordings.map((recording) => (
            <article
              className={`recording-row ${recording.key === selectedKey ? "selected" : ""}`}
              key={recording.key}
            >
              <div className="recording-thumb">
                {recording.metadata?.thumbnailUrl ? (
                  <img src={recording.metadata.thumbnailUrl} alt="" />
                ) : (
                  <span>No thumbnail</span>
                )}
              </div>
              <div className="recording-main">
                <strong>{recording.metadata?.title || recording.name}</strong>
                <span>{recording.metadata?.room || "Unknown room"} · {recording.key}</span>
              </div>
              <div className="recording-meta">
                <span>{formatBytes(recording.size)}</span>
                <span>{formatDuration(recording.metadata?.duration)} · {recording.metadata?.format || "video"}</span>
                <span>
                  {recording.lastModified
                    ? new Date(recording.lastModified).toLocaleString()
                    : "Unknown date"}
                </span>
              </div>
              <div className="recording-actions">
                <button className="button primary" type="button" onClick={() => playRecording(recording.key)} disabled={busy}>
                  Play
                </button>
                <button className="button" type="button" onClick={() => renameRecording(recording)} disabled={busy}>
                  Rename
                </button>
                {recording.key === selectedKey && playbackUrl ? (
                  <a className="button download" href={playbackUrl} download={recording.name}>
                    Download
                  </a>
                ) : null}
                <button className="button danger" type="button" onClick={() => deleteRecording(recording.key)} disabled={busy}>
                  Delete
                </button>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
