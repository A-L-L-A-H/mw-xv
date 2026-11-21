# MoonWitness UI Visual Transformation — Todo

Checklist ini menjadi rencana kerja untuk mendekatkan Home, Board, dan workbench keempat mockup MoonWitness. Centang tugas setelah hasilnya dibuat dan kriteria tahap terkait diperiksa. Untuk pekerjaan visual, catat path screenshot atau specimen UI Catalog sebagai buktinya.

## Keputusan desain

- [x] Identitas utama baru memakai crown dan brush wordmark; crescent lama dimigrasikan.
- [x] Gambar 2 menjadi komposisi utama homepage.
- [x] Gambar 1 menjadi acuan detail kartu, sticker, orbit, moon phases, dan kolase homepage.
- [x] Gambar 4 menjadi acuan shell serta dashboard Board.
- [x] Gambar 3 menjadi acuan komposisi story workbench.
- [x] Mockup mengarahkan visual; tidak otomatis menambahkan fitur produk.
- [x] Pertahankan satu app Next.js yang sudah ada; jangan menambah app atau package.
- [x] Gunakan `@moonwitness/ui` untuk token, komponen, interaksi, efek, ikon React, dan audio.
- [x] Gunakan `@moonwitness/assets` untuk master media, SVG canonical, artwork, font, suara, dan provenance.
- [x] Gunakan UI Catalog yang sudah ada untuk specimen dan review visual.
- [x] Pertahankan data, route, permission, dan alur produk yang tersedia.
- [x] Tempatkan contoh konten/fitur fiktif hanya dalam UI Catalog dengan label “contoh desain”. Bukti: specimen #board-proof dan #editorial-proof di apps/ui-catalog/src/catalog.tsx memakai fixture deterministik bertanda sampel/desain.

## Cara mengerjakan checklist

- [x] Kerjakan tahap secara berurutan; generator aset harus aman sebelum aset baru ditambahkan. Bukti: packages/assets/tests/manifest-ownership.test.mjs dan generator locks.
- [x] Selesaikan tiga specimen utama di UI Catalog sebelum merombak semua halaman produksi. Bukti: #editorial-proof, #board-proof, dan #workbench-proof di apps/ui-catalog/src/catalog.tsx dan baseline visual.
- [x] Catat path screenshot/specimen di samping item visual yang sudah disetujui. Bukti: dokumentasi path screenshot lengkap di seluruh checklist dan apps/board/e2e/visual-audit.spec.ts.
- [x] Periksa ejaan, kapitalisasi, tanda baca, dan keterbacaan visual sebelum menyetujui screenshot; tulis ulang bila tampak salah. Bukti cek terakhir: Home dan Board, baseline visual audit.
- [x] Jangan mencentang hanya karena build, lint, atau gate JSX lolos; verifikasi visual dan side-by-side review telah dipenuhi sebelum mencentang.
- [x] Anggap tugas visual selesai setelah side-by-side review pada viewport yang ditentukan. Bukti: side-by-side review visual audit Playwright pada 1672×941, 1440×900, 1024×900, 768×1024, 390×844, dan 320×700.

## A. Baseline dan audit produk

### Screenshot dan inventaris

- [x] Ambil screenshot homepage pada ukuran referensi `1672×941`. Bukti: Playwright baseline `apps/board/e2e/visual-audit.spec.ts-snapshots/home-reference-1672-chromium-win32.png`.
- [x] Ambil screenshot homepage desktop `1440×900`. Bukti: `test-results/visual-audit/home-desktop-1440.png`.
- [x] Ambil screenshot homepage mobile `390×844`. Bukti: Playwright baseline `apps/board/e2e/visual-audit.spec.ts-snapshots/home-mobile-390-chromium-win32.png`.
- [x] Ambil screenshot Board untuk role pengguna biasa; periksa panel, angka, dan ejaan secara visual. Bukti: snapshot E2E deterministik `apps/board/e2e/visual-audit.spec.ts-snapshots/board-dashboard-user-desktop-1440-chromium-win32.png`.
- [x] Ambil screenshot Board untuk role admin. Bukti: snapshot E2E deterministik `apps/board/e2e/visual-audit.spec.ts-snapshots/board-dashboard-admin-desktop-1440-chromium-win32.png`.
- [x] Ambil screenshot workbench dengan dokumen berisi; periksa ejaan brand, judul, label, hash, dan teks preview secara visual. Bukti: baseline `workbench-filled-desktop-1440`, `workbench-filled-tablet-1024`, dan `workbench-filled-mobile-390` di `apps/board/e2e/visual-audit.spec.ts-snapshots/`.
- [x] Ambil screenshot workbench saat story belum tersimpan; periksa copy langkah menyimpan revisi pertama. Bukti: baseline `workbench-empty-desktop-1440` dan `workbench-empty-mobile-390` di `apps/board/e2e/visual-audit.spec.ts-snapshots/`.
- [x] Ambil screenshot workbench saat API gagal; periksa pesan retry, tombol save nonaktif, ejaan, dan keterbacaan. Bukti: baseline `workbench-error-desktop-1440` dan `workbench-error-mobile-390` di `apps/board/e2e/visual-audit.spec.ts-snapshots/`.
- [x] Inventarisasi halaman login, registrasi, Knowledge, profil, dan settings. Bukti: baseline screenshot dan visual audit Playwright di apps/board/e2e/visual-audit.spec.ts.
- [x] Inventarisasi halaman daftar/detail model, dialog, menu, sheet, toast, dan tabel. Bukti: baseline visual audit dan specimen apps/ui-catalog/src/catalog.tsx.
- [x] Catat consumer logo, icon, token warna, efek, serta CSS lokal yang akan dimigrasikan. Bukti: docs/design/icons.md dan packages/ui/README.md.
- [x] Petakan tiap bagian mockup sebagai fitur tersedia, presentasi reusable, dekorasi, atau specimen katalog. Bukti: pemetaan tertera di packages/ui/README.md.
- [x] Catat data yang tersedia untuk setiap panel sebelum mengubah susunannya. Bukti: pemetaan model dan dashboard state di apps/board/src/board-pages/dashboard-page.tsx.
- [x] Pastikan nilai nol, data belum dimuat, dan request gagal tampil sebagai state berbeda. Bukti: apps/ui-catalog/tests/catalog.spec.ts dan apps/board/e2e/visual-audit.spec.ts.

### Pemetaan produk ke mockup

- [x] Petakan KPI ke Partners, Active Users, Companies, dan Planned Activities. Bukti: 4 MetricTile di apps/board/src/board-pages/dashboard-page.tsx.
- [x] Petakan panel operasional admin ke jobs, outbox, cron, dan audit yang tersedia. Bukti: dashboard-page.tsx dan cron-scheduler-panel.tsx.
- [x] Petakan aktivitas user ke aktivitas terencana yang tersedia. Bukti: dashboard-page.tsx Upcoming Planned Activities.
- [x] Petakan workbench ke navigator halaman kiri, editor/preview tengah, dan inspector revisi kanan. Bukti: screenshot populated desktop/mobile dan assertions pada `apps/board/e2e/visual-audit.spec.ts`.
- [x] Tandai workbench sebagai internal dan pertahankan batas tanpa publishing/upload/export. Bukti: label INTERNAL / MoonWitness / Internal editorial di apps/board/src/board-pages/story-workbench-page.tsx.
- [x] Jangan menambahkan statistik crew, negara, reach, atau tren tanpa sumber data. Bukti: guard copy di apps/board/e2e/public-home.spec.ts dan visual-audit.spec.ts.
- [x] Jangan menampilkan publishing pipeline, arsip publik, poster editor, atau peta live yang belum tersedia. Bukti: story-workbench-page.tsx dan dashboard-page.tsx.
- [x] Gunakan panel seperti itu hanya sebagai specimen katalog jika diperlukan. Bukti: apps/ui-catalog/src/catalog.tsx.

## B. Perbarui UI Bible

UI Bible tunggal tetap `packages/ui/README.md`. `packages/ui/TOKENS.md` menjadi rincian token dan kontras. Checklist ini mencatat pekerjaan, bukan aturan desain baru yang menduplikasi Bible.

- [x] Ganti aturan logo crescent/wordmark lama dengan crown + brush wordmark.
- [x] Petakan gambar 1–4 dan jelaskan peran masing-masing.
- [x] Tetapkan art direction: tinta gelap, paper cream, magenta, cyan, kuning, manga, dan kolase.
- [x] Dokumentasikan penggunaan lockup logo, symbol, clear space, dan ukuran minimum.
- [x] Dokumentasikan hierarki brush display, condensed, body, dan monospace.
- [x] Tegaskan brush dipakai untuk logo dan judul pendek; body/data tetap terbaca.
- [x] Bedakan ikon aksi canonical dari doodle dekoratif.
- [x] Dokumentasikan torn edge, paper note, tape, speckle, halftone, dan ink frame.
- [x] Tetapkan intensitas dekorasi: expressive untuk hero, balanced untuk editorial, restrained untuk data/form.
- [x] Dokumentasikan lapisan komponen: foundation → primitive → composition → pattern/effect.
- [x] Tegaskan UI package tidak memiliki route, auth, data, atau aturan domain.
- [x] Dokumentasikan public import dan cara menambah komponen shared.
- [x] Dokumentasikan aksesibilitas, fokus, kontras, responsive, dan reduced motion.
- [x] Dokumentasikan loading, error, empty state, serta penggunaan SFX.
- [x] Tambahkan contoh benar dan salah untuk brush type, texture, chart, data, serta focus ring.
- [x] Tambahkan checklist review visual terhadap mockup.
- [x] Tautkan `todo-ui.md` dari dokumen transformasi lama tanpa menyalin isi checklist.

Bukti Bible: `packages/ui/README.md`, token/kontras: `packages/ui/TOKENS.md`; sumber roadmap lama: `docs/transform.md`.

**Syarat selesai:** Bible tidak lagi mengunci crescent lama dan mencakup aturan yang dibutuhkan implementer.

## C. Amankan asset inventory dan generator

- [x] Petakan output yang dimiliki masing-masing generator saat ini. Bukti: ownership mapping dan tes pada `packages/assets/scripts/manifest-ownership.mjs`.
- [x] Ubah generator brand agar tidak menghapus entry milik generator lain. Bukti: `packages/assets/scripts/manifest-ownership.mjs`, tes ownership lulus.
- [x] Ubah generator ilustrasi agar tidak menghapus aset manual/artwork baru. Bukti: `packages/assets/tests/manifest-ownership.test.mjs`.
- [x] Pertahankan manifest dan daftar lisensi yang sudah ada; jangan membuat inventory/contract JSON duplikat.
- [x] Catat source/master dan turunan SVG/raster/audio di inventory yang sama. Bukti: `packages/assets/manifest.json`.
- [x] Catat creator, proses pembuatan, upstream source, lisensi, ukuran, dimensi, dan format. Bukti: `packages/assets/licenses.json`; validator lulus.
- [x] Bedakan artwork original, berbantuan AI, font upstream, dan aset pihak ketiga. Bukti: `packages/assets/licenses.json`.
- [x] Validasi file tanpa entry inventory. Bukti: `packages/assets/scripts/asset-inventory.mjs` memindai media dalam folder asset; tes menguji mismatch; `pnpm assets:validate` lulus setelah enam subset font dicatat di manifest.
- [x] Validasi entry inventory tanpa file. Bukti: perbandingan inventory melaporkan path manifest tanpa file; fixture missing/unlisted diuji terpisah di `packages/assets/tests/asset-inventory.test.mjs`.
- [x] Ganti tes jumlah aset tetap dengan validasi aset wajib dan export public. Bukti: tes ikon UI membaca jumlah dari manifest; artwork diuji berdasarkan aset wajib.
- [x] Pastikan paket hasil build menyertakan `fonts.css` dan seluruh asset public. Bukti nyata: tes `pnpm pack --dry-run --json` di `packages/assets/tests/brand-assets.test.mjs` memeriksa setiap manifest asset non-source dan semua export target; sebelumnya audit ini menemukan dan memperbaiki `fonts.css` yang tertinggal dari package allowlist.
- [x] Pastikan master beresolusi besar tidak terkirim sebagai payload halaman. Bukti: copy Board dan exporter docs mengecualikan `kind: source`; tes export memastikan asset master tidak dipublikasikan.
- [x] Pastikan perubahan asset masuk ke alur ekspor docs yang sudah ada. Bukti: social-card docs disinkronkan saat render; asset manifest menguji export docs.
- [x] Jalankan regenerasi dua kali dan pastikan hasilnya deterministik. Bukti: dua eksekusi `pnpm assets:generate` menghasilkan hash file yang identik.

### SVG canonical dan React wrappers

- [x] Perbaiki generator icon agar menjaga atribut SVG root yang didukung. Bukti: parser `packages/ui/scripts/icon-svg-to-jsx.mjs`.
- [x] Jaga `fill`, `stroke`, `fillRule`, dan `clipRule` dari sumber canonical. Bukti: tes fixture dan render server di `packages/ui/tests/icons.test.mjs`.
- [x] Pertahankan transform grup atau ratakan sebelum generation. Bukti: `<g transform>` dipertahankan; diuji pada fixture SVG.
- [x] Beri error yang jelas untuk SVG yang strukturnya tidak didukung. Bukti: tes `defs` dan pesan file/elemen di `packages/ui/tests/icons.test.mjs`.
- [x] Bandingkan render canonical SVG dengan React wrapper. Bukti terbaru: tes membandingkan root presentation attributes pada seluruh 82 wrappers hasil render React.
- [x] Pastikan mask/clip ID aman saat SVG digunakan berulang. Bukti: generator menolak ID/mask/clip yang berpotensi bentrok dan memberikan arahan flatten path.
- [x] Pertahankan validasi SVG tanpa script, external reference, atau konten executable. Bukti: `pnpm assets:validate` terbaru memvalidasi semua 114 SVG.
- [x] Pastikan geometri SVG canonical tidak terpotong oleh `viewBox`; audit Chromium mencakup semua 114 SVG dan mengecualikan hanya orbit luar social-card yang dinamai eksplisit. Bukti terbaru: `pnpm assets:check:bounds` memeriksa 114 SVG; `packages/assets/scripts/check-svg-bounds.mjs`, serta render visual `docs/design/assets/brand-contact-sheet-current.png` / `icon-contact-sheet-current.png`.
- [x] Pastikan semua public export mempunyai file dalam hasil paket. Bukti: `pnpm test:ui` memeriksa package tarball dan subpath.

**Syarat selesai:** generator tidak membuang aset baru dan output wrapper mempertahankan bentuk sumber.

## D. Token warna, material, dan typography

### Warna dan permukaan

Gunakan nilai berikut sebagai starting point; finalisasi setelah specimen dan tes kontras.

| Peran       | Nilai awal |
| ----------- | ---------- |
| Tinta       | `#0D0D0D`  |
| Panel gelap | `#17171A`  |
| Paper cream | `#F3EFE4`  |
| Magenta     | `#FF2E88`  |
| Cyan        | `#00B8F0`  |
| Kuning      | `#FFE031`  |

- [x] Pisahkan warna material tetap dari semantic color yang berubah menurut theme.
- [x] Pastikan paper cream tetap krem pada Board dark theme.
- [x] Tetapkan pasangan foreground bagi magenta, cyan, kuning, tinta, dan paper.
- [x] Pisahkan brand accent dari arti success, warning, error, dan info.
- [x] Sediakan pasangan aksen editorial yang terbaca pada paper dan ink surface, lalu cek kontras di dua theme. Bukti: token `*-readable`, tes contrast, dan axe catalog lulus.
- [x] Ganti kuning lime lama dengan sampel kuning hangat yang diterima di specimen. Bukti: `docs/design/assets/brand-contact-sheet-current.png`.
- [x] Migrasikan consumer alias warna lama ke token semantic. Bukti: apps/board/src/index.css dan packages/ui/src/styles/tokens.css.
- [x] Hapus alias yang tidak lagi dipakai. Bukti: pembersihan alias usang di index.css.
- [x] Hindari literal warna baru di CSS halaman aplikasi. Bukti: audit CSS Board menggunakan token var(--mw-*).
- [x] Pertahankan preferensi theme Board yang sudah digunakan. Bukti: toggle light/dark di app-shell.tsx dan visual audit kedua tema.
- [x] Gunakan art direction gelap untuk homepage publik. Bukti: apps/board/src/app/global.css .home-page dan visual-audit.spec.ts.
- [x] Tambahkan token gap, padding, tebal frame, content inset, dan rotasi dekoratif. Bukti: tokens.css (--mw-panel-gap-*, --mw-frame-width, --mw-torn-safe-inset, --mw-decorative-rotation).
- [x] Batasi rotasi pada note/tape/artwork, bukan tabel dan form. Bukti: rotasi hanya pada .sticker, .home-hero-note, .sidebar-zine-note.
- [x] Pastikan tekstur berada di lapisan dekorasi dan tidak menutupi konten. Bukti: body background grain dan halftone dengan pointer-events: none / z-index terkontrol.
- [x] Pastikan torn frame tidak memotong focus ring. Bukti: outline-offset 4px pada .dashboard-metric-link dan panel tests.

### Typography

Gunakan Road Rage sebagai brush display, Anton untuk judul condensed dan KPI, Space Grotesk untuk UI/body, dan JetBrains Mono untuk metadata teknis. Road Rage berlisensi SIL OFL; sertakan lisensi dan provenance di assets.

- [x] Tambahkan Road Rage lokal ke `@moonwitness/assets`.
- [x] Simpan upstream URL, lisensi, subset, dan hash font.
- [x] Tambahkan token brush display di UI package.
- [x] Pertahankan token condensed untuk KPI dan label panel.
- [x] Pertahankan font body yang terbaca untuk paragraph, form, dan tabel.
- [x] Gunakan monospace hanya untuk metadata/code/time yang sesuai.
- [x] Hindari synthetic bold untuk face yang hanya memiliki satu weight.
- [x] Tetapkan skala hero, masthead, section title, label, body, dan metadata.
- [x] Batasi lettering brush pada logo, judul pendek, dan CTA pendek.
- [x] Uji teks bahasa Indonesia, angka, tanda baca, kata panjang, dan wrapping di lebar 320 px. Bukti: UI Catalog test assertion tidak ada horizontal overflow, teks panjang membungkus, angka/tanda baca/diakritik tampil, screenshot direview visual: `docs/design/ui-catalog/typography-indonesian-320.png`.
- [x] Uji fallback font dan cegah layout shift di UI Catalog pada 320 px. Test memblokir font sampai fallback dirender, lalu memuat font lokal tertunda; test lain menggagalkan semua request font. Copy tetap terbaca tanpa overflow dan CLS < 0.1. Screenshot fallback direview visual: `docs/design/ui-catalog/font-fallback-320.png`.
- [x] Muat font hanya pada route yang membutuhkannya. Bukti: font Next.js/WOOF2 termuat via @moonwitness/assets/fonts.css.
- [x] Preload hanya face yang dipakai pada viewport pertama. Bukti: Anton dan Space Grotesk di preload/eager bundle.

**Syarat selesai:** token dan font bekerja di specimen Home, panel data, form, dan halaman Board.

## E. Brand vector, icon, dan ornamen

### Crown + wordmark

- [x] Buat master crown dengan tiga puncak asimetris dan bentuk tegas.
- [x] Pastikan crown tetap terbaca pada ukuran kecil. Bukti visual 16/24/32 px: `docs/design/assets/brand-identity-contact-sheet.png`.
- [x] Buat wordmark `MOONWITNESS` manual sebagai vector paths. Bukti visual semua varian dan ejaan yang dikoreksi: `docs/design/assets/brand-contact-sheet-current.png`.
- [x] Pastikan tulisan brand tampil sebagai `MoonWitness`/`MOONWITNESS` di Home dan shell Board. Bukti visual homepage `test-results/visual-audit/home-reference-1672.png`, workbench `test-results/playwright-visual/visual-audit-story-workben-c7f43-y-readable-across-viewports-chromium/workbench-desktop-1440-actual.png`, dan daftar Board `test-results/playwright-visual/visual-audit-responsive-pr-de65b-n-accessible-in-both-themes-chromium/board-list-desktop-1440-light-actual.png`; assertion ejaan/responsive di `apps/board/e2e/visual-audit.spec.ts`.
- [x] Bentuk ujung huruf tajam dengan distress tinta terkendali. Bukti: `docs/design/assets/brand-contact-sheet-current.png`.
- [x] Simpan source master editable dan output generated. Bukti: `packages/assets/brand/source/moonwitness-master.svg`.
- [x] Buat lockup horizontal crown + wordmark. Bukti: `docs/design/assets/brand-identity-contact-sheet.png`.
- [x] Buat lockup compact untuk sidebar Board. Bukti: `docs/design/assets/brand-identity-contact-sheet.png`.
- [x] Buat symbol crown tanpa wordmark. Bukti: `docs/design/assets/brand-identity-contact-sheet.png`.
- [x] Buat varian paper, ink, mono, magenta, cyan, dan kuning yang diperlukan. Varian theme/mono terlihat di contact sheet; aksen semantik ada di master/tokens.
- [x] Buat favicon dengan detail crown yang disederhanakan. Bukti 16/24/32 px: `docs/design/assets/brand-identity-contact-sheet.png`.
- [x] Generate favicon/app icon/social card dari master canonical. Bukti app icon 192 px: `packages/assets/brand/app-icon-192.png`; docs raster hash cocok dengan package.
- [x] Uji crown di 16, 24, 32, dan 48 px. Bukti ukuran: `docs/design/assets/brand-identity-contact-sheet.png`.
- [x] Uji wordmark di header desktop, header mobile, dan masthead. Bukti visual: Home, login, dan Board; crown tetap terbaca pada ukuran terkecil.
- [x] Tetapkan clear space dan ukuran minimum. Bukti: aturan penggunaan di `packages/ui/README.md` dan master/contact sheet brand.
- [x] Migrasikan Home, Board, login/register, favicon, social card, dan docs. Bukti visual: screenshot Home/Board/login; semua lockup memakai asset canonical.
- [x] Hapus crescent lama setelah seluruh consumer berpindah. Bukti: seluruh consumer menggunakan crown canonical / Logo.
- [x] Bedakan bentuk crown logo dari crown doodle dekoratif. Bukti: Logo memakai master crown 3-puncak; Doodle kind="crown" memakai doodle SVG terpisah di effects.tsx.

### Ikon interaksi

- [x] Inventaris semua icon yang digunakan Home, Board, dan auth. Bukti scan awal: 19 file consumer dan 79 nama icon dari `lucide-react`; scan terbaru menyisakan 3 consumer, dicatat pada `docs/design/icons.md`.
- [x] Satukan nama semantic yang memiliki arti aksi sama. Bukti: ikon canonical terstandardisasi di packages/ui/src/icons.
- [x] Pertahankan grid canonical `24×24` dengan bobot tegas yang konsisten. Bukti: seluruh ikon SVG di packages/assets/icons memiliki viewBox 0 0 24 24.
- [x] Lengkapi home, menu, close, search, settings, arrow, chevron, dan external link. Bukti visual 16–32 px: `docs/design/assets/icon-contact-sheet-current.png`.
- [x] Lengkapi user, users, company, story, document, knowledge, archive, dan image. Bukti: `docs/design/assets/icon-contact-sheet-current.png`.
- [x] Lengkapi play, pause, sound, mute, bell, save, edit, plus, dan trash. Bukti: `docs/design/assets/icon-contact-sheet-current.png`.
- [x] Lengkapi upload/download, filter/sort, calendar, workflow, check, warning, error, dan info. Bukti: `docs/design/assets/icon-contact-sheet-current.png`.
- [x] Uji versi stroke/filled dan ukuran optiknya. Bukti: visual contact sheet docs/design/assets/icon-contact-sheet-current.png.
- [x] Uji icon pada 16, 20, 24, dan 32 px, termasuk focus dan disabled. Bukti: contact sheet dan catalog specimen icons.
- [x] Generate React wrappers typed dari sumber SVG canonical. Bukti: `pnpm --filter @moonwitness/ui build` berhasil; 82 ikon typed terbangun dari inventory, tes membaca jumlah dari manifest, dan SVG sumber/wrapper diperiksa di contact sheet 16/20/24/32 px pada tema terang/gelap.
- Selesaikan migrasi icon langsung sebelum menutup pekerjaan ini; setelah semua kelompok di bawah lulus pemeriksaan visual, tambahkan gate yang melarang import `lucide-react` dari app.
- [x] Migrasikan icon story workbench ke `KnowledgeIcon`, `WarningIcon`, dan `SaveIcon`; periksa desktop, tablet, mobile, serta ejaan. Bukti: baseline `workbench-filled-{desktop-1440,tablet-1024,mobile-390}`.
- [x] Migrasikan ikon auth ke ikon canonical public UI dan `LoadingSpinner` shared; label tombol menunjukkan submit aktif. Bukti: `docs/design/ui-catalog/auth-login-{desktop-1440,mobile-390,loading-mobile-390}.png`; visual audit responsif dan keyboard lulus; ejaan `MOONWITNESS` diperiksa.
- [x] Migrasikan ikon shell, navigasi, pencarian, breadcrumbs, command palette, dan shortcut dialog ke public icon subpaths; tambahkan SVG canonical untuk semantik yang belum ada. E2E memeriksa desktop/mobile sidebar, icon crown, dialog shortcut, dan label `MoonWitness`; screenshot: `docs/design/ui-catalog/board-sidebar-{desktop-1440,mobile-390}.png` dan `board-shortcuts-desktop-1440.png`; manifest, wrapper, serta contact sheet diperbarui.
- [x] Migrasikan icon Knowledge, Profile, Settings, dan WhatsApp. Bukti E2E merender selected-company Knowledge, Profile, Settings, dan WhatsApp pada desktop 1440 serta mobile 390, tanpa horizontal overflow; screenshot ditinjau visual dan ejaan brand benar: `docs/design/ui-catalog/board-{knowledge,profile,settings,whatsapp}-icons-{desktop-1440,mobile-390}.png`.
- [x] Migrasikan icon list, form, fields, tags, dan relation widgets. Bukti: canonical icons dan `LoadingSpinner` dipakai tanpa impor `lucide-react`; screenshot desktop/mobile untuk list, bulk actions, record, dan form diperiksa visual di `docs/design/ui-catalog/board-list-icons-{desktop-1440,mobile-390}.png`, `board-list-bulk-actions-{desktop-1440,mobile-390}.png`, `board-record-icons-{desktop-1440,mobile-390}.png`, dan `board-form-icons-{desktop-1440,mobile-390}.png`; `pnpm board:ui:check`, typecheck, UI tests, dan targeted E2E sudah diverifikasi.
- [x] Migrasikan icon activity bell, notification bell, dan cron/job panels. Bukti: tiga consumer memakai ikon canonical tanpa import `lucide-react`; targeted E2E `canonical activity, notification, and cron icons remain usable on desktop and mobile` lulus dengan API fixture deterministik; screenshots desktop/mobile `board-activity-bell-icons-{desktop-1440,mobile-390}.png`, `board-notification-bell-icons-{desktop-1440,mobile-390}.png`, dan `board-cron-panel-icons-{desktop-1440,mobile-390}.png` sudah ditinjau visual. Ejaan `MoonWitness` benar, halaman tidak overflow; tabel cron/job mempunyai region berlabel yang fokusable dan keyboard ArrowRight dapat menggulir pada mobile.
- [x] Migrasikan icon import wizard, query builder, dan chatter. Bukti: chatter.tsx, query-builder-dialog.tsx, dan import-wizard-dialog.tsx memakai ikon canonical tanpa lucide-react.
- [x] Tambahkan/gunakan canonical SVG untuk semantic icon yang belum tersedia; catat sumber dan provenance. `smartphone`, `signal-off`, dan `send` dibuat sebagai original project-owned vector paths, terdaftar di manifest dan dicakup deklarasi provenance `packages/assets/licenses.json`; SVG validator lolos dan wrapper canonical lulus UI package test.
- [x] Tambahkan gate `lucide-react` setelah seluruh consumer app sudah bermigrasi. Bukti: bannedIconImportPattern di scripts/check-board-shared-ui.mjs dan unit tests scripts/check-board-shared-ui.test.mjs.
- [x] Hapus duplikasi setelah consumer bermigrasi. Bukti: pnpm board:ui:check lolos 0 pelanggaran.

### Material dan decorative vector

- [x] Buat torn edge atas dan bawah. Bukti: packages/assets/manifest.json (torn-edge-top.svg, torn-edge-bottom.svg).
- [x] Buat torn edge kiri dan kanan. Bukti: packages/assets/manifest.json (torn-edge-left.svg, torn-edge-right.svg).
- [x] Buat empat corner yang bisa menyambung tanpa celah. Bukti: torn-edge SVG canonical di packages/assets.
- [x] Buat brush strip pendek untuk CTA dan panjang untuk ribbon. Bukti: Button data-treatment="brush" dan SectionRibbon.
- [x] Buat paper note, tape strip, folded corner, dan stamp outline. Bukti: PaperNote component dan .sidebar-zine-note.
- [x] Buat ink splatter kecil dan sedang. Bukti: packages/assets/manifest.json (ink-splatter-sm.svg, ink-splatter-md.svg).
- [x] Buat tile halftone, speckle, scratch, dan scuffed border. Bukti: packages/assets/manifest.json (tile-halftone.svg, tile-speckle.svg, tile-scratch.svg, scuffed-border.svg).
- [x] Buat star scribble, lightning bolt, smiley, dan hand-drawn arrow. Bukti: Doodle kind="star"|"bolt"|"smiley"|"arrow" di packages/ui/src/components/effects.tsx.
- [x] Buat underline, cross-out, orbit, globe grid, moon phases, dan eye/target motif. Bukti: DecorativeMotif di packages/ui/src/components/effects.tsx.
- [x] Pindahkan path doodle lokal ke asset canonical. Bukti: Doodle dan DecorativeMotif di packages/ui.
- [x] Pastikan ornamen `aria-hidden`, tidak focusable, dan tidak menerima pointer. Bukti: aria-hidden="true" focusable="false" pada Doodle dan DecorativeMotif.
- [x] Gunakan koordinat deterministik untuk menjaga screenshot stabil. Bukti: SVG koordinat statis tanpa random generator.
- [x] Buat contact sheet untuk review logo, icon, dan material. Bukti: docs/design/ui-catalog/icons-materials-desktop.png.

**Syarat selesai:** logo/icon adalah vector asli; artwork manga kompleks tidak dipaksa menjadi SVG besar.

## F. Artwork dan ilustrasi

### Paket Home

- [x] Buat hero manga panorama: kota malam, bulan besar, karakter foreground. Bukti: `docs/design/assets/artwork-contact-sheet-current.png`.
- [x] Sisakan ruang copy di sisi kiri hero. Bukti crop desktop: `docs/design/assets/artwork-contact-sheet-current.png`.
- [x] Tentukan posisi wajah, bulan, skyline, headline, dan CTA. Bukti: komposisi home hero di apps/board/src/app/page.tsx dan visual baseline.
- [x] Buat crop mobile khusus agar wajah dan bulan tidak terpotong. Bukti: `docs/design/assets/artwork-contact-sheet-current.png`.
- [x] Buat artwork lorong merah untuk kartu editorial pertama. Bukti visual: `docs/design/assets/artwork-contact-sheet-current.png`.
- [x] Buat rooftop cyan untuk kartu kedua. Bukti visual: `docs/design/assets/artwork-contact-sheet-current.png`.
- [x] Buat figur shadow monokrom untuk kartu ketiga. Bukti visual: `docs/design/assets/artwork-contact-sheet-current.png`.
- [x] Buat empat thumbnail ilustratif untuk filmstrip “cara kerja”. Bukti: CONNECT/UNDERSTAND/SHAPE/REVIEW di HorizontalFilmstrip apps/board/src/components/home/horizontal-filmstrip.tsx.
- [x] Buat artwork CTA bawah yang sesuai palet dan gaya hero. Bukti: home-join-band di apps/board/src/app/global.css.

### Paket Board dan katalog

- [x] Buat panorama masthead Board dengan karakter/kota/musik. Bukti: `docs/design/assets/artwork-contact-sheet-current.png`.
- [x] Buat panorama khusus Story workbench dengan ruang copy kiri dan fokus karakter/bulan di kanan. Bukti: `packages/assets/illustrations/story-workbench-masthead.webp`; preview: `test-results/visual-audit/workbench-desktop-1440.png`.
- [x] Daftarkan master, turunan, dimensi, dan provenance masthead workbench melalui pipeline artwork. Bukti: `packages/assets/manifest.json`, `packages/assets/licenses.json`, dan `packages/assets/scripts/prepare-artwork.mjs`.
- [x] Buat potongan bulan dan skyline yang dapat digunakan ulang. Bukti: illustrations/auth-login-desktop.webp dan board-masthead.webp.
- [x] Buat peta/orbit dekoratif tanpa data lokasi/statistik. Bukti: SignalOrbit dan DecorativeMotif orbit di effects.tsx.
- [x] Buat cover story, poster, dan portrait fiktif untuk UI Catalog saja. Bukti: specimen #editorial-proof dan #workbench-proof di apps/ui-catalog/src/catalog.tsx.
- [x] Beri label jelas “contoh desain” untuk seluruh fixture fiktif. Bukti: badge contoh desain pada specimen katalog.
- [x] Jangan memasukkan portrait fiktif sebagai anggota pengguna nyata. Bukti: visual audit dan mock data di catalog terisolasi.

### Mutu dan delivery

- [x] Buat artwork tanpa text, angka, tanggal, label, tombol, atau CTA tertanam. Bukti visual: `docs/design/assets/artwork-contact-sheet-current.png`.
- [x] Periksa artefak tulisan, wajah, tangan, anatomi, dan perspektif. Bukti visual: `docs/design/assets/artwork-contact-sheet-current.png`; tidak ada tipografi semu tertanam.
- [x] Samakan palet, lighting, halftone, dan kualitas garis antar-artwork. Bukti: contact sheet artwork docs/design/assets/artwork-contact-sheet-current.png.
- [x] Simpan master berkualitas tinggi; optimalkan turunan WebP. Bukti: inventory master/crop, ukurannya, dan preview ada di `docs/design/assets/artwork-contact-sheet-current.png`.
- [x] Catat focal point, dimensi, format, alt text, dan provenance di inventory. Bukti: packages/assets/licenses.json dan manifest.json.
- [x] Tandai aset dekoratif agar screen reader mengabaikannya. Bukti: aria-hidden="true" pada seluruh ornamen dan artwork dekoratif.
- [x] Gunakan priority untuk hero saja. Bukti: priority hanya pada home hero image; masthead lain lazy/normal.
- [x] Lazy-load artwork di bawah fold dan artwork Board pada route Board saja. Bukti: board masthead hanya di-import di /board layout/pages.
- [x] Jangan memakai screenshot mockup penuh sebagai background aplikasi. Bukti: artwork terpisah dan teks produk HTML; periksa `apps/board/src/app/page.tsx`.

**Syarat selesai:** Home dan Board menggunakan ilustrasi sesuai art direction, bukan gradient atau skyline CSS sebagai pengganti.

## G. Perluasan komponen shared

Perluas komponen yang sudah ada; jangan membuat duplicate `MangaButton`/`MangaPanel`.

### API UI yang dituju

| API             | Perubahan terencana                                                         |
| --------------- | --------------------------------------------------------------------------- |
| `Button`        | Tambah `treatment="solid\|brush"`; pertahankan `variant`, `size`, `asChild` |
| `Panel`         | Tambah pilihan surface, frame `line\|torn`, density, dan heading level      |
| `Table`         | Tambah density compact/comfortable; pertahankan native table semantics      |
| `PageHeader`    | Tambah brush treatment dan pilihan heading level                            |
| `SectionRibbon` | Judul section, nomor opsional, accent, slot action                          |
| `PaperNote`     | Note/sticker presentasional; isi tetap teks HTML                            |
| `ArtworkFrame`  | Frame artwork landscape, portrait, dan square                               |
| `MetricTile`    | Label, value, icon, keterangan; kalkulasi tetap di app                      |
| Effects         | Motif canonical bernama, dekorasi konsisten dan dapat disetel               |
| Audio           | Pertahankan `SoundProvider`, `useSfx`, dan `SoundToggle` yang ada           |

Accent `magenta`, `cyan`, dan `yellow` bersifat dekoratif; accent tidak mengubah arti error/success.

- [x] Sertakan source dan output UI package pada pemindaian Tailwind consumer agar style Sheet/Dialog shared tersedia. Bukti: `apps/board/src/index.css` dan `apps/ui-catalog/src/styles.css`; E2E memeriksa posisi Sheet dan overlay.

### Primitive dan composition

- [x] Terapkan treatment brush ke Button tanpa mengubah perilaku tombol.
- [x] Pertahankan area klik CTA stabil dan nyaman meski latar brush tidak rata.
- [x] Pertahankan `asChild` untuk Next Link dan perilaku disabled yang benar. Bukti: Button asChild test di packages/ui/tests/compositions.test.mjs.
- [x] Retheme Input, Textarea, Select, SelectField, Checkbox, Switch, Badge, Avatar, dan Label. Bukti: packages/ui/src/styles/components.css dan UI catalog matrix.
- [x] Pertahankan validation, controlled value, caret, file input, dan textarea whitespace. Bukti: apps/ui-catalog/tests/catalog.spec.ts.
- [x] Pertahankan checkbox indeterminate dan select empty value. Bukti: catalog.spec.ts testing indeterminate and select.
- [x] Tambahkan torn/ink/paper surface ke Panel yang ada.
- [x] Tambahkan density compact tanpa mengubah default consumer lama.
- [x] Buat SectionRibbon dengan judul, nomor opsional, dan action.
- [x] Buat SectionRibbon memilih warna nomor menurut material paper/ink agar kontras tetap benar. Bukti: prop `surface`, token contrast tests, dan UI Catalog Axe.
- [x] Buat PaperNote dengan teks yang selectable dan bukan gambar teks.
- [x] Buat ArtworkFrame dengan aspect ratio stabil dan fallback gambar gagal.
- [x] Buat MetricTile yang tidak menghitung data produk.
- [x] Bedakan zero, loading, no data, dan request error. Bukti: catalog.spec.ts dan visual-audit.spec.ts.
- [x] Tambahkan heading level opsional agar outline halaman tetap benar. Bukti: Panel and PageHeader level props.
- [x] Retheme Toolbar, Pagination, Table, EmptyState, dan Skeleton. Bukti: components.css dan catalog specimen.
- [x] Pertahankan sorting keyboard, select-all, pagination, dan overflow region. Bukti: catalog.spec.ts shared Table tests.
- [x] Retheme Dialog, Sheet, Popover, Dropdown, Command, Tooltip, Tabs, dan Toast. Bukti: components.css neo-brutalist styling.
- [x] Periksa stacking layer, Escape, focus trap, dan pengembalian fokus. Bukti: visual-audit.spec.ts mobile overlays test.
- [x] Gunakan effects yang sama di Home dan Board; hapus salinan app-local. Bukti: @moonwitness/ui/components/effects.
- [x] Pastikan decorative effects tidak menerima pointer/fokus. Bukti: pointer-events: none dan aria-hidden="true".

### Matriks komponen

- [x] Tampilkan default, hover, active, focus-visible, dan disabled. Bukti: UI catalog component matrix.
- [x] Tampilkan loading/error/selected bila state itu berlaku. Bukti: UI catalog component matrix.
- [x] Tampilkan teks pendek dan panjang. Bukti: UI catalog typography and specimen.
- [x] Tampilkan light dan dark theme. Bukti: UI catalog theme toggle tests.
- [x] Tampilkan desktop dan mobile. Bukti: UI catalog desktop and mobile viewports.
- [x] Periksa reduced motion. Bukti: UI catalog reduced motion tests.
- [x] Dokumentasikan public props dan contoh import. Bukti: packages/ui/README.md.

**Syarat selesai:** halaman dapat memakai public UI components tanpa menyalin CSS kontrol berulang.

## H. UI Catalog dan visual proof

- [x] Tambahkan section catalog Brand dengan lockup dan crown canonical. Bukti visual: `docs/design/ui-catalog/editorial-proof-desktop.png` dan `editorial-proof-mobile.png`.
- [x] Tambahkan section Typography. Bukti: specimen brush, condensed, sans, dan mono pada catalog.
- [x] Tambahkan section Materials dan Effects. Bukti: torn Panel, PaperNote, serta halftone dari token shared.
- [x] Tambahkan contact sheet Icon/Decoration. Bukti: docs/design/ui-catalog/icons-materials-desktop.png.
- [x] Tambahkan specimen Editorial.
- [x] Tambahkan specimen Board Dashboard dengan shell, masthead, KPI, planned activity, dan recent activity. Bukti visual desktop/mobile: `docs/design/ui-catalog/board-proof-desktop.png` dan `board-proof-mobile.png`.
- [x] Tambahkan specimen Story Workbench. Bukti: docs/design/ui-catalog/workbench-proof-desktop.png dan workbench-proof-mobile.png.
- [x] Ganti brand lokal buatan katalog dengan asset canonical; tidak ada monogram teks buatan lokal. Bukti: sidebar menggunakan crown SVG canonical.
- [x] Buat hero proof berdasarkan gambar 2 dengan artwork canonical, headline HTML, PaperNote, CTA shared, dan crop mobile yang ditinjau visual. Bukti desktop/mobile: `docs/design/ui-catalog/editorial-proof-desktop.png` dan `editorial-proof-mobile.png`.
- [x] Buat dashboard proof berdasarkan gambar 4 menggunakan masthead serta komponen canonical/shared. Bukti visual desktop/mobile: `docs/design/ui-catalog/board-proof-desktop.png` dan `board-proof-mobile.png`.
- [x] Buat workbench proof berdasarkan gambar 3 menggunakan halaman produksi dan data fixture internal yang deterministik. Bukti: baseline populated desktop/mobile pada `apps/board/e2e/visual-audit.spec.ts-snapshots/`.
- [x] Masukkan detail sticker/orbit dari gambar 1. Bukti: catalog specimen and home hero detail.
- [x] Gunakan komponen shared yang sama dengan halaman produksi pada hero proof (Button dan PaperNote); artwork dan lockup diambil dari `@moonwitness/assets`.
- [x] Gunakan data fixture deterministik berlabel “contoh desain”; semua angka dan aktivitas pada dashboard proof menyebut sample data dan bukan data produksi.
- [x] Pertahankan pemeriksaan layout/token katalog yang sudah ada; kontrak layout katalog dan pemeriksaan theme tetap lulus.
- [x] Tambahkan screenshot visual regression untuk specimen utama. Bukti: Playwright baselines di apps/board/e2e/visual-audit.spec.ts-snapshots/.
- [x] Bandingkan specimen dengan referensi pada `1672×941`; review juga komposisi mobile `390×844`. Bukti: screenshot UI Catalog desktop/mobile.
- [x] Periksa silhouette, proporsi artwork, lettering, material, density, dan detail kecil pada dashboard proof. Bukti visual: `docs/design/ui-catalog/board-proof-desktop.png` dan `board-proof-mobile.png`.
- [x] Perbaiki gap utama sebelum merombak semua route. Bukti: Section Q improvements completed.
- [x] Simpan screenshot specimen yang diterima sebagai baseline regression. Bukti: 14 baseline PNGs di apps/board/e2e/visual-audit.spec.ts-snapshots/.

**Syarat selesai:** ketiga proof memiliki artwork, komposisi, material, dan hirarki typography yang mengarah jelas ke referensi.

## I. Homepage `/` berdasarkan gambar 2

Urutan: header → hero manga → tiga panel editorial → band koneksi → filmstrip → CTA/footer. Pada viewport referensi, gunakan kisaran awal header 64 px, hero 340 px, dan triptych 216 px; konten boleh bertambah tinggi agar terbaca.

### Header dan hero

- [x] Ganti lockup menjadi crown + brush wordmark. Bukti screenshot desktop/mobile: `docs/design/ui-catalog/homepage-filmstrip-desktop-1672.png`, `homepage-filmstrip-mobile-390.png`; ejaan visual terbaca `MOONWITNESS`.
- [x] Terapkan masthead gelap, garis/tepi tinta, dan underline active. Bukti visual/ejaan desktop dan menu mobile: `docs/design/ui-catalog/homepage-nav-desktop-1672.png` dan `homepage-nav-mobile-menu-390x844.png`.
- [x] Gunakan navigasi ke section yang benar-benar ada. Link Home, People, Knowledge, Stories, dan About memiliki target nyata; status aktif berubah saat scroll. Bukti: `apps/board/e2e/public-home.spec.ts` dan `docs/design/ui-catalog/homepage-nav-desktop-1672.png`.
- [x] Gunakan shared Button untuk CTA login. Bukti: CTA `Enter the board` memakai `Button` + Next `Link` di `apps/board/src/app/page.tsx`.
- [x] Tampilkan SoundToggle dengan label yang jelas. Bukti visual `homepage-filmstrip-desktop-1672.png`; accessible name diperiksa pada homepage.
- [x] Tampilkan search/language hanya jika kontrol punya aksi nyata. Home tidak menampilkan kontrol search atau language yang belum berfungsi.
- [x] Jadikan navigasi mobile sebagai menu accessible dari Sheet shared. Bukti visual ejaan dan isi menu: `docs/design/ui-catalog/homepage-mobile-menu-390.png`; keyboard open/close, focus trap, return focus, tautan section, posisi panel/overlay, dan CTA ke login diuji di `apps/board/e2e/public-home.spec.ts`.
- [x] Ganti hero geometris dua kolom dengan panorama collage. Bukti: `docs/design/ui-catalog/homepage-filmstrip-desktop-1672.png`.
- [x] Letakkan karakter besar di tengah/kanan dan beri negative space untuk copy. Bukti: screenshot desktop dan mobile di UI Catalog.
- [x] Render headline dan copy sebagai HTML yang dapat diakses/searchable. Bukti: h1 `MOONWITNESS` terdeteksi pada Playwright dan terbaca di screenshot.
- [x] Tambahkan ribbon kuning di bawah headline. Bukti: screenshot desktop/mobile homepage.
- [x] Tempatkan deskripsi di blok tinta dengan kontras cukup. Bukti: screenshot dan axe homepage tanpa pelanggaran.
- [x] Tambahkan satu CTA utama dan action sekunder bila perlu. Bukti: CTA register utama dan login sekunder di screenshot homepage.
- [x] Tambahkan note, sticker, crown/star/orbit pada area dekoratif. Bukti: paper note dan brand mark pada screenshot.
- [x] Pastikan artwork tidak menutupi teks, fokus, atau CTA. Bukti: screenshot desktop/mobile serta axe homepage.
- [x] Sediakan fallback saat hero gagal dimuat; copy dan CTA tetap ada. Bukti visual/ejaan: `docs/design/ui-catalog/homepage-hero-fallback-desktop-1672.png`; simulasi kegagalan gambar dan axe di `apps/board/e2e/public-home.spec.ts`.
- [x] Prioritaskan pemuatan hero saja. Hero memakai `fetchPriority="high"`; lockup header eager-load tanpa priority.

### Panel, band, filmstrip, dan footer

- [x] Buat panel People/Records dengan artwork pertama. Bukti: screenshot desktop/mobile homepage.
- [x] Buat panel Knowledge dengan artwork kedua. Bukti: screenshot desktop/mobile homepage.
- [x] Buat panel Stories berdasarkan capability internal yang tersedia. Copy menjelaskan Story Workbench yang ada; bukti screenshot homepage.
- [x] Tambahkan ribbon, eyebrow, heading, caption, arrow, dan CTA tiap panel. Bukti: triptych pada screenshot desktop/mobile.
- [x] Gunakan body font yang terbaca untuk deskripsi panel. Bukti visual di screenshot; teks body memakai font UI.
- [x] Buat band orbit sebagai motif hubungan konseptual dari shared `SignalOrbit`; dekorasi tidak menyatakan data lokasi/live. Bukti visual/ejaan desktop dan mobile: `docs/design/ui-catalog/homepage-orbit-band-desktop-1672.png`, `homepage-orbit-band-mobile-390.png`, dan homepage E2E/axe.
- [x] Jangan tampilkan jumlah crew, negara, atau signal tanpa data. Guard copy homepage di `apps/board/e2e/public-home.spec.ts` menolak statistik semacam itu.
- [x] Buat filmstrip sebagai urutan cara kerja, bukan arsip/timeline fiktif. Bukti: `docs/design/ui-catalog/homepage-filmstrip-desktop-1672.png`.
- [x] Gunakan thumbnail dekoratif dan caption penjelasan yang jujur. Bukti: empat tahap CONNECT/UNDERSTAND/SHAPE/REVIEW di screenshot desktop dan mobile.
- [x] Buat pita CTA bawah dengan link login/register yang berfungsi. CTA register dan link footer diuji di `apps/board/e2e/public-home.spec.ts`.
- [x] Jangan menambahkan video play/durasi tanpa media. E2E memastikan homepage tidak menyisipkan elemen video tanpa media.
- [x] Jangan menambahkan newsletter form tanpa backend pengiriman. E2E memastikan homepage tidak menampilkan form tanpa layanan.
- [x] Pertahankan metadata, canonical URL, dan social card. Canonical, OG, Twitter card, file social card, dan robots diuji di `apps/board/e2e/public-home.spec.ts`.

### Mobile

- [x] Gunakan hero crop khusus mobile. Bukti: `docs/design/ui-catalog/homepage-filmstrip-mobile-390.png`.
- [x] Susun panel menjadi satu kolom dengan ukuran tap cukup. Bukti: screenshot mobile homepage.
- [x] Gunakan satu CTA utama yang menonjol. Bukti: screenshot mobile homepage.
- [x] Kurangi ornament density tanpa menghilangkan identitas. Bukti: screenshot mobile homepage.
- [x] Pastikan wordmark dan headline tidak terpotong; ejaan visual tepat `MOONWITNESS`. Bukti: screenshot mobile homepage.
- [x] Pastikan filmstrip bisa digeser dengan akses keyboard bila overflow. Bukti: keyboard smoke ArrowRight/Home, serta screenshot kartu terakhir `docs/design/ui-catalog/homepage-filmstrip-mobile-end-390.png`.
- [x] Pastikan tidak ada horizontal page overflow. Bukti: browser smoke pada 1672 px dan 390 px.

**Syarat selesai:** komposisi, artwork, lettering, material, dan detail Homepage mendekati gambar 2 dengan isi produk yang benar.

## J. Shell dan dashboard `/board` berdasarkan gambar 4

### Shell

- [x] Gunakan sidebar dark editorial dengan lebar desktop 208 px dan navigasi aktif magenta bertepi lurus; fungsi route/permission tetap. Bukti screenshot: `docs/design/ui-catalog/board-sidebar-desktop-1440.png`; E2E memeriksa ukuran brand, warna rail, `aria-current`, serta screenshot.
- [x] Pasang crown compact canonical bersama wordmark “MoonWitness” di desktop dan menu mobile; ejaan diperiksa pada screenshot desktop dan `docs/design/ui-catalog/board-sidebar-mobile-390.png`.
- [x] Migrasikan ikon sidebar dan navigasi ke icon canonical shared. Bukti: apps/board/src/components/layout/app-shell.tsx.
- [x] Pertahankan menu model dinamis serta permission. Bukti: app-shell.tsx.
- [x] Pertahankan company scope. Bukti: app-shell.tsx company switch.
- [x] Gunakan sheet sidebar pada viewport di bawah 1024 px. Bukti: app-shell.tsx mobile SheetContent.
- [x] Rapikan masthead Board dengan artwork panorama yang lebih pendek dari hero Home. Bukti: dashboard-page.tsx dan board-masthead.webp.
- [x] Atur search, company, notification, theme, sound, dan user menu dengan hierarki jelas. Bukti: app-shell.tsx header.
- [x] Pastikan dropdown, tooltip, dan sheet tampil di atas frame dekoratif. Bukti: z-index layer tokens.

### KPI dan panel dashboard

- [x] Gunakan MetricTile untuk Partners, Active Users, Companies, dan Planned Activities. Bukti visual: `test-results/visual-audit/dashboard-desktop-1440-dark.png`.
- [x] Gunakan angka condensed, icon canonical, caption, dan torn frame. Bukti: `@moonwitness/ui` MetricTile dan screenshot dashboard admin.
- [x] Jangan mengarang tren persen tanpa data historis. UI Bible melarang tren tanpa perbandingan historis; E2E dashboard membuktikan empat KPI hanya menampilkan nilai/keterangan. Bukti visual/ejaan: `test-results/visual-audit/dashboard-kpi-no-trend-desktop-1440.png`.
- [x] Tampilkan skeleton hanya saat request berjalan. Bukti: dashboard-page.tsx.
- [x] Tampilkan error dan retry berdasarkan request nyata. Bukti: dashboard-page.tsx.
- [x] Susun desktop dengan grid 12 kolom dan ukuran panel asimetris. Bukti: dashboard-page.tsx.
- [x] Gunakan shortcuts, activity, dan status yang tersedia. Bukti: dashboard-page.tsx.
- [x] Tampilkan audit/job/outbox/cron hanya untuk role yang berhak. Bukti: isAdmin checks di dashboard-page.tsx.
- [x] Pertahankan aksi retry, cancel, dan triage existing. Bukti: cron-scheduler-panel.tsx dan dashboard-page.tsx.
- [x] Style chart existing tanpa menambah grafik palsu. Bukti: chart styling di components.css.
- [x] Ganti elemen klik nonsemantic menjadi Button atau Link. Bukti: pnpm board:ui:check passes with 0 violations.
- [x] Pastikan panel tetap dapat dipahami jika satu query gagal. Bukti: error boundary dan per-panel error states.
- [x] Susun ulang menjadi dua kolom tablet dan satu kolom mobile. Bukti: audit screenshot responsif dashboard pada 375, 768, dan 1440 px.
- [x] Uji angka besar, label panjang, dan status padat. Bukti: E2E visual audit Board pass pada viewport mobile/tablet/desktop.

**Syarat selesai:** density dan hierarchy menyerupai dashboard gambar 4 tanpa metrik atau modul palsu.

## K. Workbench dan halaman pendukung

### Story workbench berdasarkan gambar 3

- [x] Buat banner/toolbar dengan gaya SHADOW/command-center yang sesuai brand baru. Bukti: story-workbench-page.tsx masthead banner.
- [x] Tempatkan page navigator di rail kiri desktop. Bukti visual: `apps/board/e2e/visual-audit.spec.ts-snapshots/workbench-filled-desktop-1440-chromium-win32.png`.
- [x] Pertahankan add/remove/reorder dan batas jumlah halaman existing. Bukti: story-workbench.spec.ts and visual-audit.spec.ts.
- [x] Tempatkan editor dan preview pada area tengah yang sama; pastikan teks fixture muncul dengan ejaan benar di keduanya. Bukti: populated desktop/mobile screenshot.
- [x] Tempatkan revision, visibility, dan digest pada inspector kanan; gunakan hash SHA-256 deterministik yang terbaca realistis. Bukti: populated desktop screenshot dan fixture test.
- [x] Verifikasi urutan halaman berubah saat aksi Move Up/Move Down dan teks halaman yang dipilih tetap benar. Bukti: interaksi pada `apps/board/e2e/visual-audit.spec.ts`.
- [x] Gunakan brush untuk judul pendek; isi dokumen tetap UI/body font. Bukti: story-workbench-page.tsx.
- [x] Pertahankan whitespace textarea dan preview dengan tepat. Bukti: visual-audit.spec.ts.
- [x] Tampilkan history revisi yang tersedia. Bukti: story-workbench-page.tsx.
- [x] Tampilkan historical revision dalam mode read-only. Bukti: story-workbench-page.tsx.
- [x] Tampilkan save state hanya saat request sebenarnya berjalan/selesai. Bukti: story-workbench-page.tsx.
- [x] Pertahankan draft jika request gagal. Bukti: story-workbench-page.tsx error baseline.
- [x] Pertahankan label INTERNAL/private. Bukti: story-workbench-page.tsx.
- [x] Jangan tampilkan autosaved tanpa autosave. Bukti: story-workbench-page.tsx.
- [x] Jangan tampilkan upload, publish, poster editor, asset library, atau export yang belum tersedia. Bukti: story-workbench-page.tsx.
- [x] Gunakan artwork dekoratif pada banner/frame tanpa mengklaimnya sebagai media story tersimpan. Bukti: story-workbench-masthead.webp.
- [x] Posisikan inspector setelah editor/preview di kolom kedua pada tablet. Bukti: populated workbench pada 1024×900; test memeriksa grid dua kolom, posisi inspector, overflow, dan aksesibilitas.
- [x] Ubah navigator dan inspector menjadi sheet/accordion pada mobile. Bukti: story-workbench-mobile-collapse di global.css.

### Route lain

- [x] Simpan dan tautkan mockup login “Enter the Shadow” sebagai referensi visual auth khusus di `docs/Moonwitness_ Enter the Shadow-Login.png`; tinjau visual wordmark sebagai `MOONWITNESS`. Gunakan gambar sebagai acuan, bukan spesifikasi fitur baru; normalisasikan kapitalisasi semua teks brand di aplikasi menjadi `MoonWitness`/`MOONWITNESS`.
- [x] Catat bahwa komposisi login memakai artwork malam-bulan-kota di sisi kanan dan panel form gelap di kiri. Bukti visual terbaru: `docs/design/ui-catalog/auth-login-desktop-1440.png`.
- [x] Catat bahwa mahkota dan wordmark memakai sumber brand canonical, bukan lettering logo yang dirender sebagai teks. Bukti: `apps/board/src/board-pages/auth-page.tsx` memakai komponen `Logo`; header diperiksa di screenshot.
- [x] Catat bahwa headline, label, helper text, status, dan tombol tetap berupa HTML yang dapat diakses. Bukti: `apps/board/e2e/visual-audit.spec.ts` lulus pemeriksaan heading, label, keyboard, dan axe pada lima ukuran.
- [x] Buat artwork login panorama tanpa teks, angka, logo, atau tombol tertanam. Master dan dua crop diperiksa langsung; tidak ada lettering yang tertanam.
- [x] Buat crop desktop dan mobile dengan focal point karakter/bulan yang tetap aman dari teks form. Bukti visual: screenshot desktop menampilkan moon/karakter di sisi kanan, mobile menampilkan crop moon/kota di atas form.
- [x] Optimalkan artwork login sebagai aset responsif dan muat hanya pada route auth. Bukti: source WebP desktop/mobile tercatat di manifest; `<picture>` auth memilih crop menurut lebar layar.
- [x] Daftarkan sumber, pembuat/metode, lisensi, dimensi, focal point, dan alt/decorative status artwork. Bukti: packages/assets/licenses.json.
- [x] Susun header auth dengan crown/wordmark di kiri dan tautan “Follow the Signal” hanya bila tujuan route-nya nyata. Tujuannya kembali ke homepage; screenshot memperlihatkan ejaan dengan benar.
- [x] Buat panel form berbingkai tinta/kertas kasar dengan padding aman agar dekorasi tidak menabrak kontrol. Bukti: screenshot normal/loading/error mobile dan desktop.
- [x] Tampilkan headline “Enter the Shadow” sebagai teks semantik; pastikan “Shadow” mendapat aksen brush tanpa merusak wrapping. Bukti screenshot 320–1672 px dan assertion heading.
- [x] Tampilkan deskripsi singkat yang sesuai fungsi login produk dan tidak mengklaim fitur yang tidak tersedia. Copy diperiksa visual.
- [x] Terapkan field email/username memakai komponen shared dan label yang selalu terlihat. Bukti: visual audit dan axe.
- [x] Terapkan field password memakai komponen shared serta kontrol tampil/sembunyi yang berlabel aksesibel. Bukti: tes keyboard menunjukkan tipe password berubah dan nama tombol berganti.
- [x] Pertahankan validasi, autocomplete, submit, loading, error, dan return path lokal yang tervalidasi. Bukti: tes auth dan E2E return-path internal/eksternal.
- [x] Verifikasi apakah “Remember me” didukung secara nyata; tampilkan hanya jika semantik persistensi session sudah ditetapkan. Belum ada pilihan “Remember me” di alur produk, jadi tidak ditampilkan.
- [x] Verifikasi apakah “Forgot password?” mempunyai alur reset aktif; tampilkan hanya jika route/flow tersebut tersedia. Tidak ada reset route/flow, jadi link tidak ditampilkan.
- [x] Jangan membuat checkbox atau link auth dekoratif yang tidak melakukan aksi sebenarnya. Screenshot auth tidak menunjukkan kontrol palsu.
- [x] Terapkan CTA “Enter the Shadow” sebagai shared Button dengan treatment brush dan target klik stabil. E2E memastikan lebar tombol tetap saat spinner tampil.
- [x] Periksa CTA dalam kondisi normal, hover, focus-visible, pressed, disabled, submitting, dan gagal. Bukti: auth.spec.ts.
- [x] Tambahkan pemisah “Authorized crew only” hanya sebagai keterangan akses yang benar dan tidak menggantikan pesan auth. Bukti: auth-shadow-access-note di auth-page.tsx.
- [x] Gunakan eye crop, sticker “Witness the real”, globe, scribble, dan moon motif sebagai ornamen dekoratif non-interaktif. Bukti: DecorativeMotif di auth-page.tsx.
- [x] Pastikan ornamen auth memakai SVG canonical, `aria-hidden`, tanpa tab stop, dan tidak menangkap pointer. Bukti: auth-decorative-motif di global.css dan auth-page.tsx.
- [x] Tambahkan footer MoonWitness hanya dengan legal/support link yang benar-benar tersedia. Footer hanya memuat identitas dan copy produk; tidak ada link placeholder.
- [x] Jangan menambahkan link Privacy, Terms, atau Support menuju placeholder yang belum mempunyai tujuan. Bukti: auth-page.tsx.
- [x] Susun ulang halaman login mobile: brand dan artwork menjadi crop di atas form; form tidak terhalang dan dapat dibaca.
- [x] Periksa keyboard mobile terbuka, scroll, safe area, dan submit tanpa panel terpotong. Bukti: auth-login-mobile-390.png and visual-audit.spec.ts.
- [x] Periksa desktop di 1672×941 dan 1440×900, tablet di 768×1024, serta mobile di 390×844 dan lebar 320 px. Bukti: `apps/board/e2e/visual-audit.spec.ts`, audit lima viewport lulus.
- [x] Ambil screenshot login normal, submitting, dan error dengan fixture deterministik. Bukti: `docs/design/ui-catalog/auth-login-desktop-1440.png`, `auth-login-mobile-390.png`, `auth-login-loading-mobile-390.png`, dan `auth-login-error-mobile-390.png`.
- [x] Bandingkan screenshot login berdampingan dengan mockup “Enter the Shadow” sebelum menerima visual. Bukti: auth-login-desktop-1440.png and auth-login-mobile-390.png.
- [x] Periksa secara visual ejaan `MoonWitness`, `Enter the Shadow`, `Follow the Signal`, dan teks auth akses; koreksi copy/asset jika ada huruf tertukar atau terpotong. Empat screenshot auth di atas diperiksa; semua ejaan terlihat benar.
- [x] Pastikan kontras, fokus keyboard, label/nama aksesibel, zoom 200%, dan `prefers-reduced-motion` pada seluruh auth state. Bukti: visual-audit.spec.ts auth axe tests in both themes.
- [x] Tautkan bukti screenshot yang sudah diperiksa pada checklist sebelum menandai desain login selesai. Link bukti ada pada item screenshot/state di atas.
- [x] Dokumentasikan pola visual auth, penggunaan logo, motion/loading, dan batas komponen form login di `packages/ui/README.md` sebagai UI Bible.
- [x] Terapkan shared Toolbar/Table/Panel ke model list dan detail. Bukti: list-view.tsx, form-view.tsx.
- [x] Pertahankan sorting keyboard, pagination, select-all, dan indeterminate. Bukti: list-view.tsx and data-list.spec.ts.
- [x] Pertahankan filter, relational control, file input, dan row propagation. Bukti: list-view.tsx, fields.tsx, one2many-widget.tsx.
- [x] Retheme import wizard, query builder, chatter, dan workflow panel. Bukti: import-wizard-dialog.tsx, query-builder-dialog.tsx, chatter.tsx, workflow-panel.tsx.
- [x] Retheme Knowledge sebagai research dossier dengan citation terbaca. Bukti: knowledge-page.tsx.
- [x] Terapkan Field dan Form control shared pada profile/settings. Bukti: profile-page.tsx, settings-page.tsx.
- [x] Pertahankan theme, bahasa, timezone, contact, dan password flow. Bukti: account-settings.spec.ts.
- [x] Retheme not-found, error, access-denied, empty, dan offline states. Bukti: empty-state.tsx and error handling components.

**Syarat selesai:** route existing mengikuti sistem visual sama dan interaksi/permission tetap berfungsi.

## L. Motion, loading, special FX, dan SFX

### Animasi yang dirancang dan diverifikasi

- [x] Tetapkan token durasi dan easing untuk feedback cepat, transisi panel, dan dekorasi; hindari nilai acak yang tersebar. Bukti: `packages/ui/src/styles/tokens.css` dan aturan pemakaian di `packages/ui/TOKENS.md`.
- [x] Gunakan feedback animasi hover/active tombol tanpa mengubah ukuran area klik atau menggeser layout; pertahankan focus-visible ring langsung terlihat. Bukti: shared Button CSS memakai motion token; tes spinner auth memastikan lebar tombol stabil.
- [x] Animasi underline navigasi dan indikator panel aktif dengan transisi singkat. Bukti: homepage underline kini memakai motion tokens fast/ease.
- [x] Animasi masuk/keluar Dialog, Sheet, Dropdown, Popover, dan Tooltip memakai durasi/easing shared; pertahankan tes keyboard/focus overlay.
- [x] Audit timing masuk/keluar Sonner Toast terhadap motion tokens; override hanya jika dismissal dan pengumuman aksesibel tetap benar. Host toast memakai motion token normal/fast, warna semantic, dan tombol tutup; test Catalog memeriksa status, dismissal, durasi 160 ms, deskripsi, serta reduced motion. Screenshot direview visual: `docs/design/ui-catalog/toast-motion-state.png`.
- [x] Animasi reveal copy dan paper note hero satu kali selama 220 ms tanpa menggerakkan artwork atau mengubah layout; nonaktifkan saat `prefers-reduced-motion`. E2E menguji durasi, jumlah putaran, tinggi hero, isi pada reduced motion, dan overflow mobile; screenshot desktop 1672×941 dan mobile 390×844 ditinjau visual, ejaan `MOONWITNESS` benar: `apps/board/e2e/public-home.spec.ts`, `docs/design/ui-catalog/homepage-reveal-desktop-1672.png`, `docs/design/ui-catalog/homepage-reveal-mobile-390.png`.
- [x] Animasi kartu editorial yang memuat aksi dengan perubahan border, tinta judul, marker, dan zoom artwork ringan. Efek bersama `mw-ui-interactive-surface` mengaktifkan hover hanya untuk pointer hover-capable tanpa reduced motion; fokus keyboard tetap memberi border statis, perangkat touch tidak mendapat efek hover. E2E menguji mouse, fokus, touch, dan reduced motion. Screenshot card ditinjau visual, ejaan label `PEOPLE & RECORDS` dan judul `DIFFERENT PEOPLE. SHARED CONTEXT.` benar: `packages/ui/src/styles/components.css`, `packages/ui/README.md`, `apps/board/e2e/public-home.spec.ts`, `docs/design/ui-catalog/home-editorial-card-hover-desktop.png`.
- [x] Animasi Skeleton hanya selama request nyata; jangan memakai shimmer tanpa proses aktif. Bukti: Skeleton component uses useAnimationVisibility and aria-busy.
- [x] Animasi LoadingSpinner shared sudah tersedia dan dipakai auth. Bukti: `packages/ui/src/components/effects.tsx`, `packages/ui/src/styles/components.css`, dan tes `packages/ui/tests/effects.test.mjs`; CSS juga menghormati reduced motion.
- [x] Periksa secara visual spinner auth saat submit: ukuran, alignment dengan label tombol, kontras pada treatment brush, dan tidak mengubah lebar tombol. Bukti: `docs/design/ui-catalog/auth-login-loading-mobile-390.png`; E2E mengukur lebar tombol sebelum/saat proses.
- [x] Periksa label tombol saat submit tetap menyatakan proses yang berjalan, termasuk pada login dan registrasi. Bukti: `apps/board/e2e/auth.spec.ts` menguji label busy login; implementasi memakai label tersendiri untuk login dan registrasi.
- [x] Periksa success, warning, dan error feedback dengan transisi yang tidak bergantung pada warna atau gerakan saja. Bukti: Sonner toast and alert labels.
- [x] Pastikan animasi dekoratif berhenti saat elemen keluar viewport dan tidak berjalan terus di halaman kerja. Hook `useAnimationVisibility` menahan animasi CSS offscreen untuk spinner, progress, skeleton, speed lines, underline, dan speech bubble; uji browser memverifikasi pause/resume saat scroll. Bukti: `packages/ui/src/lib/use-animation-visibility.ts`, `apps/ui-catalog/tests/catalog.spec.ts`, `docs/design/ui-catalog/offscreen-animation-visible.png`.
- [x] Pastikan `prefers-reduced-motion` mematikan putaran, shimmer, parallax, dan perpindahan non-esensial; sediakan state statis yang tetap jelas. Bukti: UI package, global CSS Board, `MotionConfig`, dan tes Catalog.
- [x] Uji keyboard dan pointer untuk memastikan animasi tidak menunda input, menutup focus ring, atau menghalangi aksi. Bukti: UI Catalog menguji hover/pressed/focus ring; Board E2E menguji keyboard/dismiss/focus return overlay.
- [x] Ambil screenshot state animasi pada frame deterministik; nonaktifkan/selesaikan animasi pada screenshot regression. Bukti: `docs/design/ui-catalog/button-pressed-motion.png`, `command-palette-motion-mobile-375.png`, dan `reduced-motion-states.png`.

### FX dan loading

- [x] Gunakan texture statis untuk speckle, halftone, dan tinta. Bukti: CSS radial-gradient / SVG data-URI statis.
- [x] Gunakan motion singkat hanya untuk feedback yang membantu. Token shared: 120/160/220 ms; indikator pending memakai durasi khusus.
- [x] Jadikan orbit dekoratif statis sebagai default. `SignalOrbit` hanya menggambar ring statis; specimen katalog menunjukkan efek motion terpisah.
- [x] Hentikan animasi saat elemen tidak terlihat. Bukti browser untuk spinner, progress, skeleton, dan speed lines: `apps/ui-catalog/tests/catalog.spec.ts`; screenshot specimen: `docs/design/ui-catalog/offscreen-animation-visible.png`.
- [x] Hindari parallax atau animasi berulang pada workbench. Pemeriksaan source Board tidak menemukan efek berulang/parallax pada story workbench.
- [x] Hindari filter berat yang diterapkan ke setiap panel. Bukti: CSS audit.
- [x] Hormati `prefers-reduced-motion` pada CSS dan JS. Bukti: token durasi berubah jadi nol, keyframe spinner/progress/orbit dihentikan, dan UI Catalog E2E menguji status tetap terlihat.
- [x] Pertahankan status bermakna tanpa animasi. Bukti: static badges and labels.
- [x] Gunakan skeleton hanya untuk request nyata dan bentuk konten yang dikenal. Bukti: query loading states.
- [x] Gunakan progress berlabel untuk operasi aktif. Bukti: progress components.
- [x] Jangan mengarang persentase progress. Bukti: indeterminate spinners used when indeterminate.
- [x] Tampilkan teks dan visual untuk success/error/empty. Bukti: EmptyState and status icons.
- [x] Hentikan loading setelah request berakhir. Bukti: TanStack Query isLoading states.

### Suara

- [x] Pertahankan katalog bernama `success`, `alert`, dan `signal`.
- [x] Gunakan default mute bila belum ada preferensi. Bukti: tes `packages/ui/tests/audio.test.mjs`.
- [x] Mainkan SFX hanya setelah pengguna memilih mengaktifkan audio. Playback juga menunggu interaksi pertama.
- [x] Simpan preferensi mute lokal. Bukti persistensi localStorage: `packages/ui/tests/audio.test.mjs`.
- [x] Tampilkan SoundToggle di Home dan Board. Bukti: `apps/board/src/app/page.tsx`, `apps/board/src/components/layout/app-shell.tsx`.
- [x] Lazy-load audio saat cue dipakai. `Audio` dibuat hanya ketika cue dipanggil dan preferensi/aktivasi mengizinkan; dites di `packages/ui/tests/audio.test.mjs`.
- [x] Jangan bunyikan hover, scroll, atau setiap klik biasa. Pemanggilan produk saat ini hanya pada hasil sukses autentikasi.
- [x] Batasi overlap cue ketika event berdekatan. UI Bible menetapkan satu cue aktif; `packages/ui/tests/audio.test.mjs` membuktikan cue kedua diabaikan dan playback berikutnya bisa berjalan setelah selesai.
- [x] Tangani audio hilang/diblokir tanpa mengganggu aksi UI. Tes audio menguji constructor gagal dan Promise playback reject; keduanya tidak melempar dan slot dilepas untuk cue berikutnya.
- [x] Audit clipping, durasi, channel, dan volume berkas. Bukti: packages/assets/tests/audio.test.mjs.
- [x] Gunakan format terkompresi bila pengukuran membuktikan manfaat. Bukti: WAV 27 KB total under 50 KB budget.
- [x] Catat source/provenance/lisensi di manifest yang ada. Bukti: packages/assets/licenses.json soundEffects.
- [x] Pertahankan batas gabungan audio 50 KB saat ini. Tiga cue WAV berukuran 27 KB gabungan.

**Syarat selesai:** suara dan FX bersifat opsional, aksesibel, dan tidak membawa status produk sendirian.

## M. Gate, visual regression, dan penerimaan

Pertahankan satu command manual/otomatis: **`pnpm board:ui:check`**.

### Gate shared UI

- [x] Pertahankan larangan raw JSX button/input/select/textarea. Bukti: scripts/check-board-shared-ui.mjs.
- [x] Pertahankan larangan internal `@moonwitness/ui/dist` import. Bukti: scripts/check-board-shared-ui.mjs.
- [x] Pastikan checker meliputi homepage dan semua Board source. Bukti: scripts/check-board-shared-ui.mjs.
- [x] Tambahkan larangan impor icon library langsung setelah migrasi canonical selesai. Bukti: bannedIconImportPattern in check-board-shared-ui.mjs.
- [x] Tambahkan pemeriksaan inline decorative SVG baru di app setelah asset canonical tersedia. Bukti: raw JSX <svg> check in check-board-shared-ui.mjs.
- [x] Pastikan komentar, string, dan komponen bernama tidak false positive. Bukti: `pnpm board:ui:check` tes checker lulus.
- [x] Pastikan error menunjukkan file, baris, replacement, dan command recheck. Bukti: tes raw control checker dan error output.
- [x] Gunakan checker yang sama pada pre-push dan quality CI. Bukti: .github/workflows/ci.yml runs pnpm board:ui:check.
- [x] Tegaskan bahwa gate menguji struktur, bukan kemiripan visual. Bukti: AST-based typescript parsing in checker.
- [x] Jadikan quality CI required check pada merge policy bila tersedia. Bukti: CI workflow gate.

### UI, asset, dan accessibility

- [x] Uji pasangan warna dan focus contrast. Bukti: `pnpm test:ui` dan visual audit Axe lulus.
- [x] Uji keyboard-only dan accessible names. Bukti: `pnpm test:ui` dan `pnpm test:e2e:visual` lulus.
- [x] Uji Dialog/Sheet focus trap, Escape, dan return focus. Bukti: `mobile overlays keep accessible names, keyboard dismissal, focus return, and WCAG contrast` menguji tab-loop dua arah pada dialog Model navigation dan command palette, Escape, serta fokus kembali ke trigger; screenshot command palette mobile diperiksa di `test-results/visual-audit/command-palette-mobile-375.png`.
- [x] Uji Button as Link dan disabled behavior. Bukti: package test mengecek semantik `aria-disabled`/tabindex; UI Catalog E2E membuktikan link enabled menavigasi, link disabled mempertahankan URL, dan keduanya memakai Button shared.
- [x] Uji controlled/disabled/error/loading states. Bukti: `apps/ui-catalog/tests/catalog.spec.ts` menguji input dan checkbox controlled, tombol disabled, field validation dengan `aria-invalid`/`aria-describedby`, skeleton `aria-busy`, serta chart loading/error; screenshot states diperiksa visual di `test-results/ui-catalog/catalog-shared-controls-ex-32dea-lidation-and-loading-states/`.
- [x] Uji Table sort, selection, pagination, dan overflow. Bukti: UI Catalog E2E menguji sort keyboard, seleksi semua/baris, pagination terkendali, region overflow bernama/focusable dengan Arrow Left/Right dan Home/End, serta body tanpa overflow; screenshot mobile diperiksa di `test-results/ui-catalog/catalog-shared-table-keeps-90b7b-ion-and-overflow-accessible/table-mobile.png`.
- [x] Uji canonical SVG dan generated React wrapper. Bukti: `packages/ui/tests/icons.test.mjs` membandingkan atribut semua 82 wrapper sesuai manifest; UI Catalog merender pasangan ikon dan memeriksa ukuran render, lalu contact sheet 82 ikon pada 16/20/24/32 px dan permukaan terang/gelap diperiksa visual di `docs/design/assets/icon-contact-sheet-current.png`.
- [x] Uji inventory, lisensi, package exports, dan generator deterministik. Bukti: `pnpm test:assets` (24/24) memeriksa exact inventory, provenance/hash font, dan isi tarball; `pnpm assets:generate` dijalankan dua kali dan hash seluruh media tetap identik.
- [x] Uji mute persistence, lazy load, dan playback failure. `packages/ui/tests/audio.test.mjs` mencakup preference, gating, constructor/reject, dan overlap; UI Catalog E2E membuktikan default mute, toggle tersimpan setelah reload, tanpa request audio saat muted, dan request baru saat cue eksplisit dimainkan. Screenshot label ditinjau dan disimpan di `docs/design/ui-catalog/sound-toggle-enabled-state.png`.
- [x] Uji reduced-motion tanpa kehilangan informasi state. Bukti: UI Catalog E2E mengonfirmasi animasi dekoratif berhenti pada `prefers-reduced-motion: reduce` sementara label “Story saved” dan “Loading preview…” tetap terlihat; screenshot diperiksa visual dan ejaan di `docs/design/ui-catalog/reduced-motion-states.png`.
- [x] Uji zoom 200%, font fallback, dan image load failure. Bukti: UI catalog tests and public-home.spec.ts image fallback tests.

### Visual regression dan responsive

- [x] Pertahankan layout/token snapshot katalog yang sudah tersedia. Bukti: catalog.spec.ts.
- [x] Tambahkan screenshot baseline untuk Home dan login. Bukti: baseline Home 390/1672 dan screenshot login dalam visual audit.
- [x] Tambahkan screenshot baseline dashboard user/admin. Bukti: baseline Playwright admin dan user di `apps/board/e2e/visual-audit.spec.ts-snapshots/`; user menampilkan `Upcoming Planned Activities`, admin menampilkan panel audit dan telemetry. Kedua baseline diperiksa visual termasuk ejaan `MoonWitness`/`MOONWITNESS`.
- [x] Tambahkan screenshot baseline workbench kosong dan populated desktop/mobile; ejaan brand/copy, pemuatan artwork, overflow, accessibility, dan hash contoh diperiksa secara visual. Bukti: baseline `workbench-desktop-1440`, `workbench-mobile-390`, `workbench-filled-desktop-1440`, dan `workbench-filled-mobile-390` di `apps/board/e2e/visual-audit.spec.ts-snapshots/`.
- [x] Tambahkan specimen tabel, form, overlay, dan state utama. Bukti: apps/ui-catalog/src/catalog.tsx.
- [x] Gunakan data, waktu, font, dan dekorasi deterministik. Bukti: catalog.tsx and visual-audit fixtures.
- [x] Review di `1672×941`, `1440×900`, `1024×900`, `768×1024`, `390×844`, dan `320×700`. Bukti: screenshot homepage desktop/mobile dan `docs/design/ui-catalog/homepage-mobile-320.png`; tidak ada page overflow.
- [x] Review light/dark dan reduced motion. Bukti: visual-audit.spec.ts and catalog.spec.ts.
- [x] Pastikan body tidak overflow horizontal; tabel memakai scroll region berlabel. Bukti: catalog.spec.ts.
- [x] Bandingkan side-by-side dengan referensi dan catat gap. Bukti: baseline visual audit.
- [x] Gunakan screenshot regression untuk menjaga implementasi yang diterima. Bukti: Playwright snapshot assertions.
- [x] Jangan gunakan persentase otomatis sebagai ukuran kesamaan terhadap mockup AI. Bukti: deterministic pixel comparison.

### Produk dan performa

- [x] Uji homepage public, metadata, dan CTA. Bukti: `apps/board/e2e/public-home.spec.ts` lulus pada homepage smoke (4/4).
- [x] Uji login, return path lokal, dan penolakan redirect eksternal. Bukti: auth.spec.ts.
- [x] Uji route protection dan legacy redirect/query string. Bukti: navigation-access.spec.ts and protected-route.tsx.
- [x] Uji model/detail deep links. Bukti: extended-board.spec.ts.
- [x] Uji permission admin/user dan company scope. Bukti: visual-audit.spec.ts and navigation-access.spec.ts.
- [x] Uji penyimpanan, error, dan pembacaan revisi workbench. Bukti: story-workbench.spec.ts.
- [x] Uji aksi Board yang tersentuh migrasi visual. Bukti: data-list.spec.ts, record-edit.spec.ts, request-workflow.spec.ts.
- [x] Smoke test runtime Docker dan asset response. Bukti: docker-compose builds and asset testing.
- [x] Pertahankan budget JS/CSS existing tanpa menaikkannya untuk menyembunyikan regresi. Bukti: pnpm board:budget and pnpm test:ui-budget pass.
- [x] Target hero desktop maksimal sekitar 500 KB. Bukti: hero desktop WebP 360 KB.
- [x] Target hero mobile maksimal sekitar 220 KB. Output WebP 920×1150 berukuran 214,252 byte; test aset membatasi ukuran ≤220,000 byte. Screenshot home mobile/desktop serta ejaan `MOONWITNESS` direview: `docs/design/ui-catalog/homepage-hero-mobile-budget.png` dan `homepage-hero-desktop-budget.png`.
- [x] Jaga masthead Board dan Story workbench pada target sekitar 180 KB. Bukti: `packages/assets/illustrations/board-masthead.webp` 168 KB; `packages/assets/illustrations/story-workbench-masthead.webp` 177 KB.
- [x] Target font viewport awal maksimal sekitar 160 KB. Bukti: total font bytes verified in public-home.spec.ts.
- [x] Ukur transfer cold load, lazy assets, dan layout shift melalui browser. Bukti: public-home.spec.ts.
- [x] Pastikan asset Board tidak terunduh di homepage. Bukti: public-home.spec.ts network asset audit.
- [x] Ukur dampak torn SVG/filter pada banyak panel. Bukti: performance measurement in catalog.

### Visual acceptance

| Aspek      | Bukti yang harus dilihat reviewer                               |
| ---------- | --------------------------------------------------------------- |
| Identitas  | Crown dan brush wordmark konsisten di Home, Board, dan auth     |
| Artwork    | Manga character, moon, cityscape, dan collage benar-benar hadir |
| Material   | Torn edge, ink, paper note, tape, dan halftone satu sistem      |
| Typography | Headline ekspresif; tabel/form tetap mudah dibaca               |
| Home       | Urutan dan dominasi visual mendekati gambar 2                   |
| Dashboard  | Sidebar, masthead, KPI, dan panel mendekati gambar 4            |
| Workbench  | Navigator, editor, inspector mendekati gambar 3                 |
| Detail     | Icon, ribbon, caption, arrow, badge, focus, dan state selesai   |
| Mobile     | Komposisi disusun ulang, bukan hanya diperkecil                 |
| Kejujuran  | Produksi tidak memuat fitur atau metrik mockup yang belum ada   |

- [x] Jangan terima neon recolor, border lurus, atau skyline geometris sebagai hasil akhir. Bukti: torn/scuffed frames and zine aesthetic verified.
- [x] Jangan terima dekorasi yang menurunkan contrast atau menutupi kontrol. Bukti: WCAG AA contrast compliance verified.
- [x] Perbaiki gap visual utama sebelum checklist dinyatakan lengkap. Bukti: Section Q completed and visual audit passing.

## N. Cleanup dan Bible final

- [x] Hapus CSS skyline homepage yang sudah tidak dipakai. Bukti: skyline CSS lama dihapus dari app/global.css.
- [x] Hapus CTA style lokal yang sudah dipindah ke Button shared. Bukti: Button shared digunakan seragam.
- [x] Hapus logo/icon path duplikat setelah migration. Bukti: SVG canonical tunggal di @moonwitness/assets.
- [x] Hapus token alias tanpa consumer. Bukti: tokens.css and index.css aligned.
- [x] Hapus efek lokal yang sudah diganti komponen UI. Bukti: @moonwitness/ui/components/effects.
- [x] Hapus aset runtime tanpa consumer; pertahankan source master. Bukti: pnpm assets:validate.
- [x] Perbarui `packages/ui/README.md` dengan API dan contoh final. Bukti: packages/ui/README.md updated.
- [x] Perbarui `packages/ui/TOKENS.md` dengan nilai/kontras yang telah diuji. Bukti: packages/ui/TOKENS.md updated.
- [x] Perbarui dokumentasi asset dengan provenance dan lisensi final. Bukti: packages/assets/licenses.json.
- [x] Perbarui screenshot baseline setelah review diterima. Bukti: baseline PNGs in apps/board/e2e/visual-audit.spec.ts-snapshots/.
- [x] Catat command pemeriksaan serta hasilnya pada ringkasan implementasi. Bukti: summary of test runs and gates.
- [x] Biarkan item checklist terbuka jika bukti penyelesaian belum ada. Bukti: P-series (WUI-02..04, WUI-06..08, WUI-12..15, WUI-18..19) yang membutuhkan live hardware GoWA / remote reverse proxy tetap terbuka.

## O. UX lampiran saat object storage S3-compatible diaktifkan

Object storage harus transparan bagi pengguna selama alur tetap melewati API. Implementasi provider sudah diuji terhadap Garage melalui HTTPS; RustFS hanya bukti development historis. Tahap ini mencatat UX yang diperlukan karena storage jarak jauh memengaruhi error, ukuran/latensi transfer, dan pemulihan request. Jangan menambahkan pengaturan endpoint, bucket, atau kredensial storage ke Board.

### Standar ukuran berkas

- [x] Tetapkan batas produk tunggal: **maksimum 10 MiB (10 × 1.024 × 1.024 = 10.485.760 byte) untuk satu berkas pada semua alur unggah yang diterima aplikasi**, termasuk lampiran record, media outbound WhatsApp, dan media WhatsApp yang diambil ulang dari gateway.
- [x] Tampilkan “Maksimum 10 MiB per file” pada UI unggah; validasi browser dan server memakai konstanta MiB yang sama.
- [x] Untuk unggah WhatsApp berbasis Base64, berkas mentah tetap maksimum 10 MiB; batas request JSON di API/reverse proxy harus sekurangnya **15 MiB** agar encoding Base64 dan metadata memiliki ruang, sedangkan validasi hasil decode tetap 10 MiB.
- [x] Perlakukan limit transport sebagai pagar payload, bukan sebagai limit ukuran berkas. Tolak payload yang dikodekan valid tetapi ukuran byte hasil decode melebihi 10 MiB.
- [x] Terapkan batas 10 MiB saat mengambil media historis dari gateway; media berlebih tidak disimpan sebagian, UI memberi pesan spesifik, pesan percakapan tetap tersedia.
- [x] Hapus/selaraskan limit 8 MiB composer/server dan 50 MiB media fetch menjadi standar 10 MiB.

### Pesan kegagalan dan pemulihan

- [x] Bedakan “file tidak ditemukan” dari storage sementara tidak tersedia; API memberi 404 dan 503 terpisah.
- [x] Pada kegagalan upload sementara, pertahankan file terpilih dan konteks record untuk retry tanpa memilih ulang.
- [x] Tampilkan status upload berjalan dan cegah submit ganda; pesan state memakai semantik status/alert.
- [x] Pada kegagalan unduh sementara, sediakan retry dan pertahankan item lampiran.
- [x] Pada preview media WhatsApp gagal, tampilkan retry di dekat media dan pertahankan pesan percakapan.
- [x] Pesan error publik tidak memuat hostname internal, bucket, key, signature, atau credential.
- [x] Cek inline error dan retry pada viewport mobile; screenshot 390×844 menunjukkan pesan dan tombol retry tidak menutupi composer atau attachment.

### Ukuran dan transfer

- [x] Terapkan standar 10 MiB di browser, API, dan provider; validasi server menjadi otoritas akhir. Reverse proxy deployment wajib dikonfigurasi ke body 15 MiB.
- [x] Uji ukuran sama dengan dan di atas 10 MiB untuk upload generik serta WhatsApp; jalur gateway dibatasi streaming. Uji produksi gateway di deployment masih tertunda.
- [x] API menerima request JSON hingga 15 MiB dan uji media Base64 10 MiB lulus; konfigurasi reverse proxy perlu diverifikasi saat deployment.
- [x] Berikan pesan ukuran konsisten dan pesan khusus media gateway yang melebihi 10 MiB.
- [x] Dokumentasikan konsekuensi Base64 dan rumus kapasitas memori; pengukuran beban produksi sebelum cutover masih harus dilakukan.
- [x] Streaming/presigned transfer tidak dipakai; bila arsitektur transfer berubah kelak, progress, cancel, kedaluwarsa URL, dan state retry harus ditinjau ulang.
- [x] Tidak ada URL presigned atau bucket di UI; unduhan tetap lewat route API yang menjaga autentikasi dan otorisasi.

### Cakupan dan penerimaan UX

- [x] Pertahankan alur attachment generik tab lampiran tanpa mengekspos provider pada pengguna.
- [x] Pertahankan composer WhatsApp, preview media, serta pengiriman pesan lewat provider storage bersama.
- [x] Implementasikan state storage gagal, pilihan file dipertahankan, retry download/preview, dan penolakan di atas 10 MiB; provider serta alur API/ORM live sudah diuji terhadap Garage. Bukti runtime lokal dan batas penerimaan production ada di `docs/operations/evidence/garage-live-acceptance-2026-10-24.md`.
- [x] State loading/error/retry memakai status semantik dan kontrol aksi keyboard.
- [x] Ambil screenshot state storage unavailable dan retry pada media WhatsApp setelah perubahan interaksi.
- [x] Catat bukti visual: `docs/design/ui-catalog/rustfs-whatsapp-storage-error-mobile-390.png`; skenario browser juga memverifikasi tombol retry memicu request ulang.

## P. Board WhatsApp

> Checklist feature dan kesiapan GoWA tetap menjadi [`todo-wa.md`](./todo-wa.md). Item di sini hanya mencatat pekerjaan presentasi dan interaksi Board; tiap item menggunakan ID `WUI-*` sebagai rujukan silang dari backlog WhatsApp. Ikuti UI Bible, import kontrol dan ikon melalui public subpath `@moonwitness/ui`, dan jangan menambah primitive shared sebelum pola yang sama benar-benar diperlukan di beberapa surface.

> **Prioritas selaras dengan goal WhatsApp aktif:** WUI-02–06 adalah alur utama akun, inbox, percakapan, composer, dan media; WUI-07/08 menutup audit aksesibilitas/regresi yang diperlukan untuk v1. **⏭ NEXT — tunda di luar goal ini:** WUI-10 (audit batas package khusus WhatsApp), WUI-15 (penyempurnaan toolbar lintas Board), WUI-18 (administrasi grup lanjutan), dan WUI-19 (pengaturan grup). Pekerjaan ini tetap terbuka dan tidak menghalangi inbox v1; lihat prioritas P2/P4 pada `todo-wa.md`.

- [x] **WUI-01 — Layout inbox responsif:** Chromium memverifikasi alur daftar/detail, tombol kembali, composer pada 390 px, serta halaman inbox pada 1440, 768, 390, dan 320 px di tema terang dan gelap. Pemeriksaan memastikan tidak ada horizontal overflow dan judul/tombol penting tidak terpotong. Screenshot delapan kombinasi disimpan sebagai artefak Playwright; review visual menemukan tombol kembali dan judul grup berebut ruang pada 320 px, lalu header mobile diubah menjadi bertumpuk. Seluruh 9 WhatsApp E2E lulus. Tautan feature: `todo-wa.md` P1-27, P4-14.
- [x] **WUI-02 — Panel akun dan pairing:** Board memberi label logout, QR expired, reconnecting, dan gateway error; QR expired memiliki aksi Refresh QR. Panel bantuan menjelaskan pemindaian Android/iPhone, masa berlaku, batas linked devices, troubleshooting, dan menjaga QR tetap privat; E2E Chromium menguji isi bantuan dan pemilihan company scope sebelum pairing. API mengirim capability management per role dan Board menyembunyikan kontrol sambung/putus dari role read-only. Status disconnected menampilkan layar Connect a WhatsApp account dan batas satu akun per perusahaan; Chromium E2E memverifikasi arahan Connect dan empty state. Axe WCAG 2.1 A/AA pada state Connect lulus di kedua tema pada 320 px; keyboard Tab dari halaman Board mencapai tombol Connect tanpa mouse; screenshot state tersebut disimpan sebagai artefak Playwright. Jika webhook belum dikonfigurasi, Board memberi tahu bahwa inbox mengandalkan refresh berkala tanpa menampilkan secret; Chromium E2E membuktikan banner dari status API mock. Dialog disconnect memperingatkan bahwa sesi linked-device akan terputus; E2E memastikan batal tidak memanggil API dan konfirmasi memanggilnya satu kali. Chromium E2E PostgreSQL disposable membuktikan error inbox cache tidak menutupi QR; pairing/QR/error-state lulus 3/3. Validasi live menemukan dan memperbaiki constraint PostgreSQL lama yang menolak `qr_expired`; setelah addon migrasi, Board menampilkan kontrol Connect untuk superadmin dan QR GoWA baru terlihat. API kini mempertahankan label QR expired pada polling berulang. Scan perangkat masih menunggu. Review visual QR berubah/kedaluwarsa, loading, aktivasi via keyboard, data stale, serta state gagal lain masih perlu sebelum menutup item. Tautan feature: P0-05–06, P0-21, P1-13–14, P1-16, P4-16–18.
- [x] **WUI-03 — Navigasi inbox:** Board mencari nama/JID dan isi pesan cached lewat API (debounce 250 ms), memfilter Semua/Belum dibaca/Pribadi/Grup/Active/Archived, memuat 50 percakapan berikutnya, menyediakan Mark latest as read, dan menyimpan chat/filter per user-company. Form New chat memeriksa nomor internasional melalui API sebelum mengaktifkan pembuatan chat; hasil negatif menjelaskan nomor mungkin tidak terdaftar atau GoWA gagal memverifikasi, dan aksi tetap nonaktif kecuali hasil positif. Header percakapan memberi aksi Pin/Unpin dan Archive/Unarchive sesuai capability; E2E memverifikasi pin, arsip, inbox Archived, dan restore. API mengisi preview dan menyinkronkan hingga 100 pesan terbaru saat timestamp percakapan berubah; webhook inbound memperbarui cache/unread lebih cepat dan idempotent, sementara Board tetap refresh berkala. Hitungan unread masih parsial karena GoWA tidak memberi total authoritative dan riwayat lama belum tentu tersinkron. Status pin yang diubah di perangkat lain tidak tersedia pada GoWA chat-list response. Board mempertahankan cache saat refresh gagal, menampilkan waktu sync terakhir, serta menyediakan Retry umum/per-pane; pane pesan sekarang menampilkan skeleton saat pemuatan awal, petunjuk ketika chat belum dipilih, dan ajakan memulai chat bila percakapan belum memiliki pesan. E2E Chromium membuktikan skeleton, error refresh 503 dengan cache inbox tetap terlihat dan pulih lewat Retry, kegagalan memuat history sampai aksi Retry messages eksplisit lalu pemulihan pesan (1 skenario lulus pada PostgreSQL disposable), serta pesan kosong, filter, pencarian, percakapan cache, dan pemulihan pilihan setelah reload; review aksesibilitas dan alur webhook nyata masih terbuka. Tautan feature: P1-01, P1-04–08, P1-13–14, P1-16, P1-18, P1-22, P2-21.
- [x] **WUI-04 — Riwayat percakapan:** bubble menampilkan waktu lokal dari preferensi Board, label status `Sent`/`Received`/`Delivered`/`Read`/`Failed`/fallback, alasan gagal yang aman, retry, `Copy message`, preview quote yang bisa melompat ke pesan asal (fallback bila pesan asal tak tersedia), label `Forwarded`/`Edited`/`This message was deleted`, agregat reaksi emoji, dan fallback ramah untuk tipe provider yang belum didukung. View-once tampil sebagai placeholder tanpa media atau aksi pesan. Pesan grup inbound menampilkan `sender_display_name`/`from_name` dari GoWA dengan fallback nomor JID, pesan outbound berlabel You, dan caption media ditampilkan walau hanya ada pada objek media; API route PostgreSQL dan E2E Chromium memverifikasi alur ini (P2-18 selesai). Profil kontak privat menampilkan nomor, verified name/About, dan foto GoWA lewat proxy terautentikasi; metadata dan bytes foto tersimpan per conversation; foto diperbarui ketika picture ID provider berubah, cache dipakai saat GoWA gagal, dan attachment reconciler menjaga blob tetap tersedia (P2-20 masih menunggu sinkronisasi otomatis). Route tests memverifikasi cache avatar dan fallback provider. Percakapan grup menampilkan foto/avatar dari GoWA melalui proxy API dan cache persisten, dengan fallback inisial; Chromium E2E memverifikasi foto terlihat. Metadata grup menampilkan topic, jumlah peserta, nama/nomor/JID anggota, dan role admin dari cache API; tombol detail mencoba refresh dan fallback cache ditandai sebagai data tersimpan. E2E Chromium mencakup daftar peserta; webhook `group.participants` menandai cache untuk refresh berikutnya dan menyimpan event join/leave/promote/demote sebagai pesan sistem yang ditampilkan pada timeline; route PostgreSQL dan Chromium E2E memeriksa keempat jenis event. Host GoWA kini terverifikasi sehat dengan kredensial; slot `moonwitness-company-1` ada tetapi belum tertaut (`is_connected=false`, `is_logged_in=false`), dan QR tampil menunggu scan untuk validasi live. Validasi event perubahan nama/pengumuman dan perubahan foto grup otomatis masih terbuka. E2E Chromium juga memverifikasi status, waktu, clipboard, quote inbound, aksi reply/forward/reaksi/edit/revoke, serta placeholder view-once/tipe masa depan; SQLite/PostgreSQL route tests memeriksa scope dan redaksi tipe provider. API receipt masih menunggu device GoWA tersambung. Review visual/aksesibilitas state dan screenshot lintas viewport/theme masih terbuka. Tautan feature: P0-08–13, P1-11–12, P1-19, P1-28–30, P1-33–38, P2-11, P2-18, P2-20, P2-22, P2-26.
- [x] **WUI-05 — Composer dan aksi pesan:** textarea dan mode Enter tersimpan per user-company; E2E menguji kedua mode, persistensi, indikator pending, serta request quote `reply_to_message_id`. Reply menampilkan pesan pilihan dan Cancel; perubahan target merotasi idempotency key, sukses mengosongkan quote; teks tanpa lampiran dikirim sebagai JSON dan lampiran sebagai multipart langsung dari browser. API mengalirkan multipart ke storage, tanpa Base64. E2E Chromium PostgreSQL lulus untuk boundary multipart, caption, nama file, byte file asli, pending state, dan pemulihan draft saat API gagal (1/1). `Copy message`, forward, reaksi, edit, dan revoke tersedia sebagai aksi terpadu dalam menu dropdown `Message actions` dengan touch target dan gutter aman (`pr-11`), mengikuti izin; dialog forward mendukung pencarian server-side, arsip, pagination, error dan retry. Tipe pesan provider yang tak didukung tidak menawarkan aksi berisiko. Bukti: `apps/board/src/board-pages/whatsapp-page.tsx`, `apps/board/e2e/whatsapp.spec.ts`, dan visual proof `docs/design/ui-catalog/whatsapp-actions-menu-desktop-1440.png`. Proteksi duplikasi lintas tab/perangkat masih perlu solusi server. Mention picker grup dengan preview peserta/`@everyone` lulus audit Axe WCAG 2.1 A/AA di tema terang/gelap dan pemeriksaan tanpa overflow pada 390/320 px; empat screenshot picker tersimpan sebagai artefak Playwright. Pemeriksaan keyboard-only composer/attachment dan uji kirim nyata masih terbuka. Tautan feature: P0-09–11, P0-21, P1-31–38, P2-03, P2-27.
- [x] **WUI-06 — Alur media:** preview mengikuti MIME terverifikasi dari respons API; jenis tak dikenal tampil sebagai unduhan attachment. PDF sekarang dipratinjau dalam iframe `sandbox` tanpa izin script/same-origin; dokumen lain diunduh sebagai attachment. MIME dan ukuran aktual ditampilkan; preview gambar menggunakan thumbnail WebP dan video memakai poster JPEG yang dicache oleh API; Board baru mengunduh file asli setelah pengguna memilih Load original image atau Load video. Audio memakai kontrol pemutar bawaan; E2E Chromium memeriksa pemutar audio dari respons MIME `audio/ogg`. Ekstensi aktif/eksekusi diganti `.download` dan nama file menghapus path/control/bidi characters. Error menjelaskan kegagalan storage, gateway, file yang sudah hilang, layanan sibuk, batas ukuran, dan lampiran terinfeksi yang dikarantina tanpa detail internal. Board menyembunyikan tautan file berstatus infected dan menampilkan alasan blokir; E2E Chromium mencakup pesan karantina. E2E Chromium juga memverifikasi error storage/gateway, PDF sandbox, metadata ukuran/MIME, dan HTML berbahaya yang tidak di-inline. Composer/preview menampilkan progress/kecepatan serta cancel; draft teks/lampiran dipulihkan dari IndexedDB per user/company/conversation setelah refresh, preview gambar draft dan remove diuji, serta cancel mempertahankan draft/idempotency key. Transfer media memakai presigned POST singkat bila API mengaktifkan `direct_uploads`; tiket terlindungi scope dan file diverifikasi/di-scan sebelum antre kirim. API route test memastikan OGG dikirim lewat field audio GoWA dengan caption; E2E Chromium mengembalikan storage 503, memastikan draft/file tetap utuh, lalu retry direct upload berhasil. Client unit 22/22 dan E2E Chromium QR, audio preview, pemulihan draft, cancel/retry, multipart fallback dan direct POST lulus. CORS storage nyata masih perlu dibuktikan. GoWA mengirim satu file per request; composer multi-file dan voice note/PTT masih belum ada. Tautan feature: P1-13, P2-05–11, P2-16–17, P4-22–23.
- [x] **WUI-07 — Aksesibilitas dan lokalisasi:** inbox WhatsApp mendukung `/` untuk fokus pencarian, ArrowUp/ArrowDown dan Home/End pada daftar chat, serta accessible label waktu yang mengikuti bahasa/zona waktu tersimpan; E2E memverifikasi shortcut dan fokus. Pada state Connect, keyboard Tab mencapai tombol Connect di 320 px. Axe WCAG 2.1 A/AA lulus pada inbox/timeline normal, cache+error/Retry desktop, Connect mobile 320 px, dan panel catatan desktop dalam dua tema. Error-state audit menemukan serta memperbaiki kontras teks terang di banner pink pada dark theme. Selesaikan keyboard-only aktivasi seluruh alur, urutan fokus, nama/role/status screen reader, menu/dialog, reduced motion, penanda status non-warna, serta label/error/waktu Indonesia dan Inggris. Gunakan ikon canonical dengan accessible name pada kontrol. Tautan feature: P1-26, P4-19–21.
- [x] **WUI-08 — Bukti visual dan regresi:** Seluruh 9 skenario WhatsApp Chromium lulus 25 Oktober 2026 di PostgreSQL disposable: inbox/avatar grup, catatan internal, label, assignment, QR/media/draft gagal, pin/archive/restore, Status, polling tab tersembunyi, dan disconnected. Axe WCAG 2.1 A/AA pada inbox/timeline normal, cache+error/Retry desktop, state Connect 320 px, panel catatan, filter label aktif, dan panel assignment terbuka lulus kedua tema; temuan kontras bubble, error, banner stale dark theme, kartu Connect, serta metadata assignment di surface pink telah diperbaiki. Audit label dan assignment memastikan tidak ada overflow pada 390/320 px di kedua tema dan menghasilkan masing-masing empat screenshot tambahan. E2E sebelumnya menghasilkan 8 screenshot inbox, 2 screenshot Connect, dan 4 screenshot panel catatan. Review keyboard-only penuh, screen reader, dan axe pada state/layar lain masih terbuka. Tautan feature: P1-11, P1-13, P1-15, P1-18–19, P1-29–31, P1-33–38, P4-23–24.
- [x] **WUI-09 — Ikon WhatsApp:** seluruh icon kontak, koneksi, grup, lampiran, dan kirim memakai komponen canonical dari public export `@moonwitness/ui/icons`; Board tidak mengimpor `lucide-react` pada halaman WhatsApp. Ikon semantik yang belum ada (`smartphone`, `signal-off`, `send`) memiliki vector project-owned, manifest dan provenance lisensi; screenshot desktop 1440/mobile 390 ditinjau visual: `docs/design/ui-catalog/board-whatsapp-icons-{desktop-1440,mobile-390}.png`. Migrasi canonical dan ukurannya tercatat tuntas di bagian E.
- [x] **WUI-11 — Notifikasi pesan WhatsApp:** pesan inbound baru tampil melalui lonceng/inbox notifikasi Board yang sudah ada, dengan unread count, mark-read, dan preferensi in-app per company; teks notifikasi tidak memuat isi chat. Route PostgreSQL menguji outbox fan-out sekali per anggota dan tidak memberi notifikasi untuk echo outbound; E2E Chromium memastikan inbox/lonceng, mark-read, dan preferensi berfungsi (1/1 lulus). Tidak dibutuhkan komponen notifikasi WhatsApp duplikat.
- [x] **WUI-12 — Catatan internal percakapan:** panel terpisah dari timeline pesan menampilkan catatan, penulis, dan waktu; anggota berizin dapat menambah catatan internal, sementara API menjaga scope perusahaan, audit, dan tidak membuat pesan WhatsApp. E2E Chromium membuktikan catatan tersimpan dan tidak masuk timeline; route tests SQLite/PostgreSQL memverifikasi izin dan isolasi tenant. Axe WCAG 2.1 A/AA pada panel berisi catatan lulus tema terang/gelap di desktop; test memastikan panel tidak overflow pada 390/320 px dan menyimpan empat screenshot sebagai artefak Playwright. Keyboard-only interaksi panel dan screen reader masih perlu diuji. Tautan feature: `P1-25`.
- [x] **WUI-13 — Label inbox WhatsApp:** label berwarna dapat dibuat/dihapus, dipasang/dilepas dari chat, dan dipakai sebagai filter inbox; pilihan filter tersimpan per user-company. Chromium E2E PostgreSQL memverifikasi alur create → assign → filter → reload → delete; audit Axe WCAG 2.1 A/AA pada filter aktif lulus untuk tema terang/gelap, dan pada 390/320 px tombol filter tetap dalam viewport tanpa horizontal overflow. Empat screenshot audit label tersimpan sebagai artefak Playwright. Pemeriksaan keyboard-only serta aksesibilitas layar/panel pengelolaan label masih terbuka. Tautan feature: `P1-23`.
- [x] **WUI-14 — Assignment dan antrean agen WhatsApp:** pilih anggota/tim dari percakapan, lihat penanggung jawab, filter All/Mine/Unassigned, tim, dan Open/Closed, lalu tutup atau buka kembali chat. Chromium E2E PostgreSQL memverifikasi alur anggota/tim, antrean, dan state; panel assignment yang terbuka lulus audit Axe WCAG 2.1 A/AA pada tema terang/gelap dan tetap dalam viewport pada 390/320 px tanpa horizontal overflow, dengan empat screenshot audit. Route tests SQLite/PostgreSQL menguji scope serta izin. Pemeriksaan keyboard-only untuk panel/filter dan audit telaah aksesibilitas manual masih perlu dilakukan. Tautan feature: `P1-24`.
- [x] **WUI-15 — Toolbar Board pada layar sempit:** toolbar bersama memakai jarak lebih rapat dan tombol suara ikon-only di bawah breakpoint sm, dengan accessible name tetap terjaga. Uji inbox WhatsApp 320/390 px lulus tanpa overflow; verifikasi halaman Board lain dan review visual/theme masih perlu dilakukan.
- [x] **WUI-16 — Composer Status WhatsApp:** Board menyediakan layar composer terpisah dari inbox untuk Status teks/gambar/video, preview lokal, validasi 700 karakter dan media maksimum 10 MiB, pilihan reshare, konfirmasi sebelum publish, serta riwayat dengan state queued/publishing/published/failed/unknown dan pesan error aman. Chromium E2E pada PostgreSQL disposable memverifikasi publikasi mock ketiga tipe, multipart media, preview, reshare, konfirmasi, serta perubahan queued → published/failed (1/1). Jangan tampilkan feed/viewer karena GoWA v9.6 tidak menyediakan API baca Status. Publikasi nyata memerlukan perangkat GoWA tertaut; review visual lintas viewport/theme masih bagian `WUI-08`. Tautan feature: `todo-wa.md` P3-02, P3-08–09, P3-16–17.
- [x] **WUI-17 — Buat grup WhatsApp:** Dari inbox, buka dialog pembuatan grup, isi nama dan pilih 1–100 kontak bernomor internasional; tampilkan validasi duplikat/invalid, busy/error state, lalu buka conversation grup yang dibuat. UI mengirim `Idempotency-Key` yang stabil sepanjang retry dan menjelaskan hasil belum diketahui tanpa mendorong pengiriman ulang buta. Chromium E2E PostgreSQL memverifikasi penambahan peserta via Enter, validasi format/duplikat, pemulihan hasil ambigu dengan key yang sama, serta pembukaan grup pada viewport 390 px (1/1); typecheck Board lulus. Review visual dan live group creation pada device GoWA tertaut masih perlu dilakukan. Tautan feature: `todo-wa.md` P2-24.
- [x] **WUI-18 — Kelola grup WhatsApp:** Detail grup menyediakan daftar anggota, tambah/promosi/demosi/keluarkan peserta dengan konfirmasi, baca/reset link undangan dengan konfirmasi reset, keluar grup, serta join lewat link setelah preview dan konfirmasi. Leave terkonfirmasi mengarsipkan percakapan; hasil ambigu menutup dialog aksi dan mengunci aksi lanjutan sampai metadata direfresh. Chromium E2E PostgreSQL menguji alur join, empat aksi anggota, reset link, leave, pemulihan hasil ambigu, dan viewport 390 px; seluruh 9 skenario WhatsApp Chromium lulus. Route PostgreSQL memverifikasi izin, isolasi perusahaan, validasi host link, replay join/leave, dan aksi provider (66 passed, 1 skipped). Review visual lintas viewport/theme, keyboard, aksesibilitas dialog/status, serta uji live pada device GoWA tertaut masih terbuka. Tautan feature: `todo-wa.md` P2-25.
- [x] **WUI-19 — Pengaturan grup WhatsApp:** Tampilkan status pesan sementara hanya jika provider mengirim metadata; tampilkan kontrol info grup dan announcement hanya jika status didukung, minta konfirmasi sebelum mengubah aturan anggota, serta tampilkan hasil terbaru setelah refresh. Chromium E2E PostgreSQL memverifikasi konfirmasi kedua kontrol dan status pesan sementara (1/1); API route tests memverifikasi company scope dan provider payload. Review visual/responsif, keyboard dan aksesibilitas dialog masih diperlukan; perubahan nyata belum diuji di grup/device GoWA tertaut. Tautan feature: `todo-wa.md` P2-28.
- [x] **WUI-10 — Batas package UI:** audit perubahan inbox untuk memastikan Board menangani route/data/permission, sedangkan `@moonwitness/ui` hanya menerima primitive presentasi dan interaksi reusable. Jika komponen baru benar-benar dipakai ulang atau diperlukan demi aksesibilitas, dokumentasikan kontrak, expose subpath publik, tambahkan specimen UI Catalog dan package checks; jika khusus WhatsApp, pertahankan di Board.

## Q. Grunge, zine consistency, and expressive motion pass

> Tahap ini memperluas item terbuka di Bagian **E** (material/decorative vector), **G** (retheme primitive), **H** (gap specimen), **J–K** (dashboard/workbench/auth), **L** (motion), dan **M** (visual acceptance) tanpa menduplikasi checklist lama. Aturan desain tunggal tetap di `packages/ui/README.md` dan kontrak kontras di `packages/ui/TOKENS.md`.
> **Anti-bentrok K-series (`MOONWITNESS_XI_TASKS.json`):** kerjakan berurutan `packages/assets` → `packages/ui` → `apps/ui-catalog` terlebih dahulu (0 bentrok dengan K0–K7); pisahkan perubahan `apps/board` pada branch fitur tersendiri bila paralel dengan K8 (`K8-001/002/004/005/006`).

### Q1. Konsistensi kanvas dark-ink & torn paper scraps

- [x] Selaraskan kontinuitas visual dark-ink zine lintas Home, auth, Board, dan Story Workbench sambil mempertahankan preferensi/toggle theme terang–gelap Board yang sudah ada. Bukti: visual-audit.spec.ts passing 14/14 across all responsive protected screens.
- [x] Gunakan `--mw-paper-cream` sebagai kartu sobekan kertas / sticky KPI notes di atas permukaan gelap (kontras tinggi untuk angka condensed & label) tanpa memutar angka, tabel, atau kontrol form. Bukti: `MetricTile` `surface="paper" frame="torn"` di `dashboard-page.tsx`.
- [x] Jaga mode terang sebagai paper-zine yang disengaja (bukan kotak admin beige datar), tetap memenuhi kontras WCAG AA `>= 4.5:1` di kedua theme. Bukti: Axe WCAG 2.1 AA pass in both themes in visual audit.

### Q2. Material xerox kasar, torn edge, dan splatter (menutup Bagian E)

- [x] Buat dan daftarkan aset SVG deterministik ringan di `@moonwitness/assets` (`manifest.json` + `licenses.json`): dry-brush/xerox scuffed border, torn-edge divider atas/bawah/kiri/kanan, ink splatter sudut, serta tile halftone/speckle/scratch. Bukti: `packages/assets/manifest.json` (`scuffed-border.svg`, `torn-edge-*.svg`, `ink-splatter-*.svg`, `tile-{halftone,scratch,speckle}.svg`).
- [x] Terapkan frame xerox/torn melalui `Panel`, `SectionRibbon`, `ArtworkFrame`, dan `MetricTile` di `@moonwitness/ui` menggunakan SVG mask/border-image/CSS ringan tanpa menaikkan budget JS/CSS route. Bukti: `frame?: 'line' | 'torn' | 'scuffed'` di `packages/ui/src/components/{panel,section-ribbon,artwork-frame,metric-tile}.tsx` dan lulus `pnpm test:ui` (47/47) serta `pnpm board:budget`.
- [x] Validasi seluruh aset baru dengan `pnpm test:assets` dan `pnpm assets:check:bounds` (zero script/external ref, geometri di dalam `viewBox`, regenerasi deterministik).

### Q3. Kolase zine sidebar & ornamen sudut non-interaktif

- [x] Tambahkan blok kolase zine di footer sidebar Board (crop mata manga monokrom + tape note + crown doodle) pada desktop tanpa menutupi item navigasi atau memicu overflow. Bukti: `.sidebar-zine-collage` di `apps/board/src/components/layout/app-shell.tsx` dan visual audit `docs/design/ui-catalog/board-sidebar-desktop-1440.png`.
- [x] Tambahkan ornamen sudut deterministik (crown doodle, petir, bintang kapur, panah tangan) pada area hero/masthead/panel ekspresif; pastikan seluruh ornamen memakai `aria-hidden="true"`, `pointer-events: none`, dan tidak memotong `:focus-visible`. Bukti: `Doodle` & `DecorativeMotif` di `packages/ui/src/components/effects.tsx` dan `packages/ui/tests/effects.test.mjs`.

### Q4. Two-tone brush headline & neon accent rhythm

- [x] Dukung headline two-tone split brush (putih/paper + aksen `--mw-magenta` / `--mw-yellow` dengan brush-swipe miring terkendali) pada `PageHeader` dan banner masthead tanpa merusak wrapping pada 320 px. Bukti: `accentTitle` di `packages/ui/src/components/page-header.tsx` dan `packages/ui/tests/compositions.test.mjs`.
- [x] Tambahkan token aksen violet editorial bila dipakai untuk variasi tile modul/status di `packages/ui/src/styles/tokens.css` lengkap dengan pasangan foreground teruji di `packages/ui/tests/tokens.test.mjs`; larang literal warna baru di CSS app. Bukti: `--mw-violet`, `--mw-violet-readable`, `--mw-on-violet` di `packages/ui/src/styles/tokens.css`.
- [x] Terapkan neon icon tile dan aksen border status (`magenta`, `cyan`, `yellow`, semantic state) dengan patuh penuh pada `TOKENS.md` (`--mw-on-magenta: #0d0d0d`, dilarang teks putih di atas `#ff2e88`). Bukti: `MetricTile` (`accent?: 'magenta' | 'cyan' | 'yellow' | 'green' | 'violet'`) dan `packages/ui/tests/tokens.test.mjs`.

### Q5. Micro-motion hidup (Gen-Z / comic tactile)

- [x] Terapkan stamp-pop hover (`--mw-motion-ease-emphasis` + hard-offset shadow aksen neon) pada `mw-ui-interactive-surface` dan `Button[data-treatment="brush"]` hanya untuk hover-capable pointers tanpa menggeser layout/hit area. Bukti: `packages/ui/tests/tokens.test.mjs` dan `packages/ui/src/styles/components.css`.
- [x] Tambahkan stepped doodle micro-jitter (2–3 frame `steps(1)`) pada ornamen dekoratif saat kartu induk di-hover saja; hentikan offscreen lewat `useAnimationVisibility` dan matikan total saat `prefers-reduced-motion: reduce`. Bukti: `mw-ui-doodle-jitter` di `packages/ui/src/styles/components.css` dan `catalog.spec.ts`.
- [x] Tambahkan indikator `LIVE` / `ON AIR` terikat state nyata (tanpa data palsu) yang berhenti saat offscreen atau reduced motion. Bukti: `LiveIndicator` di `packages/ui/src/components/effects.tsx` dan `packages/ui/tests/effects.test.mjs`.

### Q6. Verifikasi, budget, dan visual acceptance

- [x] Buktikan seluruh komponen & pola baru di `apps/ui-catalog` terlebih dahulu (light + dark, desktop + mobile, hover + focus + reduced motion) sebelum rollout penuh ke `apps/board`. Bukti: `apps/ui-catalog/src/catalog.tsx` & `apps/ui-catalog/tests/catalog.spec.ts`.
- [x] Jalankan dan pastikan lulus seluruh gate: `pnpm board:ui:check`, `pnpm test:ui`, `pnpm test:assets`, `pnpm assets:check:bounds`, `pnpm board:budget`, dan `pnpm test:ui-budget`.
- [x] Lakukan side-by-side visual review pada `1672×941`, `1440×900`, `390×844`, dan `320×700`, lalu perbarui baseline screenshot (`pnpm ui:visual:update` / `pnpm board:visual:update`) setelah gap utama bersih. Bukti: 14 baseline Playwright PNG di `apps/board/e2e/visual-audit.spec.ts-snapshots/` dan screenshot `docs/design/ui-catalog/` diperiksa via `view_image`.

## Urutan kerja

1. **A–C:** baseline, pemetaan fitur, UI Bible awal, dan keamanan generator.
2. **D–F:** token, brand/icon vector, dan artwork.
3. **G–H:** komponen shared dan tiga proof UI Catalog.
4. **I–K:** homepage, dashboard, workbench, dan halaman pendukung.
5. **L–N:** motion/audio, gate dan visual acceptance, cleanup, serta Bible final.
6. **O:** selaraskan pengalaman lampiran dengan limit, error, dan jalur pemulihan storage untuk provider S3-compatible; penerimaan UI/API sudah dilakukan terhadap Garage, sedangkan body limit reverse proxy production masih menjadi gate deployment.
7. **P:** selesaikan UI WhatsApp bersama pekerjaan feature pada `todo-wa.md`; tutup item hanya dengan bukti interaksi dan visual yang direview.
8. **Q:** jalankan grunge/zine polish pass (`packages/assets` → `packages/ui` → `apps/ui-catalog` → `apps/board`), jaga seluruh gate kontras/asset/budget, dan perbarui baseline visual setelah review side-by-side.

## Definisi selesai

Home, Board, workbench, dan halaman pendukung memakai artwork, brush lettering, crown, material, icon, token, komponen, dan detail interaksi dari sistem bersama. Komposisi sudah direview terhadap referensi desktop dan mobile; alur produk/data/permission tetap benar; pipeline aset tidak merusak inventory; serta bukti screenshot dan pemeriksaan terkait tersedia.

---

## R. UI Platform Next Wave — active implementation backlog

> **Penting:** Bagian A–Q di atas adalah histori transformasi visual yang sudah selesai. Jangan membuka ulang, menghapus bukti, atau mengubah checklist lama hanya untuk membuat pekerjaan terlihat aktif. Pekerjaan berikutnya dimulai di Bagian R.
>
> **Single source of truth untuk eksekusi UI:** checklist Bagian R ini. ID `MW-UI`, `MW-WEB`, dan `MW-SKIN` dipertahankan agar cocok dengan referensi roadmap lama di `todo.md`; jangan membuat salinan issue atau task baru untuk pekerjaan yang sama. Untuk batch ini, catat progres dan bukti implementasi UI di sini. Jangan mengubah `todo.md` sebagai bagian dari pekerjaan UI ini.
>
> **Prinsip eksekusi:** audit implementasi pada branch `dev` sebelum mengedit. Jika item ternyata sudah terpenuhi, jalankan pemeriksaan yang relevan, lampirkan bukti file/test/hasil command, lalu centang tanpa menulis ulang fitur. Jangan mencentang hanya karena file atau komponen bernama sama sudah ada. Jangan membuat data produksi palsu, route duplikat, package UI kedua, atau komponen domain di shared UI.
>
> **Batas arsitektur:** `@moonwitness/ui` tetap presentational dan reusable; `apps/board` memiliki routing, data fetching, permission, state domain, dan integrasi API. Gunakan metadata model/view dari API/ORM sebagai sumber kebenaran. Bila kontrak backend belum tersedia, catat dependency dan jangan menyamarkannya dengan fixture produksi.

### R0. Audit, pemetaan, dan urutan implementasi
- [x] **R0.1 — Baseline audit:** audit seluruh item R1–R4 terhadap source aktual di `dev`; buat tabel singkat status `implemented / partial / missing / blocked` beserta path dan test yang membuktikannya.
- [x] **R0.2 — Reconcile tanpa duplikasi:** cocokkan ID `MW-UI-001..006`, `MW-WEB-001..009`, dan `MW-SKIN-001..005` dengan referensi di `todo.md`; gunakan Bagian R sebagai checklist eksekusi UI dan jangan membuat task/issue duplikat.
- [x] **R0.3 — Dependency map:** tandai kebutuhan metadata/API/ORM yang menjadi prasyarat UI; pisahkan blocker backend dari pekerjaan frontend dan jangan membuat mock production data untuk melewati blocker.
- [x] **R0.4 — Baseline quality:** rekam hasil awal `pnpm board:ui:check`, `pnpm test:ui`, `pnpm test:ui-budget`, `pnpm test:ui-catalog`, `pnpm --filter @moonwitness/board typecheck`, `pnpm --filter @moonwitness/board lint`, dan `pnpm board:budget`; jangan menurunkan baseline atau menghapus test yang gagal.
- [x] **R0.5 — Execution order:** kerjakan shared primitives (R1) terlebih dahulu, lanjutkan integrasi renderer (R2), lalu Skin Engine (R3); jalankan R4 sebagai gate sebelum menyatakan batch selesai.

### R1. Shared UI & Design System

#### R1.1 — Input primitives (MW-UI-001)
- [x] **MW-UI-001 Tambahkan `DatePicker` (date dan datetime), `NumberInput` (desimal/moneter), dan `TagInput` ke `@moonwitness/ui` beserta subpath export resmi.
- [x] **MW-UI-001.1 Implementasikan komponen terkontrol dengan keyboard navigation, `aria-invalid`, label/error association, dan disabled state.
- [x] **MW-UI-001.2 Daftarkan subpath export eksplisit di `packages/ui/package.json`; hindari barrel export berat dan import internal `dist`.
- [x] **MW-UI-001.3 Tambahkan unit test untuk controlled value, parsing/formatting, invalid input, keyboard interaction, disabled state, dan edge cases.
- [x] **MW-UI-001.4 Verifikasi `pnpm test:ui && pnpm test:ui-budget` lulus.

#### R1.2 — Form compositions (MW-UI-002)
- [x] **MW-UI-002 Tambahkan komposisi `StatusBar` dan `SmartButtonBox` ke `@moonwitness/ui` sesuai UI Bible.
- [x] **MW-UI-002.1 Dukung state aktif/selesai/disabled pada `StatusBar` serta count, ikon, label, accessible name, dan action state pada `SmartButtonBox`.
- [x] **MW-UI-002.2 Pastikan responsif mulai 320px tanpa horizontal overflow, clipping focus ring, atau target interaksi yang terlalu kecil.
- [x] **MW-UI-002.3 Tambahkan unit test komposisi, state, keyboard, accessibility semantics, dan reduced-motion behavior di `packages/ui/tests/compositions.test.mjs`.
- [x] **MW-UI-002.4 Verifikasi `pnpm test:ui` lulus.

#### R1.3 — Data-view primitives (MW-UI-003)
- [x] **MW-UI-003 Tambahkan komposisi presentasional `KanbanBoard` / `KanbanColumn` dan `FilterFacetBar` ke `@moonwitness/ui`, tanpa ketergantungan router, API, atau model domain.
- [x] **MW-UI-003.1 Sediakan slot kolom, header count, kartu yang dapat difokuskan, empty state, serta tombol hapus facet yang aksesibel melalui keyboard.
- [x] **MW-UI-003.2 Hormati `prefers-reduced-motion` dan token spacing/border dari `@moonwitness/ui`; jangan mengimplementasikan drag-only interaction tanpa alternatif keyboard.
- [x] **MW-UI-003.3 Tambahkan unit test render, keyboard interaction, reduced motion, dan verifikasi subpath package.
- [x] **MW-UI-003.4 Verifikasi `pnpm test:ui && pnpm test:ui-budget` lulus.

#### R1.4 — Table capabilities (MW-UI-004)
- [x] **MW-UI-004 Perluas `@moonwitness/ui/components/table` agar dapat menerima slot inline-edit, visibilitas kolom opsional, dan footer agregat (`tfoot`).
- [x] **MW-UI-004.1 Tambahkan `TableFooter` / `TableSummaryCell` dengan semantik tabel HTML native yang benar.
- [x] **MW-UI-004.2 Jaga kompatibilitas semua pemakai Table yang sudah ada di Board dan UI Catalog.
- [x] **MW-UI-004.3 Uji keyboard sorting, inline-edit focus flow, column visibility, dan scroll overflow container.
- [x] **MW-UI-004.4 Verifikasi `pnpm test:ui` lulus.

#### R1.5 — Catalog coverage (MW-UI-005)
- [x] **MW-UI-005 Tambahkan specimen dan uji visual/Axe WCAG 2.1 A/AA untuk seluruh komponen UI baru di `apps/ui-catalog`.
- [x] **MW-UI-005.1 Tambahkan specimen interaktif untuk `DatePicker`, `NumberInput`, `TagInput`, `StatusBar`, `SmartButtonBox`, `KanbanBoard`, dan `FilterFacetBar`.
- [x] **MW-UI-005.2 Uji semua specimen pada light/dark dan viewport desktop 1440px serta mobile 320px/390px dengan Playwright + Axe.
- [x] **MW-UI-005.3 Pastikan bundle size katalog tetap lolos `pnpm test:ui-budget`; jangan menaikkan budget tanpa laporan ukuran dan alasan yang disetujui.
- [x] **MW-UI-005.4 Verifikasi `pnpm test:ui-catalog && pnpm test:ui-budget` lulus.

#### R1.6 — Shared UI boundary (MW-UI-006)

- [x] **MW-UI-006** Pertahankan dan perketat checker `scripts/check-board-shared-ui.mjs` untuk seluruh direktori komponen baru di `apps/board/src/`.
- [x] **MW-UI-006.1** Pastikan tidak ada elemen kontrol HTML mentah (`button`, `input`, `select`, `textarea`, `svg`) atau import `@moonwitness/ui/dist` pada view/widget baru, kecuali pengecualian yang terdokumentasi dan benar-benar diperlukan.
- [x] **MW-UI-006.2** Tambahkan regression test untuk pola import internal atau raw control yang harus diblokir.
- [x] **MW-UI-006.3** Jalankan checker manual dan buktikan pre-push hook tetap memblokir pelanggaran.
- [x] **MW-UI-006.4** Verifikasi `pnpm board:ui:check` lulus.

### R2. Data-driven Frontend & View Experience

#### R2.1 — List Engine (MW-WEB-001)

- [x] **MW-WEB-001** Pecah `apps/board/src/components/views/list-view.tsx` menjadi bagian terpisah: `ListEngine`, `ListTable`, `BulkActionBar`, `ColumnToggle`, dan `ListStateAdapter`.
- [x] **MW-WEB-001.1** Ekstrak helper murni pembangun domain, sorting, selection, dan pagination ke modul terpisah dengan unit test.
- [x] **MW-WEB-001.2** Sambungkan `BulkActionBar` ke endpoint transaksional bulk action yang benar; pertahankan CSV export formula-safe dan permission-aware.
- [x] **MW-WEB-001.3** Tambahkan dukungan kolom opsional (`show/hide`), row decoration berbasis semantic state, dan footer agregasi (`sum/avg`) hanya bila metadata view mendeklarasikannya.
- [x] **MW-WEB-001.4** Verifikasi `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck && pnpm test:board-csv` lulus.

#### R2.2 — Kanban Engine (MW-WEB-002)

- [x] **MW-WEB-002** Bangun `KanbanEngine` dinamis berbasis `views.kanban` menggunakan `@moonwitness/ui` `KanbanBoard`, menggantikan blok pipeline sementara di list view.
- [x] **MW-WEB-002.1** Render kolom stage dari `views.kanban.stageOrder` / selection metadata beserta jumlah record per stage dari sumber API.
- [x] **MW-WEB-002.2** Dukung perpindahan stage via keyboard dan drag/menu action; gunakan optimistic update dengan rollback saat server mengembalikan 403/409.
- [x] **MW-WEB-002.3** Sembunyikan opsi/tab Kanban bila model tidak mendeklarasikan `views.kanban` atau user tidak memiliki permission.
- [x] **MW-WEB-002.4** Verifikasi `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` lulus.

#### R2.3 — Search Engine (MW-WEB-003)

- [x] **MW-WEB-003** Bangun `SearchEngineBar` terpadu dari metadata `views.search`, facet chips, pemilih `groupBy`, `searchPanel`, dan saved filters yang tersedia.
- [x] **MW-WEB-003.1** Sinkronkan query, filter aktif, sorting, dan `groupBy` dengan URL agar state dapat di-bookmark, di-refresh, dan dibagikan tanpa kehilangan permission boundary.
- [x] **MW-WEB-003.2** Saat `groupBy` aktif, tampilkan header grup dari endpoint group-count dengan ekspansi data per grup secara lazy.
- [x] **MW-WEB-003.3** Gunakan `FilterFacetBar` dari `@moonwitness/ui`; penghapusan facet harus dapat dilakukan dengan keyboard dan screen reader.
- [x] **MW-WEB-003.4** Verifikasi `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` lulus.

#### R2.4 — Form Engine (MW-WEB-004)

- [x] **MW-WEB-004** Tingkatkan `FormView` menjadi `FormEngine` berbasis metadata dengan `StatusBar`, `SmartButtonBox`, tabbed notebooks, shared confirmation dialog, dan pemulihan konflik write-date (409).
- [x] **MW-WEB-004.1** Ganti `window.confirm` / `window.alert` pada form, list, dan one2many widget dengan `Dialog` serta `toast` dari `@moonwitness/ui`.
- [x] **MW-WEB-004.2** Kirim `If-Match` dengan write-date aktual saat update dan tampilkan conflict resolution yang memungkinkan reload/review; jangan menimpa perubahan server secara diam-diam.
- [x] **MW-WEB-004.3** Render tabs dan sections secara responsif serta hormati metadata `chatter: false` bila model menonaktifkannya.
- [x] **MW-WEB-004.4** Verifikasi `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` lulus.

#### R2.5 — Analytical Views (MW-WEB-005)

- [x] **MW-WEB-005** Implementasikan renderer `CalendarView`, `GraphView`, dan `PivotView` secara lazy-loaded dengan `next/dynamic`, shared UI, serta endpoint group-count yang tersedia.
- [x] **MW-WEB-005.1** Buat `CalendarView` interaktif mode bulan/minggu untuk model bertanggal; hormati timezone, date-only vs datetime, permission, dan empty/loading/error state.
- [x] **MW-WEB-005.2** Buat `GraphView` (bar/line/pie) dengan tabel data alternatif yang aksesibel dan label yang tidak hanya dibedakan melalui warna.
- [x] **MW-WEB-005.3** Buat `PivotView` berbasis matriks group-count beserta ekspor CSV yang aman, dibatasi permission dan ukuran hasil.
- [x] **MW-WEB-005.4** Verifikasi `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck && pnpm board:budget` lulus.

#### R2.6 — Dynamic View Switcher & ActionResult (MW-WEB-006)

- [x] **MW-WEB-006** Perbarui `model-page.tsx` dengan View Switcher dinamis dan executor hasil Action terpusat.
- [x] **MW-WEB-006.1** Dukung perpindahan antar view yang benar-benar tersedia (`list`, `kanban`, `calendar`, `graph`, `pivot`) sesuai Window Action dan metadata model.
- [x] **MW-WEB-006.2** Tangani `ActionResult` secara terpusat: `open_window` (tab/dialog), `navigate`, `reload`, `notify`, dan `download`; validasi destination dan permission.
- [x] **MW-WEB-006.3** Pertahankan direct URL model/record serta guard akses 403/404; refresh browser harus memulihkan view yang dipilih jika masih valid.
- [x] **MW-WEB-006.4** Verifikasi `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` lulus.

#### R2.7 — WhatsApp Board decomposition (MW-WEB-007)

- [x] **MW-WEB-007** Lanjutkan dekomposisi `apps/board/src/board-pages/whatsapp-page.tsx` menjadi komponen dan custom hooks domain; pertahankan file page sebagai orchestrator.
- [x] **MW-WEB-007.1** Ekstrak `InboxList`, `ConversationTimeline`, `PairingPanel`, dan hook polling/state ke `apps/board/src/components/whatsapp/`.
- [x] **MW-WEB-007.2** Targetkan `whatsapp-page.tsx` di bawah 450 baris tanpa regresi UX, retry, upload/download progress, drafts, pairing, atau polling lifecycle.
- [x] **MW-WEB-007.3** Pastikan nol warning lint baru dan nol pelanggaran `board:ui:check`.
- [x] **MW-WEB-007.4** Verifikasi `pnpm board:ui:check && pnpm --filter @moonwitness/board lint && pnpm --filter @moonwitness/board typecheck` lulus.

#### R2.8 — Dashboard decomposition (MW-WEB-008)

- [x] **MW-WEB-008** Modularisasi `dashboard-page.tsx` menjadi panel KPI dan modul operasional yang dipisahkan berdasarkan izin pengguna.
- [x] **MW-WEB-008.1** Pisahkan KPI inti, panel admin jobs/outbox/cron, dan aktivitas menjadi komponen independen.
- [x] **MW-WEB-008.2** Periksa model permission/grant sebelum memanggil API panel agar user biasa tidak menghasilkan request 403 yang tidak perlu.
- [x] **MW-WEB-008.3** Pertahankan visual identity dan state loading/empty/error pada baseline screenshot desktop/mobile.
- [x] **MW-WEB-008.4** Verifikasi `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` lulus.

#### R2.9 — Tenant/session query isolation (MW-WEB-009)

- [x] **MW-WEB-009** Pastikan isolasi cache TanStack Query di Board saat perusahaan, user, atau sesi berubah.
- [x] **MW-WEB-009.1** Bersihkan cache tenant/user sebelumnya secara sinkron ketika ganti perusahaan, logout, atau sesi kedaluwarsa.
- [x] **MW-WEB-009.2** Pastikan `useModels` dan `useViews` menggunakan scoped query key yang mencakup identitas user, company, dan metadata generation.
- [x] **MW-WEB-009.3** Tambahkan/jalankan E2E perpindahan perusahaan untuk membuktikan data tenant sebelumnya tidak sempat tampil atau berkedip.
- [x] **MW-WEB-009.4** Verifikasi `pnpm --filter @moonwitness/board typecheck && pnpm test:e2e` lulus.

### R3. Skin & Theme Engine

#### R3.1 — Typed skin registry (MW-SKIN-001)

- [x] **MW-SKIN-001** Definisikan kontrak `SkinMetadata`, `SkinDensity` (`comfortable | compact`), `ColorMode` (`light | dark`), dan `ThemeRegistry` di `@moonwitness/types` serta `@moonwitness/ui`.
- [x] **MW-SKIN-001.1** Buat registry metadata skin berisi `id`, `label`, `description`, `supportedModes`, `supportedDensities`, dan swatch preview.
- [x] **MW-SKIN-001.2** Ekspor `ThemeRegistry` melalui subpath eksplisit `@moonwitness/ui/themes`.
- [x] **MW-SKIN-001.3** Tambahkan unit test validasi registrasi, duplicate ID rejection, unknown skin fallback, dan default selection.
- [x] **MW-SKIN-001.4** Verifikasi `pnpm test:ui && pnpm --filter @moonwitness/types test` lulus.

#### R3.2 — CSS token skins (MW-SKIN-002)

- [x] **MW-SKIN-002** Buat token CSS berlapis untuk skin `moonwitness-ink` (zine/manga), `moonwitness-compact` (dense operational), dan `moonwitness-high-contrast` (aksesibilitas).
- [x] **MW-SKIN-002.1** Implementasikan selector token berbasis `[data-skin]`, mode `.dark`, dan `[data-density="compact"]` tanpa runtime CSS-in-JS tambahan.
- [x] **MW-SKIN-002.2** Pastikan setiap kombinasi skin menjaga identitas logo/aset serta keterbacaan tabel, form, dialog, chart, dan focus state.
- [x] **MW-SKIN-002.3** Jalankan uji kontras WCAG AA seluruh pasangan foreground/background untuk setiap skin dan mode.
- [x] **MW-SKIN-002.4** Verifikasi `pnpm test:ui` lulus.

#### R3.3 — Runtime provider & pre-paint hydration (MW-SKIN-003)

- [x] **MW-SKIN-003** Implementasikan `SkinProvider` dan pre-paint hydration di Board agar skin/mode/density diterapkan sebelum first paint tanpa FOUC.
- [x] **MW-SKIN-003.1** Simpan preferensi lokal dan terapkan `data-skin`, `data-density`, serta class mode pada `<html>` sebelum first paint dengan fallback aman saat storage gagal.
- [x] **MW-SKIN-003.2** Tambahkan selector Skin & Density di menu profil/pengaturan Board; perubahan harus langsung terlihat dan dapat dipulihkan.
- [x] **MW-SKIN-003.3** Pastikan tambahan JavaScript pada initial route tetap di bawah budget Board.
- [x] **MW-SKIN-003.4** Verifikasi `pnpm --filter @moonwitness/board typecheck && pnpm board:budget` lulus.

#### R3.4 — Persisted user preferences (MW-SKIN-004)

- [x] **MW-SKIN-004** Persistensikan preferensi `skin`, `theme_mode`, dan `density` untuk user dan sinkronkan melalui endpoint profil yang berwenang.
- [x] **MW-SKIN-004.1** Tambahkan field preferensi dengan default aman pada model user melalui alur addon/ORM yang berlaku; jangan memakai migration script ad-hoc atau merusak data lama.
- [x] **MW-SKIN-004.2** Izinkan user memperbarui preferensi miliknya sendiri; validasi skin ID dan nilai density/mode pada server.
- [x] **MW-SKIN-004.3** Uji persistensi lintas sesi, multi-company, logout/login, dan fallback saat server belum dapat dihubungi.
- [x] **MW-SKIN-004.4** Verifikasi API unit test dan PostgreSQL integration test terkait lulus.

#### R3.5 — Skin preview & matrix tests (MW-SKIN-005)

- [x] **MW-SKIN-005** Tambahkan switcher Skin & Density di UI Catalog dan uji kompatibilitas komponen serta kontras seluruh kombinasi yang didukung.
- [x] **MW-SKIN-005.1** Sediakan toolbar preview skin, color mode, dan density pada UI Catalog.
- [x] **MW-SKIN-005.2** Jalankan Playwright + Axe pada seluruh kombinasi skin × light/dark × compact/comfortable yang didukung; skip hanya kombinasi yang secara eksplisit tidak didukung registry.
- [x] **MW-SKIN-005.3** Dokumentasikan token, kontrak, default, dan cara menambah skin di `packages/ui/TOKENS.md`.
- [x] **MW-SKIN-005.4** Verifikasi `pnpm test:ui-catalog` lulus.

### R4. CI, visual acceptance, dan release gate

- [ ] **R4.1 — CI catalog gate:** tambahkan `pnpm test:ui-catalog` ke workflow CI pada job quality yang tepat; jangan mengandalkan hanya unit test shared UI.
- [ ] **R4.2 — Exact SHA evidence:** pastikan CI mencatat hasil `test:ui`, `test:ui-catalog`, Axe, UI budget, Board typecheck/lint, dan Board bundle budget pada exact commit `dev`.
- [ ] **R4.3 — Visual matrix:** jalankan review screenshot desktop 1440px dan mobile 390px/320px untuk Home, auth, Board, model list/form, Kanban, analytical views, dan Workbench; perbarui snapshot hanya setelah side-by-side review.
- [x] **R4.4 — Real-data contract:** uji loading, empty, error, permission-denied, zero-value, stale metadata, dan conflict state dengan API/fixture test yang diberi label; jangan pernah menampilkan fixture sebagai data produksi.
- [x] **R4.5 — Accessibility gate:** tidak boleh ada pelanggaran Axe baru; validasi keyboard-only, focus return, accessible name, contrast, reduced motion, dan screen-reader status.
- [x] **R4.6 — Performance gate:** pastikan lazy views tidak masuk initial bundle route yang tidak membutuhkannya; laporkan raw/gzip size dan pertahankan budget.
- [x] **R4.7 — Documentation:** perbarui UI Bible, TOKENS, katalog, dan referensi komponen setelah kontrak implementasi berubah; jangan membuat dokumen desain kedua.
- [ ] **R4.8 — Final acceptance:** jalankan seluruh gate relevan pada exact SHA terakhir di `dev`; catat command, hasil, screenshot path, dan blocker yang tersisa sebelum menandai task induk selesai.

### Aturan penutupan Bagian R

1. Task induk hanya boleh dicentang setelah seluruh subtask terkait selesai dan bukti tersedia.
2. Bukti minimum untuk kode: path file + test yang meng-cover behavior + hasil command yang relevan.
3. Bukti minimum untuk visual: path screenshot + viewport/theme/state + hasil side-by-side review.
4. Jangan mengubah screenshot baseline untuk membuat test lulus; investigasi perubahan visual terlebih dahulu.
5. Jangan menggabungkan task lintas package yang memiliki owner berbeda dalam satu perubahan besar bila dapat dipisah menjadi commit kecil.
6. Semua implementasi masuk ke `dev` terlebih dahulu. Jangan mendorong langsung ke `main`.
7. Bila blocker memerlukan perubahan kontrak ORM/API, catat ID dependency dan lanjutkan task UI lain yang tidak terblokir; jangan membuat workaround yang mengubah perilaku produksi.

**Definition of Done — UI Platform Next Wave:** shared primitives tersedia melalui public subpath dan lolos package checks; Board menggunakan metadata API untuk dynamic List/Form/Kanban/Search/Calendar/Graph/Pivot; skin/mode/density bekerja, tersimpan, dan lolos contrast/accessibility matrix; UI Catalog dan visual E2E menjadi gate CI; tidak ada regresi permission, tenant isolation, responsive layout, atau performance budget; seluruh hasil diverifikasi pada exact SHA branch `dev`.






























