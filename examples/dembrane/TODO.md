# TODO

Ideas not yet worth an RFC. Each might not be done at all.

## ~~A `/platform-admin` page for editing a playbook~~

~~In a prototype like [`2026-10-22-playbook-compilation`](2026-10-22-playbook-compilation): a page where the playbook's markdown can be edited and recompiled into a plan with `compilePlaybook()`. It would show the diff against the current plan, with `comparePlans()` for what a session would do differently and a JSON diff for everything else, before the new plan replaces the old one.~~

~~Not sure yet that it's worth building.~~

Built as a throwaway in [`2026-10-22-playbook-compilation`](2026-10-22-playbook-compilation) (`src/platform-admin.tsx`), so a demo doesn't need `pnpm compile-playbook`. The plan it swaps in is kept in the browser's localStorage and passed to `open()`, so it only applies to new sessions in that browser.

## Remove `/platform-admin`

It's only for demos. Remove `src/platform-admin.tsx` and `src/platform-admin-plan.ts`, the `/api/compile-playbook` route and `open()`'s `plan` argument in `src/server.ts`, its imports and two uses in `src/client.tsx`, and `react` and `react-dom` in `vite.config.ts`'s `dedupe` if nothing else needs them by then.
