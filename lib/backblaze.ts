import crypto from "crypto";

export type B2File = {
  fileId: string;
  fileName: string;
  contentLength: number;
  contentType?: string;
  uploadTimestamp?: number;
  fileInfo?: Record<string, string>;
};

type B2Auth = {
  accountId: string;
  authorizationToken: string;
  apiUrl: string;
  downloadUrl: string;
};

type B2AuthorizeResponse = {
  accountId: string;
  authorizationToken: string;
  apiUrl?: string;
  downloadUrl?: string;
  apiInfo?: {
    storageApi?: {
      apiUrl?: string;
      downloadUrl?: string;
    };
  };
  message?: string;
};

type B2Bucket = {
  bucketId: string;
  bucketName: string;
};

let authCache: B2Auth | null = null;
let bucketCache: B2Bucket | null = null;

export function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

export function getStorageBucketName() {
  return getRequiredEnv("BACKBLAZE_BUCKET");
}

export function safeName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

function encodeB2HeaderValue(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => {
    return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
  });
}

function safeFileInfoName(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 50);
}

async function b2Request<T>(
  path: string,
  body: Record<string, unknown>,
  auth = authCache,
) {
  if (!auth) {
    auth = await authorizeBackblaze();
  }

  const response = await fetch(`${auth.apiUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: auth.authorizationToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    message?: string;
    code?: string;
  };

  if (!response.ok) {
    throw new Error(payload.message || payload.code || `Backblaze request failed with ${response.status}`);
  }

  return payload;
}

export async function authorizeBackblaze(): Promise<B2Auth> {
  if (authCache) {
    return authCache;
  }

  const credentials = Buffer.from(
    `${getRequiredEnv("BACKBLAZE_KEY_ID")}:${getRequiredEnv("BACKBLAZE_APPLICATION_KEY")}`,
  ).toString("base64");
  const response = await fetch("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", {
    headers: {
      Authorization: `Basic ${credentials}`,
    },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as B2AuthorizeResponse;

  if (!response.ok) {
    throw new Error(payload.message || "Unable to authorize Backblaze account.");
  }

  const apiUrl = payload.apiUrl || payload.apiInfo?.storageApi?.apiUrl;
  const downloadUrl = payload.downloadUrl || payload.apiInfo?.storageApi?.downloadUrl;

  if (!apiUrl || !downloadUrl) {
    throw new Error("Backblaze authorization response did not include API URLs.");
  }

  authCache = {
    accountId: payload.accountId,
    authorizationToken: payload.authorizationToken,
    apiUrl,
    downloadUrl,
  };
  return authCache;
}

export async function getBackblazeBucket() {
  if (bucketCache) {
    return bucketCache;
  }

  const auth = await authorizeBackblaze();
  const response = await b2Request<{ buckets: B2Bucket[] }>("/b2api/v3/b2_list_buckets", {
    accountId: auth.accountId,
    bucketName: getStorageBucketName(),
  }, auth);
  const bucket = response.buckets[0];

  if (!bucket) {
    throw new Error(`Backblaze bucket ${getStorageBucketName()} was not found.`);
  }

  bucketCache = bucket;
  return bucket;
}

export async function listBackblazeFiles(prefix = "") {
  const bucket = await getBackblazeBucket();
  const files: B2File[] = [];
  let startFileName: string | undefined;

  do {
    const response = await b2Request<{ files: B2File[]; nextFileName?: string }>(
      "/b2api/v3/b2_list_file_names",
      {
        bucketId: bucket.bucketId,
        prefix,
        startFileName,
        maxFileCount: 1000,
      },
    );
    files.push(...response.files);
    startFileName = response.nextFileName;
  } while (startFileName && files.length < 5000);

  return files;
}

export async function findBackblazeFile(fileName: string) {
  const bucket = await getBackblazeBucket();
  const response = await b2Request<{ files: B2File[] }>("/b2api/v3/b2_list_file_names", {
    bucketId: bucket.bucketId,
    prefix: fileName,
    startFileName: fileName,
    maxFileCount: 1,
  });

  return response.files.find((file) => file.fileName === fileName) || null;
}

export async function uploadBackblazeFile({
  key,
  body,
  contentType,
  fileInfo,
}: {
  key: string;
  body: Buffer;
  contentType: string;
  fileInfo?: Record<string, string>;
}) {
  const bucket = await getBackblazeBucket();
  const upload = await b2Request<{ uploadUrl: string; authorizationToken: string }>(
    "/b2api/v3/b2_get_upload_url",
    { bucketId: bucket.bucketId },
  );
  const sha1 = crypto.createHash("sha1").update(body).digest("hex");
  const headers: Record<string, string> = {
    Authorization: upload.authorizationToken,
    "X-Bz-File-Name": encodeB2HeaderValue(key),
    "Content-Type": contentType,
    "Content-Length": String(body.length),
    "X-Bz-Content-Sha1": sha1,
  };

  Object.entries(fileInfo || {}).forEach(([name, value]) => {
    if (!value) {
      return;
    }
    const safeInfoName = safeFileInfoName(name);
    if (!safeInfoName) {
      return;
    }
    headers[`X-Bz-Info-${safeInfoName}`] = encodeB2HeaderValue(String(value));
  });

  const response = await fetch(upload.uploadUrl, {
    method: "POST",
    headers,
    body: body as unknown as BodyInit,
  });
  const payload = (await response.json().catch(() => ({}))) as B2File & {
    message?: string;
  };

  if (!response.ok) {
    throw new Error(payload.message || "Unable to upload file to Backblaze.");
  }

  return payload;
}

export async function getBackblazeDownloadUrl(fileName: string, durationSeconds = 900) {
  const auth = await authorizeBackblaze();
  const bucket = await getBackblazeBucket();
  const response = await b2Request<{ authorizationToken: string }>(
    "/b2api/v3/b2_get_download_authorization",
    {
      bucketId: bucket.bucketId,
      fileNamePrefix: fileName,
      validDurationInSeconds: durationSeconds,
    },
  );

  return `${auth.downloadUrl}/file/${bucket.bucketName}/${fileName
    .split("/")
    .map(encodeURIComponent)
    .join("/")}?Authorization=${encodeURIComponent(response.authorizationToken)}`;
}

export async function downloadBackblazeFile(fileName: string) {
  const url = await getBackblazeDownloadUrl(fileName);
  const response = await fetch(url, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Unable to download Backblaze file: HTTP ${response.status}`);
  }

  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

export async function deleteBackblazeFiles(fileNames: string[]) {
  const deleted: string[] = [];

  for (const fileName of fileNames) {
    const file = await findBackblazeFile(fileName);
    if (!file) {
      continue;
    }

    await b2Request("/b2api/v3/b2_delete_file_version", {
      fileName: file.fileName,
      fileId: file.fileId,
    });
    deleted.push(file.fileName);
  }

  return deleted;
}

export async function copyBackblazeFile({
  sourceName,
  destinationName,
  contentType,
  fileInfo,
}: {
  sourceName: string;
  destinationName: string;
  contentType?: string;
  fileInfo?: Record<string, string>;
}) {
  const source = await findBackblazeFile(sourceName);
  if (!source) {
    throw new Error("Source file was not found.");
  }

  const downloaded = await downloadBackblazeFile(sourceName);

  return uploadBackblazeFile({
    key: destinationName,
    body: downloaded.body,
    contentType: contentType || source.contentType || downloaded.contentType,
    fileInfo: fileInfo || source.fileInfo || {},
  });
}
