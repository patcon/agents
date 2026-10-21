/**
 * Access tokens from a Google service account key, so a deployed Worker
 * isn't stuck with a token that lasts an hour.
 */

import { VoiceProviderError } from "agents/voice/errors";

/** The fields of a service account's JSON key that signing needs. */
export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  /** Sent as the JWT's `kid`, if present. */
  private_key_id?: string;
  /** Defaults to Google's token endpoint. */
  token_uri?: string;
}

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const TOKEN_URI = "https://oauth2.googleapis.com/token";
/** Fetch a new token this long before the old one expires. */
const REFRESH_EARLY_MS = 5 * 60_000;

type Cached = { token: string; expiresAt: number };
// Shared across calls, so every session in an isolate reuses one token.
const cache = new Map<string, Promise<Cached>>();

/**
 * Returns a function that gets an OAuth access token for a service account,
 * to pass as `accessToken`. It signs a JWT with the key and exchanges it at
 * Google's token endpoint, then reuses the token until 5 minutes before it
 * expires. The account needs a role that can call Vertex AI, such as
 * `roles/aiplatform.user`.
 *
 * @param key The JSON key, as downloaded or as its parsed object.
 */
export function serviceAccountToken(
  key: string | ServiceAccountKey
): () => Promise<string> {
  const parsed = parseKey(key);
  const id = `${parsed.client_email}:${parsed.private_key_id ?? ""}`;
  return async () => {
    const cached = cache.get(id);
    if (cached) {
      const value = await cached.catch(() => undefined);
      if (value && value.expiresAt - REFRESH_EARLY_MS > Date.now()) {
        return value.token;
      }
      // A failed or stale fetch is dropped, unless another call already
      // started a new one.
      if (cache.get(id) === cached) cache.delete(id);
    }
    let pending = cache.get(id);
    if (!pending) {
      pending = fetchToken(parsed);
      cache.set(id, pending);
    }
    return (await pending).token;
  };
}

function parseKey(key: string | ServiceAccountKey): ServiceAccountKey {
  let parsed: ServiceAccountKey;
  try {
    parsed = typeof key === "string" ? JSON.parse(key) : key;
  } catch {
    throw new VoiceProviderError("Service account key isn't valid JSON");
  }
  if (!parsed?.client_email || !parsed.private_key) {
    throw new VoiceProviderError(
      "Service account key needs client_email and private_key"
    );
  }
  return parsed;
}

async function fetchToken(key: ServiceAccountKey): Promise<Cached> {
  const tokenUri = key.token_uri ?? TOKEN_URI;
  const now = Math.floor(Date.now() / 1000);
  const assertion = await _signJwt(
    {
      alg: "RS256",
      typ: "JWT",
      ...(key.private_key_id && { kid: key.private_key_id })
    },
    {
      iss: key.client_email,
      scope: SCOPE,
      aud: tokenUri,
      iat: now,
      exp: now + 3600
    },
    key.private_key
  );
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  if (!res.ok) {
    // Google puts the reason, such as a deleted key, in the body.
    throw new VoiceProviderError(
      `Service account token exchange failed (${res.status}): ${await res.text()}`,
      { status: res.status }
    );
  }
  const body = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!body.access_token) {
    throw new VoiceProviderError("Token endpoint returned no access_token");
  }
  return {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000
  };
}

/** Signs a JWT with RS256, using a PKCS#8 PEM private key. */
export async function _signJwt(
  header: object,
  claims: object,
  privateKeyPem: string
): Promise<string> {
  const der = base64ToBytes(
    privateKeyPem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "")
  );
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const encoder = new TextEncoder();
  const input = `${base64Url(encoder.encode(JSON.stringify(header)))}.${base64Url(encoder.encode(JSON.stringify(claims)))}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    encoder.encode(input)
  );
  return `${input}.${base64Url(new Uint8Array(signature))}`;
}

/** Forgets cached tokens. For tests. */
export function _clearTokenCache(): void {
  cache.clear();
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
