# W10-002 — Scene loading and cache policy

Date: 2026-11-25 (Asia/Jakarta)

The production homepage loads the canonical Moon City nine-plane scene, not the wider scene universe. It defers two runtime chunks (8,629 encoded bytes) and nine environment vectors (6,118 bytes) until motion is allowed. Reduced-motion and Save-Data stay on the static hero and one idle frame (1,431 bytes), alongside the static hero itself (359,616 bytes desktop / 214,252 bytes mobile). Unrelated Signals/Archive specimens and the UI Catalog's lazy SceneLab chunk were not requested. Later idle frames remain clip-driven instead of being preloaded as a universe-wide sprite sheet.

Static environment SVGs, animation SVGs and the two stable-name hero variants now receive `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`. The bounded one-hour freshness matches stable public paths without asserting immutable content.

Verification: the `W10-001` production measurement harness observed the new cache header on every environment, animation and static hero response; it recorded initial and motion-enabled transfer sets at desktop and mobile emulation. Production build exits 0. No whole-universe preload or prefetch was added.
