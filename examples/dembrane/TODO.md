# TODO

Ideas not yet worth an RFC. Each might not be done at all.

## A `/platform-admin` page for editing a playbook

In a prototype like [`2026-10-22-playbook-compilation`](2026-10-22-playbook-compilation): a page where the playbook's markdown can be edited and recompiled into a plan with `compilePlaybook()`. It would show the diff against the current plan, with `comparePlans()` for what a session would do differently and a JSON diff for everything else, before the new plan replaces the old one.

Not sure yet that it's worth building.
