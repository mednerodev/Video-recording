"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useState } from "react";

type BackblazeFile = {
  key: string;
  name: string;
  size: number;
  lastModified: string | null;
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

export default function BackblazePage() {
  const [bucket, setBucket] = useState("");
  const [prefix, setPrefix] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<BackblazeFile[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("Loading Backblaze files...");
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const filteredFiles = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) {
      return files;
    }

    return files.filter((file) => {
      return [file.name, file.key, file.lastModified, file.lastModified ? new Date(file.lastModified).toLocaleString() : ""]
        .filter(Boolean)
        .some((item) => String(item).toLowerCase().includes(value));
    });
  }, [files, query]);

  async function loadFiles(nextPrefix = prefix) {
    setBusy(true);
    try {
      const response = await fetch(`/api/s3/files?prefix=${encodeURIComponent(nextPrefix)}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        bucket?: string;
        prefix?: string;
        folders?: string[];
        files?: BackblazeFile[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || `Request failed with ${response.status}`);
      }

      setBucket(payload.bucket || "");
      setPrefix(payload.prefix || "");
      setFolders(payload.folders || []);
      setFiles(payload.files || []);
      setSelectedKeys(new Set());
        setMessage("Backblaze file list loaded.");
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function goUp() {
    const parts = prefix.split("/").filter(Boolean);
    parts.pop();
    loadFiles(parts.length ? `${parts.join("/")}/` : "");
  }

  function toggleSelected(key: string) {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function openFile(key: string) {
    try {
      const { url } = await postJson<{ url: string }>("/api/s3/url", { key });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  }

  async function deleteSelected() {
    const keys = Array.from(selectedKeys);
    if (!keys.length || !window.confirm(`Delete ${keys.length} file(s) from Backblaze?`)) {
      return;
    }

    setBusy(true);
    try {
      await postJson("/api/s3/delete", { keys });
      setMessage("Selected files deleted.");
      await loadFiles(prefix);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const uploadList = Array.from(event.target.files || []);
    event.target.value = "";

    if (!uploadList.length) {
      return;
    }

    uploadList.forEach((file) => {
      const formData = new FormData();
      formData.append("file", file, file.name);
      formData.append("prefix", prefix);

      const request = new XMLHttpRequest();
      request.open("POST", "/api/s3/upload");
      request.upload.onprogress = (progressEvent) => {
        if (progressEvent.lengthComputable) {
          setUploadProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
        }
      };
      request.onload = () => {
        setUploadProgress(100);
        setMessage(`${file.name} uploaded.`);
        loadFiles(prefix);
      };
      request.onerror = () => setMessage(`Upload failed for ${file.name}.`);
      request.send(formData);
    });
  }

  useEffect(() => {
    loadFiles("");
  }, []);

  return (
    <main className="shell recordings-shell">
      <header className="topbar">
        <div className="brand">
          <h1>Backblaze Manager</h1>
          <span>{bucket ? `${bucket}/${prefix}` : "Private Backblaze bucket file manager"}</span>
        </div>
        <div className="toolbar">
          <Link className="button" href="/">
            Call
          </Link>
          <Link className="button" href="/recordings">
            Recordings
          </Link>
          <button className="button primary" type="button" onClick={() => loadFiles(prefix)} disabled={busy}>
            Refresh
          </button>
        </div>
      </header>

      <div className="manager-layout">
        <section className="manager-actions">
          <div className="field">
            <label htmlFor="s3-search">Search files</label>
            <input
              id="s3-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="File, key, date"
            />
          </div>
          <div className="field">
            <label htmlFor="s3-upload">Upload files</label>
            <input id="s3-upload" type="file" multiple onChange={uploadFiles} disabled={busy} />
          </div>
          {uploadProgress > 0 ? (
            <div className="progress" aria-label="Upload progress">
              <span style={{ width: `${uploadProgress}%` }} />
              <strong>{uploadProgress}%</strong>
            </div>
          ) : null}
          <button className="button danger full" type="button" onClick={deleteSelected} disabled={!selectedKeys.size || busy}>
            Delete Selected
          </button>
          <div className="message">{message}</div>
        </section>

        <section className="manager-list">
          <div className="folder-row">
            <button className="button" type="button" onClick={goUp} disabled={!prefix || busy}>
              Up
            </button>
            {folders.map((folder) => (
              <button className="button folder-button" type="button" onClick={() => loadFiles(folder)} key={folder}>
                {folder.split("/").filter(Boolean).pop()}/
              </button>
            ))}
          </div>

          {!folders.length && !filteredFiles.length ? (
            <div className="empty manager-empty">
              <p>No folders or files found in this location.</p>
            </div>
          ) : null}

          {filteredFiles.map((file) => (
            <article className="file-row" key={file.key}>
              <label className="file-check">
                <input
                  type="checkbox"
                  checked={selectedKeys.has(file.key)}
                  onChange={() => toggleSelected(file.key)}
                />
              </label>
              <div className="recording-main">
                <strong>{file.name}</strong>
                <span>{file.key}</span>
              </div>
              <div className="recording-meta">
                <span>{formatBytes(file.size)}</span>
                <span>{file.lastModified ? new Date(file.lastModified).toLocaleString() : "Unknown date"}</span>
              </div>
              <div className="recording-actions">
                <button className="button primary" type="button" onClick={() => openFile(file.key)}>
                  Open
                </button>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
