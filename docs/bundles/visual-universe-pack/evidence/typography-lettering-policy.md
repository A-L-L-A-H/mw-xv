# Typography and lettering policy

- Product copy, labels, status, captions, buttons and dynamic content remain accessible live text.
- Use existing package fonts: Anton for compact display moments; Space Grotesk for interface/body; JetBrains Mono for compact metadata; Road Rage as decorative lettering only where appropriate. Preserve system fallbacks and avoid text baked into scene layers.
- Decorative lettering in artwork is optional, separate from UI content, and must use a font with verified license or original hand lettering. Avoid franchise-like logotypes and recognizable copyrighted marks.
- The existing `packages/assets/licenses.json` is provenance source of truth; it records font sources, upstream license text, file paths and hashes. Do not duplicate font inventories or edit derived font files without updating the existing generator/provenance.
- Maintain tested text contrast and legibility at responsive crops. Never use brush/display type for paragraphs, dense data, or critical instructions.
