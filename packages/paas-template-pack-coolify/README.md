# paas-template-pack-coolify

Pack template layanan dari [Coolify](https://github.com/coollabsio/coolify) untuk dipakai PaaS control plane MoonWitness (`apps/control-plane`).

## Isi

| Path | Keterangan |
|---|---|
| `service-templates.json` | Katalog semua service template (nama, slogan, link dokumentasi, compose base64). |
| `service-templates-latest.json` | Katalog versi paling baru per service. |
| `compose/*.yaml` | 390+ file Docker Compose per service (satu file = satu service, mis. `activepieces.yaml`). |
| `test-database-detection.yaml` | Fixture dari Coolify untuk pengujian deteksi database. |

## Format katalog

Setiap entry di `service-templates.json`:

```json
{
  "<service-name>": {
    "documentation": "https://...",
    "slogan": "Deskripsi singkat",
    "compose": "<docker-compose YAML ter-encode base64>",
    "logo": "<url logo (opsional)>",
    "tags": ["..."],
    "variables": { "SERVICE_PASSWORD": { "generator": "password" } }
  }
}
```

## Cara pakai di control plane

1. Baca katalog: `require('./paas-template-pack-coolify/service-templates.json')` atau baca `compose/*.yaml` langsung per service.
2. `compose` di katalog adalah base64 — decode untuk mendapat YAML compose-nya (isi sama dengan file di `compose/`).
3. Variabel yang butuh nilai rahasia (mis. `SERVICE_PASSWORD_*`) digenerate saat deploy, mengikuti konvensi generator Coolify.
4. Pola `{SERVICE_FQDN_...}` di-inject sebagai domain publik service oleh control plane.

## Update

Diambil dari branch `main` Coolify, path `templates/` (sparse checkout). Untuk memperbarui, ulangi copy dari repo sumber atau jalankan ulang proses yang sama.

## Lisensi

Template asli dari Coolify, berlisensi Apache-2.0.
