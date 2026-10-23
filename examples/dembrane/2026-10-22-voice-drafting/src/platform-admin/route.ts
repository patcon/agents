// /platform-admin's one server route, apart from server.ts so it goes when
// the page does.

import { compilePlaybook } from "../compile/compile";
import compileSystem from "../compile/prompts/compile-playbook.md?raw";
import compileRetry from "../compile/prompts/compile-playbook-retry.md?raw";
import { generateJson } from "../models/gemini";

/**
 * /platform-admin's Compile button: compiles a playbook the way
 * `pnpm compile-playbook` does, and answers with what compilePlaybook() gave.
 */
async function compileForAdmin(request: Request, env: Env) {
  const { markdown } = await request.json<{ markdown: string }>();
  const started = Date.now();
  try {
    const compiled = await compilePlaybook(markdown, {
      name: "platform-admin",
      prompts: { system: compileSystem, retry: compileRetry },
      generate: (r) =>
        generateJson(env, {
          ...r,
          model: env.COMPILE_MODEL,
          thinkingLevel: env.COMPILE_THINKING
        })
    });
    return Response.json({ ...compiled, ms: Date.now() - started });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

/** The response for a /platform-admin request, or null for anything else. */
export function platformAdminRoute(request: Request, env: Env) {
  const { pathname } = new URL(request.url);
  if (request.method === "POST" && pathname === "/api/compile-playbook") {
    return compileForAdmin(request, env);
  }
  return null;
}
