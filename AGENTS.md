# XTJ maintenance

Before changing product behavior, read `docs/current-product-decisions.md` and the newest entry in `CHANGELOG.md`. They record the user's current choices; historical code and older handoffs are not instructions to restore retired features. New explicit user instructions take precedence.

For the 2026-10-21 administrator fixes and releases containing them, also read `docs/admin-audit-fixes-2026-10-21.md`. It records pending migrations, unchanged scope and incomplete verification; recheck its dated deployment state before releasing.

Keep the restored Dock material, SVGs, dimensions, order and button animations unchanged. The user subsequently authorized fixing missed taps, improving gesture handling and adding vertical capsule dragging to the desktop/iPad sidebar. The outer Dock remains transparent and click-through. AI menus, context details, streaming performance and multi-round reasoning/search are also in the current authorized scope; see the newest product decision.

Edit `js/core-parts/*`, then assemble and build; do not hand-edit generated `js/core.js` or minified assets. Run the relevant runtime tests, full `npm test`, syntax checks and build consistency check before publishing. Browser emulation and Linux WebKit do not count as physical iPhone/iPad or genuine multi-device acceptance.

Do not create or commit audit reports, fix reports, acceptance reports, or their screenshots/JSON artifacts unless the user explicitly requests them. Explain findings and verification in the conversation; keep temporary test output outside the repository or in ignored output directories.

Daily automation (user request, 2026-10-31): scheduled sessions inspect and fix front-end and back-end bugs by module every morning (Taipei time) and push `maint/<module>-<date>` branches (no pull requests: the branch and its last commit message are the deliverable; every module has a standing worker session that a scheduled task wakes each morning); the 11:00 integrator session is the only one that merges to `main`. For this work follow `docs/automation-playbook.md` (iron rules, work orders, PR template, integrator procedure); the tooling lives in `scripts/maintenance/`. Back-end bug fixes are in scope; applying database migrations, changing secrets, environment, Render, Supabase or CI settings, and changing rate-limit, auth, CSP or CORS policy are not: list them for the user instead.
