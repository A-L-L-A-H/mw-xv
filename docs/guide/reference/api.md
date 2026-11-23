# Referensi API

**Pembaca:** pemakai HTTP API atau SDK. **Prasyarat:** API lokal hidup dan pengguna memiliki sesi
yang berwenang. **Verifikasi:** buka `http://localhost:3000/docs` untuk OpenAPI/Swagger UI, atau
jalankan `pnpm --filter @moonwitness/api test`; suite API lokal saat ini melaporkan 85 tes lulus.

## Endpoint penemuan

| Endpoint                      | Kegunaan                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET /livez`                  | Liveness proses HTTP; tidak membuktikan database siap.                                                        |
| `GET /readyz`                 | Readiness API dan koneksi PostgreSQL terbatas.                                                                |
| `GET /health`                 | Alias kompatibilitas untuk readiness.                                                                         |
| `GET /api/models`             | Daftar model yang terlihat oleh actor saat ini.                                                               |
| `GET /api/:model/fields`      | Metadata field untuk model yang diizinkan.                                                                    |
| `GET /api/:model/views`       | Metadata list/form/search view.                                                                               |
| `GET /api/:model/group-count` | Hitungan terbatas menurut kolom scalar dengan domain dan row/company scope yang sama seperti pencarian model. |
| `/auth/*`                     | Login, refresh, logout, perubahan password, dan profil sesi.                                                  |

Route `/api/:model` menyediakan search/read, create, update, archive, dan action sesuai permission.
Filter `domain`, `fields`, pagination (`offset`, `limit`), `order`, eager relation (`with`), serta
`count` didokumentasikan sebagai bagian kontrak SDK.

Gunakan `GET /api/base.partner/group-count?group_by=company_id,is_customer` untuk hitungan per
kombinasi kolom; `domain` menerima JSON domain seperti endpoint list. Gunakan `limit` (default 100,
maksimum 500) dan `offset` (default 0, maksimum 10.000) untuk pagination deterministik; respons
menyertakan `hasMore`. Satu sampai tiga kolom scalar yang memang dideklarasikan pada model diizinkan.
Kolom tersembunyi atau relasi ditolak, dan record/company scope server selalu ditambahkan ke domain
sebelum agregasi.

## Endpoint agen (A2A dan MCP)

| Endpoint                | Akses                                    | Kontrak                                                                      |
| ----------------------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| `POST /a2a/delegate`    | publik, tetapi **wajib** envelope A2A v1 | HMAC `MW_A2A_SIGNING_SECRET`, header `X-A2A-Protocol: a2a.v1`, nonce dan TTL |
| `GET /api/ai/a2a/inbox` | superadmin/system dengan company scope   | Riwayat penerimaan yang persisten, `limit` 1–200, tanpa cache (`no-store`)   |

Penerima A2A hanya aktif bila `MW_A2A_API_ENABLED=true`, `MW_A2A_SIGNING_SECRET` minimal 32 karakter,
`MW_A2A_COMPANY_ID` valid, dan `MW_A2A_API_ENDPOINT` menunjuk ke host mesh privat. Endpoint ini
sengaja ditandai `public` pada Fastify karena autentikasinya adalah envelope bertanda tangan, bukan
bearer token; jangan mengirim kredensial sesi ke sana. Kedua route tercantum dalam
`docs/guide/reference/generated-api.md` dan diberi tag `A2A` pada Swagger UI.

MCP bukan endpoint HTTP publik. Tool `@moonwitness/ai-mcp` berjalan in-process, menolak pemanggilan
tanpa autentikasi, mencatat setiap keputusan ke `ai.mcp`, memblokir tool `a2a.*`/yang belum disetujui,
serta menghormati grant pencabutan dan emergency stop. Gunakan A2A untuk pesan antar-agent lintas
perusahaan; gunakan MCP hanya untuk tool lokal yang sudah diberi grant.

## Client dan kompatibilitas

Gunakan root exports `@moonwitness/client`; jangan bergantung pada file internal `apps/api/src`.
HTTP API saat ini belum memiliki URL prefix dengan versi terpisah. Perubahan API dirilis bersama
kontrak package dan mengikuti [kebijakan kompatibilitas](../../engineering/compatibility.md).
Respons dapat menambah field; client harus mengabaikan field baru yang tidak dikenal. Error response
mengandung status HTTP dan pesan `error`; client memetakan status umum ke exported error classes.

Contoh nilai akun/password sengaja tidak dicantumkan. Gunakan akun test lokal dari quickstart dan
jangan menaruh bearer token pada log, URL, screenshot, atau dokumentasi publik.

## Catatan generated reference

Halaman ini menjelaskan kontrak manual yang diverifikasi terhadap source. Ekstraksi seluruh route,
schema dan response tetap menjadi deliverable M6.02; jangan menganggap tabel ini sebagai OpenAPI
dump lengkap.
