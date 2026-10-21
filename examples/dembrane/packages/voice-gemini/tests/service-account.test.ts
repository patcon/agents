import { afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  _clearTokenCache,
  _signJwt,
  serviceAccountToken
} from "../src/service-account";

let keyPair: CryptoKeyPair;
let pem: string;

beforeAll(async () => {
  keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  );
  const der = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", keyPair.privateKey)
  );
  const base64 = btoa(String.fromCharCode(...der));
  pem = `-----BEGIN PRIVATE KEY-----\n${base64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
});

afterEach(() => {
  _clearTokenCache();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const key = () => ({
  client_email: "sa@test-project.iam.gserviceaccount.com",
  private_key: pem,
  private_key_id: "key-1"
});

const fromBase64Url = (part: string) =>
  Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0)
  );

function stubTokenEndpoint(...tokens: string[]) {
  const fetchMock = vi.fn(async () => {
    const token = tokens.shift() ?? "no-more-tokens";
    return Response.json({ access_token: token, expires_in: 3600 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("signs a JWT that verifies with the public key", async () => {
  const jwt = await _signJwt({ alg: "RS256" }, { iss: "me" }, pem);
  const [header, claims, signature] = jwt.split(".");
  expect(JSON.parse(new TextDecoder().decode(fromBase64Url(claims)))).toEqual({
    iss: "me"
  });
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    keyPair.publicKey,
    fromBase64Url(signature),
    new TextEncoder().encode(`${header}.${claims}`)
  );
  expect(valid).toBe(true);
});

it("exchanges a JWT for a token with the cloud-platform scope", async () => {
  const fetchMock = stubTokenEndpoint("token-1");
  expect(await serviceAccountToken(JSON.stringify(key()))()).toBe("token-1");

  const [url, init] = fetchMock.mock.calls[0] as unknown as [
    string,
    RequestInit
  ];
  expect(url).toBe("https://oauth2.googleapis.com/token");
  const body = init.body as URLSearchParams;
  expect(body.get("grant_type")).toBe(
    "urn:ietf:params:oauth:grant-type:jwt-bearer"
  );
  const [header, claims] = body
    .get("assertion")!
    .split(".")
    .slice(0, 2)
    .map((part) => JSON.parse(new TextDecoder().decode(fromBase64Url(part))));
  expect(header).toEqual({ alg: "RS256", typ: "JWT", kid: "key-1" });
  expect(claims).toMatchObject({
    iss: "sa@test-project.iam.gserviceaccount.com",
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token"
  });
  expect(claims.exp - claims.iat).toBe(3600);
});

it("reuses the token until 5 minutes before it expires", async () => {
  vi.useFakeTimers();
  const fetchMock = stubTokenEndpoint("token-1", "token-2");
  const getToken = serviceAccountToken(key());

  expect(await Promise.all([getToken(), getToken()])).toEqual([
    "token-1",
    "token-1"
  ]);
  // Another function for the same key shares the cache
  expect(await serviceAccountToken(key())()).toBe("token-1");
  expect(fetchMock).toHaveBeenCalledTimes(1);

  vi.advanceTimersByTime(54 * 60_000);
  expect(await getToken()).toBe("token-1");
  vi.advanceTimersByTime(2 * 60_000);
  expect(await getToken()).toBe("token-2");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("tries again after a failed exchange, with Google's reason", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response("invalid_grant", { status: 400 }))
      .mockResolvedValueOnce(Response.json({ access_token: "token-1" }))
  );
  const getToken = serviceAccountToken(key());
  await expect(getToken()).rejects.toThrow(/400.*invalid_grant/);
  expect(await getToken()).toBe("token-1");
});

it("rejects a key without client_email or private_key", () => {
  expect(() => serviceAccountToken("not json")).toThrow(/valid JSON/);
  expect(() => serviceAccountToken('{"client_email":"x"}')).toThrow(
    /private_key/
  );
});
