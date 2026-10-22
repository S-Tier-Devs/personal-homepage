import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { getSpacesCredentials } from "@/lib/env";

/**
 * S3-compatible client for DigitalOcean Spaces. Bucket is a PARAMETER on
 * every call so migration Phase 2 can point this same module at a private
 * Documents bucket (spec §Media). deleteObject deliberately does not exist
 * yet — nothing in v1 deletes objects.
 */

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!client) {
    const { key, secret, region } = getSpacesCredentials();

    client = new S3Client({
      // Spaces ignores the AWS region but the SDK requires one; the real
      // routing is the endpoint.
      region: "us-east-1",
      endpoint: `https://${region}.digitaloceanspaces.com`,
      credentials: { accessKeyId: key, secretAccessKey: secret },
    });
  }

  return client;
}

export async function putPublicObject(options: {
  bucket: string;
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: options.bucket,
      Key: options.key,
      Body: options.body,
      ContentType: options.contentType,
      ACL: "public-read",
      // Keys embed a UUID, so objects are immutable by construction.
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
}

export function publicUrl(cdnUrl: string, key: string): string {
  return `${cdnUrl.replace(/\/+$/, "")}/${key}`;
}
