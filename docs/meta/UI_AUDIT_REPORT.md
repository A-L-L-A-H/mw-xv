# UI Audit Report — MoonWitness XI

**Tanggal:** 2026-11-23  
**Scope:** `packages/ui`, `apps/board`, `apps/docs`, `apps/ui-catalog`, gate/CI UI, dan toolchain Node.

## Ringkasan eksekutif

| Metrik                                 | Sebelum                                                     | Sesudah                          |
| -------------------------------------- | ----------------------------------------------------------- | -------------------------------- |
| Temuan design-system (`pnpm ui:check`) | 161 debt (97 hardcoded color, 62 override, 2 literal token) | **0**                            |
| Baseline debt                          | 161 entri                                                   | **0 entri / 0 stale**            |
| `pnpm ui:design:audit` (strict)        | gagal karena debt                                           | **lolos, 0 temuan**              |
| Warning `pnpm lint:ui`                 | 18–21                                                       | **0**                            |
| `pnpm test:ui`                         | 76/76                                                       | **80/80** (4 test perilaku baru) |
| Node                                   | campuran 22/24                                              | **24.22.3 (24.x) di semua gate** |

Semua gate UI sekarang hijau, termasuk mode strict yang sebelumnya memang sengaja gagal sampai utang lama dibersihkan.

## Temuan awal yang mendasari perbaikan

**Kritis**

1. Duplikasi CSS di `apps/board/src/index.css` (`.ink-panel`, `.sticker`, `.press`, `.dashboard-raw-card`) yang melewati komponen bersama.
2. Chalk-mask SVG diduplikasi di tiga lokasi dengan nilai stroke berbeda.
3. Hex color hardcoded di CSS/JSX board.
4. ~1.128 Tailwind utility disusun manual untuk pola yang sudah disediakan package UI.

**High**

- Dialog memakai tiga paradigma styling sekaligus (CSS package + Tailwind + CSS-in-JS).
- `cn()` tidak dipakai konsisten.
- Alias token tiga level (`--color-paper → --paper → --mw-paper`).
- `prefers-reduced-motion` diduplikasi di empat tempat.
- Dark mode tidak membedakan border/input/focus.
- Beberapa stylesheet memakai alias token, bukan token utama `--mw-*`.

**Coverage & visual**

- 11 subpath komponen tidak pernah di-import oleh board; komponen lokal tumbuh parallel.
- Komponen yang belum ada di package: Sidebar/Nav, Card generik, Breadcrumb, Progress bar, RadioGroup, Accordion, FileUpload.
- Decorative density terlalu tinggi untuk dashboard operasional.
- Focus ring tidak konsisten (3 warna, 2 lebar).
- `--mw-surface-muted` direferensikan tanpa deklarasi.

## Perbaikan yang sudah diterapkan

### Design system & aksesibilitas

- Hook bersama `useModalFocus` (`@moonwitness/ui/lib/use-modal-focus`): focus trap, Escape dismissal, body-scroll lock, focus restore. Dipakai `ModePicker` dan empat dialog aksi WhatsApp.
- `SmartButtonBox` memakai Radix `DropdownMenu` sehingga aksi sekunder dapat dijangkau keyboard.
- Perbaikan state/a11y: `DatePicker`, `NumberInput`, `TagInput`, `CharacterPreview`, `ComicSceneTransition`, `LogConsole`, `Button asChild disabled`, `Field`.
- Layer overlay terpusat pada `--mw-layer-dialog` / `--mw-layer-popover`; literal `z-50`/`z-index` dihapus.
- Token ditambah/diperbaiki: `--mw-font-size-2xs`, `--mw-font-condensed`, `--mw-avatar-size`, outline dark mode, shadow token, typo `--mw-spacing-2`, focus ring docs, dan `--mw-surface-muted` → `--mw-muted`.
- Import board yang mengarah ke komponen tidak ada diganti `EmptyState` bersama.

### Gate, scanner, dan baseline debt

- `scripts/check-ui-design-system.mjs` kini menolak token `--mw-*` yang salah meski punya fallback, composite shadow token pada slot warna, dan menolak undefined `--mw-*`.
- Aturan `shared-style-override` diperketak menjadi **hanya selector global** `.mw-ui-*`. Override yang dilingkupi kelas app (mis. `.home-page .mw-ui-button`) adalah theming yang didukung, bukan utang.
- 97 hex color di `apps/docs/src/styles.css` dikonversi menjadi token semantik app-local (`--docs-page-bg`, `--docs-topbar-text`, `--docs-nav-link-hover-bg`, dll.), bukan alias acak hasil generasi.
- 2 redefinisi literal token shared di `apps/ui-catalog/src/styles.css` diganti alias app-local (`--catalog-font-display`, `--catalog-font-sans`); variabel grid yang sebelumnya self-referential (`var(--catalog-grid-a)`) diberi nilai nyata.
- Baseline `scripts/ui-design-system.baseline.json` dikosongkan karena tidak ada lagi temuan yang tersisa.

### Kualitas kode dan test

- 18 warning `oxlint` dibersihkan: helper non-komponen dipindah ke modul tersendiri (`paas-template-data.ts`, `skin-context.ts`, `field-widget-registry.ts`), clock read dipindah dari render, state-set di effect ditunda via `queueMicrotask`, helper mati dihapus, dan import unused dibersihkan.
- `packages/ui/tests/use-modal-focus.test.mjs` baru: 4 test perilaku dengan jsdom + React `act` — focus awal & scroll lock, Tab/Shift+Tab trap dengan pengecualian `aria-hidden`, Escape dismissal, dan fallback container tanpa elemen fokus.
- `jsdom` ditambahkan sebagai devDependency root.
- Toolchain diselaraskan ke Node 24.22.3 (`pnpm-workspace.yaml`, checker parity, template runtime `node:24-alpine`, dokumentasi aktif).

## Validasi final

Dijalankan dengan Node v24.22.3:

- `pnpm ui:check` — 0 finding, 0 new/structural, 0 known debt, 0 stale.
- `pnpm ui:design:audit` — strict mode lolos, 0 finding.
- `pnpm test:ui` — 80/80 lulus, termasuk verify-package.
- `pnpm lint:ui` — 0 warning, 0 error (154 file).
- `pnpm --filter @moonwitness/board typecheck` — lulus.
- `pnpm node:parity --strict` — lulus.
- `pnpm exec prettier --check` pada file yang diubah — lulus.

## Catatan tersisa

- Import coverage adalah statis: board 37/48 subpath, ui-catalog 37/48, docs hanya 1/48. Ini bukan kegagalan, tapi docs masih belum banyak mengonsumsi komponen package.
- Token warna docs sekarang semantik dan app-local, bukan token shared `--mw-*`. Ini disengaja karena palet docs (hijau/cream) berbeda dari palet inti (kuning/paper); perubahan ke token shared akan mengubah identitas visual.
- Gate memeriksa definsi token secara global, bukan scope runtime selector.
- Perubahan non-UI yang sedang berjalan di working tree (API, ORM, infra, docs generated) tidak termasuk dalam audit ini dan sengaja tidak disentuh.
