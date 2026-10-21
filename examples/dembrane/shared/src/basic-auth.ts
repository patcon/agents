/**
 * Puts a Worker behind a single shared password when the
 * `BASIC_AUTH_PASSWORD` secret is set, and leaves it open when it isn't.
 *
 * Wrap the Worker's default export so every request is checked, including
 * the `/agents/*` WebSocket, and set `"run_worker_first": true` in
 * wrangler.jsonc so the page itself is checked too and the browser shows
 * its password prompt.
 *
 * @example
 * export default withBasicAuth({
 *   async fetch(request, env) { ... }
 * } satisfies ExportedHandler<Env>);
 */
export function withBasicAuth<E>(
  handler: ExportedHandler<E>
): ExportedHandler<E> {
  return {
    ...handler,
    async fetch(request, env, ctx) {
      const password = (env as { BASIC_AUTH_PASSWORD?: string })
        .BASIC_AUTH_PASSWORD;
      if (password && !(await authorized(request, password))) {
        return new Response("Unauthorized", {
          status: 401,
          headers: { "WWW-Authenticate": 'Basic realm="app", charset="UTF-8"' }
        });
      }
      if (!handler.fetch) {
        return new Response("Not found", { status: 404 });
      }
      return handler.fetch(request, env, ctx);
    }
  };
}

async function authorized(request: Request, password: string) {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Basic ")) return false;
  let supplied: string;
  try {
    // The username is ignored; everything after the first ":" is the password
    supplied = atob(header.slice(6)).split(":").slice(1).join(":");
  } catch {
    return false;
  }
  // Hash both so the lengths match, then compare every byte so the time taken
  // doesn't reveal how much of the password was right. (Workers'
  // crypto.subtle.timingSafeEqual isn't typed when an app also loads DOM types.)
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all(
    [supplied, password].map(
      async (s) =>
        new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(s)))
    )
  );
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
