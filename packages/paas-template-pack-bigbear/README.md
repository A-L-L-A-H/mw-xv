# paas-template-pack-bigbear

Pack template aplikasi dari [BigBearCasaOS](https://github.com/toricorn/big-bear-casaos) untuk dipakai PaaS control plane MoonWitness (`apps/control-plane`).

## Isi

`apps/<app-name>/docker-compose.yml` — 63 app, satu folder per aplikasi. Compose native dengan extension field `x-casaos` di dalamnya yang memuat metadata:

- `title`, `tagline`, `description`, `category`, `icon`, `author`
- `port_map`, `index` (path UI), `architectures`
- Deskripsi per env / volume / port
- `tips` (catatan pemakaian)

Extension field `x-casaos` diabaikan otomatis oleh `docker compose`, jadi file bisa langsung dipakai; metadata hanya perlu di-parse untuk katalog UI.

## Catatan konversi ke control plane

1. `x-casaos.port_map` / `index` → dipakai untuk auto-domain via Caddy (`<slug>.<baseDomain>`).
2. Varian `-host` (mis. `adguard-home-host`) memakai `network_mode: host` — ditolak validator control plane, jangan ditawarkan.
3. Path data biasanya `/DATA/AppData/<app>` — remap ke named volume pola control plane.

## Update

Diambil dari branch `master` repo `toricorn/big-bear-casaos` (lanjutan dari `bigbeartechworld/big-bear-casaos` yang sudah tidak ada), path `Apps/`. Lisensi MIT (see `LICENSE`).
