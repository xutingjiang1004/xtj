# XTJ maintenance

Before changing product behavior, read `docs/current-product-decisions.md` and the newest entry in `CHANGELOG.md`. They record the user's current choices; historical code and older handoffs are not instructions to restore retired features. New explicit user instructions take precedence.

For the 2026-10-21 administrator fixes and releases containing them, also read `docs/admin-audit-fixes-2026-10-21.md`. It records pending migrations, unchanged scope and incomplete verification; recheck its dated deployment state before releasing.

Keep the five Dock entries, their order, SVGs, dimensions, button animations and navigation business logic unchanged. On 2026-10-25 the user explicitly authorized upgrading the selected capsule's material and drag feedback; see the newest Dock section in `docs/current-product-decisions.md`. The outer Dock must remain fully transparent and click-through, with only the actual buttons receiving touches. This authorization does not extend to redesigning other pages.

Edit `js/core-parts/*`, then assemble and build; do not hand-edit generated `js/core.js` or minified assets. Run the relevant runtime tests, full `npm test`, syntax checks and build consistency check before publishing. Browser emulation and Linux WebKit do not count as physical iPhone/iPad or genuine multi-device acceptance.

Do not create or commit audit reports, fix reports, acceptance reports, or their screenshots/JSON artifacts unless the user explicitly requests them. Explain findings and verification in the conversation; keep temporary test output outside the repository or in ignored output directories.
