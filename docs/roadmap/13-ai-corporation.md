# M12 — AI Corporation (EGAO) Kartu Kerja Terperinci

Baca [protokol eksekusi](EXECUTION.md) dan [ADR 0007](../decisions/0007-ai-corporation-addon-first-architecture.md) terlebih dahulu. Status resmi tetap di [master checklist](../../ROADMAP.md); dokumen ini mendefinisikan source cards kanonik `M12.01`–`M12.14` yang merekonsiliasi proposal ID pada [`todo-ai-corporation.md`](../bundles/ai-corporation-blueprint/docs/roadmap/todo-ai-corporation.md) ke dalam `docs/roadmap/tasks.json` tanpa mengubah task M0–M11 atau K0–K9.

---

## M12.01 — Exact-SHA baseline audit & source-backed reuse matrix (`BASE.17`–`BASE.30`, `AI0.1`–`AI0.42`)

- **Prasyarat:** M0.01, M0.03, M9.03, M9.04, M9.05, M9.06, M9.07, K0-003, K7-001
- **Baca/periksa:** [ACTIVE-PLAN.md](ACTIVE-PLAN.md), [EXECUTION.md](EXECUTION.md), [ADR 0001](../decisions/0001-platform-contracts.md), [ADR 0006](../decisions/0006-mandatory-addon-thin-api.md), [`todo-ai-corporation.md`](../bundles/ai-corporation-blueprint/docs/roadmap/todo-ai-corporation.md).
- **Deliverable:** `docs/architecture/ai-corporation-baseline-audit.md` berisi audit exact-SHA (`43c3a43` -> `HEAD`), inspeksi `BASE.17`–`BASE.30`, pola engineering `AI0.16`–`AI0.30`, baseline pengukuran/debt `AI0.31`–`AI0.41`, dan Reuse Matrix `AI0.42` untuk seluruh 10 existing owners.
- **Proposal IDs (ledger):** `BASE.17`–`BASE.30`, `AI0.1`–`AI0.42`
- **Acceptance criteria:** Seluruh 10 domain/infrastruktur existing diverifikasi langsung dari source, semua invariant `NO-GO` (`BASE.26`–`BASE.30`) terverifikasi, hasil baseline non-Postgres dan celah lingkungan (`POSTGRES_TEST_URL` / `psql`) terekam jujur.
- **Test evidence expectations:** Output `pnpm test:roadmap`, `pnpm automation:check:roadmap`, `node scripts/check-docs.mjs`, `pnpm api:addon:check`, `pnpm board:ui:check`, dan hasil unit suite baseline (`@moonwitness/api --maxWorkers=2`) tercatat di `docs/roadmap/evidence/M12.01.md`.

### Langkah pelaksanaan

1. Catat SHA `dev` dan `main`, status branch policy, temuan `AGENTS.md`, status 213 task baseline (`148` M + `65` K), serta perubahan konkuren workspace.
2. Inspeksi seluruh 10 existing owners (`orm-base`, `orm-organization`, `orm-request`, `orm-workflow`, `orm-integration`, `orm-knowledge`/`corpus`/`research`, `orm-storage`, `jobs`, `local-ai`, dan `apps/api` policy/rules/registry).
3. Jalankan dan catat baseline command, durasi, serta debt lingkungan (`POSTGRES_TEST_URL`, `--maxWorkers=2`) lalu susun Reuse Matrix 7 kolom (`Existing Owner | Capability | API | Test | Extension Point | Gap | Proposed Action`).

### Verifikasi dan syarat selesai

Dokumen audit tersedia, seluruh link terverifikasi oleh `node scripts/check-docs.mjs`, dan tidak ada duplikasi domain dengan M0–M11 atau K0–K9. Catat hasil dalam `docs/roadmap/evidence/M12.01.md`.

---

## M12.02 — Official ADR `0007` & roadmap/workstream reconciliation (`AI1.1`–`AI1.34`)

- **Prasyarat:** M12.01, M0.07, M11.02
- **Baca/periksa:** [Baseline audit](../architecture/ai-corporation-baseline-audit.md), [ADR 0006](../decisions/0006-mandatory-addon-thin-api.md), [`AI-CORPORATION-ADR-DRAFT.md`](../bundles/ai-corporation-blueprint/docs/AI-CORPORATION-ADR-DRAFT.md), [ISSUE-SYNC-CONTRACT.md](ISSUE-SYNC-CONTRACT.md).
- **Deliverable:** [ADR 0007](../decisions/0007-ai-corporation-addon-first-architecture.md) (`Status: Accepted`), pointer kompatibilitas [ADR 0007 pointer](../architecture/adr/0007-ai-corporation-addon-first-architecture.md), source cards `docs/roadmap/13-ai-corporation.md`, registrasi `M12.01`–`M12.14` di `docs/roadmap/tasks.json`, serta pembaruan `ROADMAP.md`, `docs/roadmap/README.md`, dan `docs/roadmap/ACTIVE-PLAN.md`.
- **Proposal IDs (ledger):** `AI1.1`–`AI1.34`
- **Acceptance criteria:** Semua keputusan kepemilikan entitas (`AI1.1`–`AI1.12`), aturan ADR (`AI1.13`–`AI1.25`: D1–D12, Addon-First, `ai.work_contract` tanpa mengubah `orm-request`, agent non-superadmin satu company, data ephemeral di luar ORM, batas 1 ORM + 3 non-ORM package, non-goals v1), dan rekonsiliasi roadmap (`AI1.26`–`AI1.34`) lulus validator tanpa memodifikasi M0–M11/K0–K9.
- **Test evidence expectations:** `pnpm test:roadmap`, `pnpm automation:check:roadmap`, `node scripts/check-docs.mjs`, `pnpm docs:links`, `pnpm docs:check:built`, `pnpm lint`, dan `pnpm format:check` lulus, tercatat di `docs/roadmap/evidence/M12.02.md`.

### Langkah pelaksanaan

1. Finalisasi ADR `0007` pada `docs/decisions/0007-ai-corporation-addon-first-architecture.md` dan pointer di `docs/architecture/adr/0007-ai-corporation-addon-first-architecture.md`.
2. Daftarkan `M12.01`–`M12.14` ke `docs/roadmap/tasks.json` dengan `dependsOn` lintas-seri dan perbarui `ROADMAP.md`, `docs/roadmap/README.md`, serta `docs/roadmap/ACTIVE-PLAN.md`.
3. Tetapkan kontrak sinkronisasi antara checkbox granular `todo-ai-corporation.md`, kartu `13-ai-corporation.md`, `tasks.json`, dan `ROADMAP.md`.

### Verifikasi dan syarat selesai

`pnpm test:roadmap` dan `pnpm automation:check:roadmap` memvalidasi seluruh task (`227` tasks: `162` M-series + `65` K-series) serta seluruh check dokumentasi/lint/format lulus. Catat hasil dalam `docs/roadmap/evidence/M12.02.md`.

---

## M12.03 — Addon-First domain foundation `@moonwitness/orm-ai` (`AI2.1`–`AI2.43`)

- **Prasyarat:** M12.02, M4.10, M4.11, M4.12, M9.03, M9.04, M9.05, M9.07
- **Baca/periksa:** [ADR 0007](../decisions/0007-ai-corporation-addon-first-architecture.md), `packages/orm-workflow/src/models.ts`, `packages/orm-organization/src/models.ts`, `apps/api/src/auth/policy.ts`, `scripts/roadmap/addon-conformance.test.mjs`.
- **Deliverable:** Package `packages/orm-ai` (`@moonwitness/orm-ai`) dengan `defineModel`/`defineAddon`, views/menus/seeds aman, registrasi `API_ADDONS`, pemblokiran `'ai.'` di `INTERNAL_PREFIXES`, serta test install/upgrade/idempotency/isolasi tenant.
- **Proposal IDs (ledger):** `AI2.1`–`AI2.43`
- **Acceptance criteria:** Model `ai.agent`, `ai.agent_profile`, `ai.provider_profile` (`secret_ref` `MW_AI_*` saja), `ai.model_profile`, `ai.execution_policy`, `ai.capability_grant`, `ai.work_contract`, `ai.acceptance_criterion`, `ai.agent_run`, `ai.artifact_manifest`, `ai.obligation`, `ai.taskforce`, `ai.workforce_assignment`, `ai.memory_candidate`, `ai.skill_version` terinstal bersih, idempotent, tahan downgrade/interupsi, dan terisolasi lintas company serta non-superadmin.
- **Test evidence expectations:** `pnpm --filter @moonwitness/orm-ai test`, `pnpm test:addon-conformance`, `pnpm api:addon:check`, `pnpm docs:check:built`, dan negative tenant/RPC tests lulus.

### Langkah pelaksanaan

1. Definisikan seluruh model domain `@moonwitness/orm-ai` beserta validasi field, constraint, external IDs `_orm_data`, views, menus, dan upgrade hooks.
2. Daftarkan addon `ai` ke `API_ADDONS` (`apps/api/src/addons/registry.ts`), tambahkan `'ai.'` ke `INTERNAL_PREFIXES` (`apps/api/src/auth/policy.ts`), dan lengkapi `scripts/roadmap/addon-conformance.test.mjs`.
3. Uji clean install, reinstall/edit preservation, upgrade rollback, isolasi company A/B, penolakan role `superadmin`/`system`, dan pemblokiran generic REST/JSON-RPC.

### Verifikasi dan syarat selesai

Seluruh suite unit/conformance/boundary `@moonwitness/orm-ai` dan `apps/api` lulus tanpa bypass ORM. Catat hasil dalam `docs/roadmap/evidence/M12.03.md`.

---

## M12.04 — Provider & model abstraction with data-classification routing (`AI3.1`–`AI3.28`)

- **Prasyarat:** M12.02, M9.04, K7-001, K7-005
- **Baca/periksa:** [ADR 0007](../decisions/0007-ai-corporation-addon-first-architecture.md), `packages/local-ai/src/index.ts`, `packages/orm-integration/src/webhook-security.ts`.
- **Deliverable:** Abstraksi provider/model/harness pada `packages/ai-runtime` (`@moonwitness/ai-runtime`) dengan `MockProvider`, `OllamaAdapter` (API Ollama `/api/chat`/`/api/tags`), `CloudProviderAdapter` (teruji deterministik via mock/fixture tanpa live key), `DataClassificationRouter`, redaksi error/header, dan pelacakan token/cost (`estimated` vs `provider_reported`).
- **Proposal IDs (ledger):** `AI3.1`–`AI3.28`
- **Acceptance criteria:** `local_only` dan `restricted` diblokir dari cloud routing dan silent fallback; adapter lokal/cloud lulus contract suite identik (success, malformed, timeout, quota, outage, cancellation) tanpa menyentuh isolasi `@moonwitness/local-ai`.
- **Test evidence expectations:** `pnpm --filter @moonwitness/ai-runtime test` mencakup contract suite, negative classification routing, redaction, dan provider-offline integrity tests.

### Langkah pelaksanaan

1. Implementasikan interface `AiProvider` (`healthCheck`, `generate`, streaming opsional, structured output, tool-call capabilities) terpisah dari `ModelProfile` dan `AgentHarness`.
2. Implementasikan `MockProvider`, `OllamaAdapter`, `CloudProviderAdapter`, serta `DataClassificationRouter` dengan SSRF guard dan redaksi secret/Authorization.
3. Jalankan contract suite yang sama pada seluruh adapter tanpa bergantung pada live cloud API key.

### Verifikasi dan syarat selesai

Seluruh provider contract tests, classification boundary tests, dan offline-safety checks lulus di CI tanpa secret eksternal. Catat hasil dalam `docs/roadmap/evidence/M12.04.md`.

---

## M12.05 — First durable, bounded read-only agent via `@moonwitness/jobs` (`AI4.1`–`AI4.37`)

- **Prasyarat:** M12.03, M12.04, M4.10, M4.11, M4.12, K7-005
- **Baca/periksa:** `packages/jobs/src/runtime.ts`, `packages/orm-storage/src/index.ts`, `packages/orm-workflow/src/runtime.ts`.
- **Deliverable:** Bounded read-only agent harness & job handler `ai.agent_run.*` di `@moonwitness/ai-runtime` terintegrasi dengan `@moonwitness/jobs` (leases, heartbeats, fencing tokens, outbox, `AbortSignal` cancellation) dan read-only repo inspector ber-allowlist (anti path-traversal & symlink escape).
- **Proposal IDs (ledger):** `AI4.1`–`AI4.37`
- **Acceptance criteria:** Tugas inspeksi read-only menghasilkan structured completion envelope + artifact di `orm-storage`; uji crash setelah claim, crash sebelum commit, lease expiry/stale fencing, duplicate job/outbox delivery, cancellation, malformed output, dan dead-letter retry lulus dengan recovery rate terukur.
- **Test evidence expectations:** Suite integrasi `@moonwitness/ai-runtime` dan `apps/api` membuktikan crash/recovery, stale-worker fencing, idempotency, dan zero side-effect writes.

### Langkah pelaksanaan

1. Definisikan kontrak read-only repository inspection (`input`, allowlist path, batas durasi/output/konteks, completion envelope) dan persist `ai.agent_run` sebelum enqueue job melalui transaksi/outbox.
2. Hubungkan handler `@moonwitness/jobs` dengan checkpoint aman, heartbeat, fencing check saat commit, dan cooperative cancellation hingga ke provider.
3. Jalankan fault-injection suite untuk timeout, worker crash, lease expiry, duplicate delivery, dan dead-letter inspection.

### Verifikasi dan syarat selesai

Satu bounded read-only run tereksekusi end-to-end dan seluruh skenario recovery/cancellation lulus deterministik. Catat hasil dalam `docs/roadmap/evidence/M12.05.md`.

---

## M12.06 — Capability/tool gateway, MCP server & A2A ADR (`AI5.1`–`AI5.33`)

- **Prasyarat:** M12.03, M12.05, M9.03, K0-003
- **Baca/periksa:** [ADR 0007](../decisions/0007-ai-corporation-addon-first-architecture.md), `apps/api/src/auth/policy.ts`, `packages/orm-knowledge/src/index.ts`.
- **Deliverable:** Internal capability/tool gateway di `@moonwitness/ai-runtime` (execution-time grant/expiry/revocation/`policy_version` re-check, quotas, argument/output redaction, audit denied attempts), package `packages/ai-mcp` (`@moonwitness/ai-mcp`) dengan read-only tools + 1 scoped idempotent write tool, dokumentasi katalog/client tanpa secret, dan ADR terpisah untuk A2A (`docs/decisions/0008-ai-corporation-a2a-protocol.md`).
- **Proposal IDs (ledger):** `AI5.1`–`AI5.33`
- **Acceptance criteria:** MCP tidak pernah memanggil DB langsung; unauthenticated/expired/revoked/wrong-company requests ditolak; revocation antara plan dan execution dibuktikan; replayed idempotent write tool tidak menggandakan efek; keputusan A2A terdokumentasi terpisah dari MCP.
- **Test evidence expectations:** `pnpm --filter @moonwitness/ai-mcp test` dan gateway tests mencakup conformance, cross-company denial, revocation-mid-flight, replay idempotency, dan prompt/tool-output injection.

### Langkah pelaksanaan

1. Bangun capability/tool gateway dengan re-check izin saat eksekusi, quota per-agent/per-run, risk-tier confirmation, dan audit penolakan.
2. Bangun `@moonwitness/ai-mcp` (read-only registry, assigned work contract, approved K0–K9 read interfaces, evidence refs) terlebih dahulu dan uji conformance sebelum menambah 1 scoped idempotent write tool.
3. Dokumentasikan batas peer-agent A2A dalam ADR `0008` tanpa mengaktifkan delegasi eksternal tak terautentikasi.

### Verifikasi dan syarat selesai

MCP conformance, tool authorization, replay protection, dan injection tests lulus. Catat hasil dalam `docs/roadmap/evidence/M12.06.md`.

---

## M12.07 — Proof-Carrying Work (PCW), independent verification & obligation continuity (`AI6.1`–`AI6.31`)

- **Prasyarat:** M12.03, M12.05, M9.03, K3-005, K6-003, K6-005
- **Baca/periksa:** `packages/orm-workflow/src/runtime.ts`, `packages/orm-knowledge/src/bug-outcome-verification.ts`, [ADR 0007](../decisions/0007-ai-corporation-addon-first-architecture.md).
- **Deliverable:** Pipeline PCW (`ai.work_contract`, `ai.acceptance_criterion`, `ai.artifact_manifest`, deterministic verifier hooks, independent reviewer via `orm-workflow` `requireDifferentActor: true`) dan continuity ledger (`ai.obligation`, impact links, re-verification triggers, read-only obligation timeline/report).
- **Proposal IDs (ledger):** `AI6.1`–`AI6.31`
- **Acceptance criteria:** Klaim selesai palsu tanpa bukti, bukti mismatch/stale/parsial, serta self-approval pekerja/agen selalu ditolak; perubahan code/source/policy atau expiry memicu pembukaan ulang `ai.obligation` tanpa penghapusan saat work contract ditutup.
- **Test evidence expectations:** Tests PCW negative/tamper/conflict-of-interest dan obligation invalidation/reopen lulus pada SQLite dan API routes terkait.

### Langkah pelaksanaan

1. Implementasikan lifecycle bukti (`proposed`/`produced`/`checked`/`accepted`/`rejected`/`superseded`), completeness check kriteria, validasi SHA-256 digest & provenance, dan independent review via `orm-workflow`.
2. Implementasikan `ai.obligation` dengan owner, trigger, expiry, impact links, dan proteksi agar penutupan task tidak menghapus kewajiban terbuka.
3. Uji penolakan self-approval, fabricated/stale evidence, serta reopening obligation akibat perubahan lanjutan.

### Verifikasi dan syarat selesai

Seluruh PCW dan obligation continuity tests lulus serta laporan penerimaan auditable dihasilkan. Catat hasil dalam `docs/roadmap/evidence/M12.07.md`.

---

## M12.08 — AI Company workforce organization & bounded multi-agent orchestration (`AI7.1`–`AI7.32`)

- **Prasyarat:** M12.06, M12.07, M9.05, M9.06
- **Baca/periksa:** `packages/orm-organization/src/models.ts`, `packages/orm-organization/src/validation.ts`, `packages/orm-workflow/src/runtime.ts`.
- **Deliverable:** Integrasi `orm-organization` + `ai.taskforce`/`ai.workforce_assignment`, planner schema & critique, deteksi cycle/duplikat task, batas depth & concurrency, propagation cancellation, workspace conflict control untuk concurrent writes, dan skenario test company (1 manager + 2 workers + 1 reviewer).
- **Proposal IDs (ledger):** `AI7.1`–`AI7.32`
- **Acceptance criteria:** Planner memilih single-agent untuk tugas non-decomposable dan parallel delegation untuk tugas decomposable; cycle, duplikat aktif, cross-company escalation, dan penyelesaian parent sebelum child/obligation selesai ditolak.
- **Test evidence expectations:** Workforce orchestration tests mengukur net benefit vs overhead, cycle/duplicate rejection, workspace lock/conflict prevention, dan cancellation propagation.

### Langkah pelaksanaan

1. Petakan posisi template (planner/manager/researcher/builder/reviewer) tanpa hak superadmin dan hubungkan ke `orm-organization` serta temporary taskforce berbudget/expiry.
2. Implementasikan planner schema validator, cycle/duplicate detector, depth/quota guard, parent->child cancellation, dan conflict control penulisan paralel.
3. Jalankan uji decomposable vs non-decomposable benchmark dengan company uji (1 manager, 2 workers, 1 reviewer).

### Verifikasi dan syarat selesai

Delegasi multi-agent, review independen, dan conflict control lulus tanpa cycle atau eskalasi hak akses. Catat hasil dalam `docs/roadmap/evidence/M12.08.md`.

---

## M12.09 — Episodic/semantic/procedural memory & controlled learning (`AI8.1`–`AI8.24`)

- **Prasyarat:** M12.07, K0-003, K5-002
- **Baca/periksa:** [Knowledge domain ownership](../architecture/knowledge-domain-ownership.md), [ADR 0007](../decisions/0007-ai-corporation-addon-first-architecture.md).
- **Deliverable:** Siklus hidup `ai.memory_candidate` (episodic/semantic) dan `ai.skill_version` (procedural SOP) terpisah dari K0–K9, promotion workflow tervalidasi, ablation & transfer benchmark harness (`no-memory`, `episodic-only`, `skill-only`, `combined`), harm measurement, dan instant revocation.
- **Proposal IDs (ledger):** `AI8.1`–`AI8.24`
- **Acceptance criteria:** Memory hanya berstatus kandidat sampai lolos evaluasi utilitas/keamanan dan review; retrieved memory tidak pernah menambah capability grant; versi yang dicabut langsung tidak dikonsumsi run berikutnya.
- **Test evidence expectations:** Ablation, memory-harm/poisoning, cross-domain transfer, dan revocation verification tests lulus deterministik.

### Langkah pelaksanaan

1. Pisahkan penyimpanan episodic, semantic, dan procedural skill dari K0–K9 dengan scope company/project, retention, provenance run, dan audit pemakaian.
2. Terapkan workflow promosi eksplisit dan pastikan pemuatan memory hanya sebagai untrusted context.
3. Bangun benchmark ablation dan uji harm/poisoning serta pencabutan versi memory/skill.

### Verifikasi dan syarat selesai

Ablation report terukur dan larangan live policy/prompt self-modification teruji. Catat hasil dalam `docs/roadmap/evidence/M12.09.md`.

---

## M12.10 — Mission Control UI & operator experience in `apps/board` (`AI9.1`–`AI9.25`)

- **Prasyarat:** M12.06, M12.07, M12.08, M9.06
- **Baca/periksa:** `packages/ui/README.md`, `scripts/check-board-shared-ui.mjs`, `apps/board/src/board-pages/model-page.tsx`.
- **Deliverable:** Route Mission Control di `apps/board/src/app/board/ai/*` (Company HQ, Mission Control, Operations, Continuity & Evidence, Governance, Providers, Eval Lab) menggunakan `@moonwitness/ui` & `@moonwitness/ui/icons/*` secara eksklusif, badge status `persisted`/`derived`/`ephemeral`, emergency controls (pause agent, revoke grant, stop run, disable provider), serta uji akses/isolasi/responsif.
- **Proposal IDs (ledger):** `AI9.1`–`AI9.25`
- **Acceptance criteria:** `pnpm board:ui:check`, `pnpm --filter @moonwitness/board typecheck`, `pnpm --filter @moonwitness/board lint`, dan `pnpm board:budget` lulus; tidak ada optimistic success palsu sebelum konfirmasi server; drill-down company -> team -> agent -> task -> run -> evidence berfungsi penuh dengan aksesibilitas keyboard & reduced-motion.
- **Test evidence expectations:** UI/Playwright/unit tests membuktikan isolasi cross-company, permission boundary, non-optimistic privileged actions, dan state loading/empty/error/stale/offline.

### Langkah pelaksanaan

1. Petakan halaman ke metadata addon (`/board/m/ai.*`) dan buat halaman khusus di `apps/board/src/app/board/ai/*` memakai primitif `@moonwitness/ui`.
2. Tampilkan label sumber status (`persisted`/`derived`/`ephemeral`), konfirmasi eksplisit untuk aksi darurat, filter multi-dimensi, dan alternatif aksesibilitas tabel/keyboard untuk grafik.
3. Jalankan `board:ui:check`, `typecheck`, `lint`, `board:budget`, dan UI/E2E tests.

### Verifikasi dan syarat selesai

Seluruh pemeriksaan UI Board, aksesibilitas, isolasi tenant, dan bundle budget lulus. Catat hasil dalam `docs/roadmap/evidence/M12.10.md`.

---

## M12.11 — Security risk tiers R0–R4, sandboxing, observability & restore drill (`AI10.1`–`AI10.38`)

- **Prasyarat:** M12.06, M12.07, M12.10, M4.12, K5-002, K7-005
- **Baca/periksa:** `apps/api/src/commands/restore-drill-fixture.ts`, `scripts/verify-application-restore.mjs`, `packages/logger/src/index.ts`.
- **Deliverable:** Mesin kebijakan risk tier R0–R4 deterministik, emergency stop, kontrol sandbox/egress/secret-isolation, telemetry GenAI terstruktur + alert rules + log redaction, cakupan `restore-drill-fixture.ts` untuk record `orm-ai`, serta topologi deployment & health/readiness checks.
- **Proposal IDs (ledger):** `AI10.1`–`AI10.38`
- **Acceptance criteria:** Zero unauthorized actions pada adversarial suite (prompt injection, tool-result poisoning, symlink/traversal, privilege escalation via generic API/MCP/child run); backup/restore dan restart worker/API selama queued/in-flight jobs lulus tanpa efek ganda.
- **Test evidence expectations:** Adversarial security suite, telemetry/redaction tests, restart/idempotency tests, dan restore-drill fixture coverage lulus.

### Langkah pelaksanaan

1. Implementasikan policy engine R0–R4 di luar prompt model, emergency stop, dan batas CPU/memory/disk/wall-clock/egress sandbox.
2. Tambahkan event & metrik GenAI terstruktur (`request -> job -> run -> provider -> tool -> artifact -> verifier`), alert rules, serta verifikasi redaksi log.
3. Tambahkan cakupan tabel `orm-ai` pada `apps/api/src/commands/restore-drill-fixture.ts` dan uji clean-install/upgrade/restart/restore.

### Verifikasi dan syarat selesai

Seluruh adversarial security suite (`0` unauthorized actions), observability checks, dan restore-drill coverage lulus. Catat hasil dalam `docs/roadmap/evidence/M12.11.md`.

---

## M12.12 — Evaluation lab, baselines & G0–G6 capability gates (`AI11.1`–`AI11.24`)

- **Prasyarat:** M12.08, M12.09, M12.11
- **Baca/periksa:** [ADR 0007](../decisions/0007-ai-corporation-addon-first-architecture.md), [todo-ai-corporation.md](../bundles/ai-corporation-blueprint/docs/roadmap/todo-ai-corporation.md).
- **Deliverable:** Package `packages/ai-evaluation` (`@moonwitness/ai-evaluation`) dengan korpus tugas deterministik non-sensitif, runner baseline single-agent vs multi-agent, metrik cost-per-accepted-deliverable / retained-functionality / recovery / memory ablation / transfer, serta definisi & evaluator gate `G0`–`G6`.
- **Proposal IDs (ledger):** `AI11.1`–`AI11.24`
- **Acceptance criteria:** Setiap run mencatat provider/model/harness/tool/SHA/fixture hash serta mempertahankan failed/partial/cancelled runs; setiap gate G0–G6 memiliki threshold terukur, zero safety regression, dan dokumentasi limitasi jujur tanpa klaim AGI.
- **Test evidence expectations:** `pnpm --filter @moonwitness/ai-evaluation test` dan eksekusi gate evaluator G0–G6 menghasilkan laporan deterministik yang dapat direplikasi.

### Langkah pelaksanaan

1. Susun korpus fixture lintas domain (repo analysis, coding, testing, research, docs, ops) dengan ground truth dan acceptance checks.
2. Implementasikan single-agent & multi-agent baseline runners, ablation, transfer, dan gate evaluators G0–G6.
3. Publikasikan hasil pengukuran, failed runs, biaya, dan limitasi di Eval Lab.

### Verifikasi dan syarat selesai

Evaluator G0–G6 dapat direproduksi offline dengan mock/local adapters tanpa live cloud keys dan lulus non-regression. Catat hasil dalam `docs/roadmap/evidence/M12.12.md`.

---

## M12.13 — Documentation, operator runbooks, threat model & doc gates (`DOC.1`–`DOC.16`)

- **Prasyarat:** M12.02, M12.11, M12.12
- **Baca/periksa:** `scripts/check-docs.mjs`, `scripts/docs/generate-reference.mjs`, `docs/guide/navigation.json`.
- **Deliverable:** Dokumentasi lengkap di `docs/ai-corporation/` (dan `docs/operations/`, `docs/security/`): indeks arsitektur, README addon `orm-ai`, setup provider lokal/cloud, panduan rotasi secret tanpa kredensial, katalog & izin MCP, operator runbook & emergency stop, compatibility matrix, threat model + DFD, metodologi evaluasi, panduan upgrade/backup/restore, serta regenerasi referensi platform/model.
- **Proposal IDs (ledger):** `DOC.1`–`DOC.16`
- **Acceptance criteria:** Zero broken links (`node scripts/check-docs.mjs`), `pnpm docs:links`, `pnpm docs:check:built`, dan review kesesuaian path/command/klaim terhadap codebase aktual lulus.
- **Test evidence expectations:** `node scripts/check-docs.mjs`, `pnpm docs:links`, `pnpm docs:check:built`, dan `pnpm architecture:check:built` lulus dengan exit code `0`.

### Langkah pelaksanaan

1. Tulis seluruh panduan addon, provider, secret rotation, MCP catalog, runbook operator, threat model, eval methodology, dan upgrade/restore.
2. Jalankan `pnpm architecture:generate` dan `pnpm docs:generate` bila kontrak model/route/package bertambah.
3. Verifikasi seluruh link internal, klaim implementasi, dan kebersihan secret/mockup labels.

### Verifikasi dan syarat selesai

Seluruh doc checks (`check-docs.mjs`, `docs:links`, `docs:check:built`, `architecture:check:built`) lulus bersih. Catat hasil dalam `docs/roadmap/evidence/M12.13.md`.

---

## M12.14 — Vertical slice, release gates G1–G14, E2E Tiers 1–5 & CI verification (`SLICE.1`–`SLICE.15`, `GATE.1`–`GATE.14`, `PR.1`–`PR.14`)

- **Prasyarat:** M12.10, M12.11, M12.12, M12.13
- **Baca/periksa:** [`todo-ai-corporation.md`](../bundles/ai-corporation-blueprint/docs/roadmap/todo-ai-corporation.md), `.github/workflows/ci.yml`, `ROADMAP.md`.
- **Deliverable:** Eksekusi vertical slice end-to-end (`SLICE.1`–`SLICE.15`), verifikasi 14 release gates (`GATE.1`–`GATE.14`), pemenuhan checklist PR (`PR.1`–`PR.14`), Progress Ledger & sinkronisasi akhir checkbox `[x]` di `todo-ai-corporation.md`, `ROADMAP.md`, dan `tasks.json`, serta hosted GitHub Actions CI 100% hijau pada `origin/dev`.
- **Proposal IDs (ledger):** `SLICE.1`–`SLICE.15`, `GATE.1`–`GATE.14`, `PR.1`–`PR.14`, Progress Ledger
- **Acceptance criteria:** Seluruh gate lokal (`pnpm verify`, `pnpm test:roadmap`, `pnpm automation:check:roadmap`, `pnpm api:addon:check`, `pnpm board:ui:check`, `node scripts/check-docs.mjs`, suite unit/E2E/adversarial) dan seluruh lane hosted CI (`quality-and-build`, `unit-tests`, `knowledge-gate`, `postgres-integration`) lulus pada exact pushed SHA di `origin/dev`.
- **Test evidence expectations:** Output semua suite lokal + URL run GitHub Actions CI hijau pada exact SHA `origin/dev` tercatat di `docs/roadmap/evidence/M12.14.md`.

### Langkah pelaksanaan

1. Jalankan dan verifikasi vertical slice end-to-end beserta seluruh test crash/duplicate/revocation/cost/recovery (`SLICE.1`–`SLICE.15`).
2. Audit seluruh release gates (`GATE.1`–`GATE.14`) dan E2E Tiers 1–5, lalu sinkronkan `[x]` di `todo-ai-corporation.md`, `ROADMAP.md`, dan `tasks.json`.
3. Stage file secara eksplisit, commit, push ke `origin/dev`, dan pantau hosted GitHub Actions CI hingga seluruh job lulus 100%.

### Verifikasi dan syarat selesai

Seluruh `BASE.17`–`BASE.30`, `AI0`–`AI11`, `DOC`, `GATE`, `SLICE`, dan `PR` terverifikasi lengkap dan CI `origin/dev` hijau. Catat hasil dalam `docs/roadmap/evidence/M12.14.md`.
