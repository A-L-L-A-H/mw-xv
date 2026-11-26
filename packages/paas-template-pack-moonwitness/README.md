# paas-template-pack-moonwitness

Pack template **kurasi MoonWitness**: aplikasi & stack sovereign yang tidak tersedia di pack upstream (`paas-template-pack-coolify`, `paas-template-pack-dokploy`, `paas-template-pack-bigbear`).

Semua template ditulis manual mengikuti konvensi Coolify magic variables dan **lolos validator control plane** (`ValidateComposeSpec` di `apps/control-plane/paas_coolify.go`):

- Tidak ada `docker.sock`, `privileged: true`, `network_mode: host`
- Tidak ada bind mount host — semua pakai named volume
- Tidak ada `cap_add` berbahaya (SYS_ADMIN/ALL/SYS_PTRACE/SYS_MODULE)
- Semua service pakai `expose:` (bukan `ports:`) — diakses via jaringan internal + Caddy
- Secret pakai placeholder `${SERVICE_PASSWORD_*}` — digenerate saat deploy
- Domain publik pakai `${SERVICE_FQDN_*}` — di-inject oleh control plane

## Isi

| Template | Kategori | Keterangan | Lisensi upstream |
|---|---|---|---|
| `litellm-gateway` | ai | AI proxy 100+ LLM provider, spend tracking, fallback | MIT (LiteLLM) |
| `langfuse` | ai | LLM tracing, eval, prompt management | MIT (Langfuse core) |
| `lago-billing` | business | Meter-to-cash & subscription billing | AGPL-3.0 (Lago) |
| `pgbackweb` | storage | Backup Postgres terjadwal ke S3 + web UI | MIT |
| `sftpgo` | storage | SFTP/FTP/WebDAV dengan backend S3 | AGPL-3.0 (SFTPGo) |
| `waha` | messaging | WhatsApp HTTP API multi-engine | Apache-2.0 (core) |
| `openbao` | security | Secrets management & PKI (fork Vault) | MPL-2.0 / BUSL |

## Struktur

- `service-templates.json` — katalog: id → {file, name, slogan, category, tags, documentation}
- `templates/<id>.yaml` — docker compose per template

## Alasan ada pack ini

Empat gap yang tidak diisi Coolify/Dokploy/BigBear:
1. **Fintech & billing** (Lago) — metering untuk orm-subscription/orm-income-ledger
2. **Storage & backup sovereign** (PgBackWeb, SFTPGo) — DR tanpa vendor lock-in
3. **AI agent runtime & MCP** (LiteLLM, Langfuse) — pasangan `packages/ai-runtime` & `apps/desktop`
4. **Messaging regional SEA** (WAHA) — melengkapi `apps/whatsapp` (Baileys native) sebagai opsi self-host tenant

## Menambah template baru

1. Tulis `templates/<id>.yaml` — ikuti checklist validator di atas.
2. Daftarkan di `service-templates.json`.
3. Test manual: `docker compose -f templates/<id>.yaml config` harus valid.

## Catatan lisensi

File compose ditulis sendiri (bukan hasil copy repo upstream); lisensi di atas merujuk pada aplikasi yang dikemas.
