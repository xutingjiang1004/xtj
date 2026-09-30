# XTJ maintenance

Before changing product behavior, read `docs/current-product-decisions.md` and the newest entry in `CHANGELOG.md`. They record the user's current choices; historical code and older handoffs are not instructions to restore retired features. New explicit user instructions take precedence.

Keep the bottom Dock buttons, capsule, dimensions and animations unchanged. The independently completed transparent, click-through outer area remains in place.

Edit `js/core-parts/*`, then assemble and build; do not hand-edit generated `js/core.js` or minified assets. Run the relevant runtime tests, full `npm test`, syntax checks and build consistency check before publishing. Browser emulation and Linux WebKit do not count as physical iPhone/iPad or genuine multi-device acceptance.
