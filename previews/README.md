# ArkFlame DRM v0.5.4 visual fixtures

The HTML preview fixtures use illustrative sample records (documentation-only IP ranges). Screenshots are rendered from these static fixtures using headless Chromium (via Playwright), not from a running Next.js/Tailwind/React application. Layout rules are manually matched to the source; visual correspondence is approximate. Actual browser acceptance tests remain outstanding.

- `overview-1440.png`: desktop overview and flat chart readouts.
- `overview-390.png`: mobile overview, chart, and compact metrics.
- `nodes-390.png`: mobile flagged-node listing, now separated rows inside one glass panel.
- `node-detail-1440.png`: desktop node details and plugin filename review signals.

## Evaluation

v0.5.2 had bordered, filled mobile explorer cards nested inside a second bordered glass panel. The chart and fleet-health sections also repeated the same boxed surface treatment for their internal statistics. v0.5.3 keeps glass at the primary panel level. Internal groups use a single divider, improving information density, maintaining touch spacing, and keeping the suspicious-plugin count visible.

Visual verification must be repeated in an installed Next.js build on mobile Safari/Chromium and desktop browsers before production shipping. The included PNGs are reference previews, not live runtime proof.

## v0.5.4 visual review

Topbar auto-refresh text is unboxed, the refresh action has no visible border or inset card, and the A settings link uses one flat circular surface. The mobile toolbar retains accessible refresh and account controls instead of hiding refresh. These fixtures copy source-matched control sizes, spacing and colors but use illustrative data; they are not proof of Next.js browser compilation.
