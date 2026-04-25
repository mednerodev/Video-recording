import { S3Client } from "@aws-sdk/client-s3";

export function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

export function getS3Bucket() {
  return getRequiredEnv("AWS_BUCKET");
}

export function getS3Client() {
  return new S3Client({
    region: getRequiredEnv("AWS_DEFAULT_REGION"),
    credentials: {
      accessKeyId: getRequiredEnv("AWS_ACCESS_KEY_ID"),
      secretAccessKey: getRequiredEnv("AWS_SECRET_ACCESS_KEY"),
    },
  });
}

export function safeName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}
