# XTJ maintenance

Before changing product behavior, read `docs/current-product-decisions.md` and the newest entry in `CHANGELOG.md`. They record the user's current choices; historical code and older handoffs are not instructions to restore retired features. New explicit user instructions take precedence.

For the 2026-10-21 administrator fixes and releases containing them, also read `docs/admin-audit-fixes-2026-10-21.md`. It records pending migrations, unchanged scope and incomplete verification; recheck its dated deployment state before releasing.

Keep the restored Dock material, SVGs, dimensions, order and button animations unchanged. The user subsequently authorized fixing missed taps, improving gesture handling and adding vertical capsule dragging to the desktop/iPad sidebar. The outer Dock remains transparent and click-through. AI menus, context details, streaming performance and multi-round reasoning/search are also in the current authorized scope; see the newest product decision.

Edit `js/core-parts/*`, then assemble and build; do not hand-edit generated `js/core.js` or minified assets. Run the relevant runtime tests, full `npm test`, syntax checks and build consistency check before publishing. Browser emulation and Linux WebKit do not count as physical iPhone/iPad or genuine multi-device acceptance.

Do not create or commit audit reports, fix reports, acceptance reports, or their screenshots/JSON artifacts unless the user explicitly requests them. Explain findings and verification in the conversation; keep temporary test output outside the repository or in ignored output directories.
