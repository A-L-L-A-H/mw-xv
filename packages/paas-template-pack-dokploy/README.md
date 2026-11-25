# paas-template-pack-dokploy

Pack template layanan dari [Dokploy Templates](https://github.com/Dokploy/templates) untuk dipakai PaaS control plane MoonWitness (`apps/control-plane`).

## Isi

`blueprints/<template-name>/` — 658 blueprint, masing-masing berisi:

| File | Keterangan |
|---|---|
| `docker-compose.yml` | Compose native, pakai `expose:` (bukan `ports:` hardcoded). |
| `template.toml` | Definisi domain (`$$domain`), service name, mounts, dan variables (termasuk generator `$$secret`, `$$random_hash`). |
| `meta.json` | Metadata: id, name, version, description, logo, links, tags. |
| `logo.*` | Logo aplikasi. |

## Catatan konversi ke control plane

1. Placeholder `${domain}` → map ke `MW_PAAS_BASE_DOMAIN` (auto-domain `<slug>.<baseDomain>`).
2. Generator `$$secret`, `$$password`, `$$random_hash(n)` → generate saat deploy, tulis ke `.env` stack.
3. `expose:` tanpa `ports:` → service diakses lewat jaringan internal + reverse proxy (Caddy), sesuai pola control plane.
4. Tidak ada `container_name` / `networks` hardcoded — aman untuk project name `mw-paas-<slug>`.

## Update

Diambil dari branch `main` repo `Dokploy/templates`, path `blueprints/` (sparse checkout). Lisensi MIT.
