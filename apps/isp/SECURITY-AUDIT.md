# M19.04 — ISP Rust dependency advisory triage

Audit base: `apps/isp/Cargo.lock` at 292 crates, 1568 advisories, 2026-11-26.
Owner of this triage: MoonWitness Dev (ISP platform). Review date: 2026-11-26.
Expiry for both exceptions: **2026-12-31**, or immediately when a patched
`sqlx-sqlite` 0.8.x release becomes available — whichever comes first.

| Advisory | Crate | Reachable in runtime graph? | Disposition |
|---|---|---|---|
| RUSTSEC-2026-0459 (CVE-2026-119375, local info disclosure, CVSS 6.8) | libsqlite3-sys 0.30.1 | Yes — `sqlx-sqlite 0.8.6 → sqlx 0.8.6 → moonwitness-isp` | Time-bound exception until sqlx 0.8.x ships a compatible patched `libsqlite3-sys`. |
| RUSTSEC-2023-0071 (Marvin timing attack, CVSS 3.1 base 5.9) | rsa 0.9.10 | No — only `sqlx-mysql`, which is not enabled by this crate's feature set (`cargo tree -i rsa` and `--target all` both report no reverse dependencies). | Time-bound exception: not in any compiled target; remove when sqlx drops the stale optional lock entry. |

The unmaintained-chrono warning (RUSTSEC-2026-0543) was resolved by removing
the unused `chrono` feature from the sqlx dependency in `apps/isp/Cargo.toml`;
`cargo tree -i chrono` now reports no package and `cargo audit` no longer emits
the warning.

## Why not simply upgrade?

- `libsqlite3-sys >= 0.39.0` is a different semver major line. Cargo reports
  `sqlx-sqlite 0.8.6` requires `^0.30.1`; `cargo update -p libsqlite3-sys --precise 0.39.0`
  fails resolution.
- `sqlx 0.9.1` removes `runtime-tokio-rustls` and introduces `SqlSafeStr`
  bounds on `sqlx::query`; trialing it broke compilation of the ISP runtime.
  Migrating is a separate, larger change that must not be smuggled into a
  dependency-advisory task.
- `rsa` is not compiled; the advisory cannot be exercised by this binary.

## Reproduction

```bash
cd apps/isp
cargo audit --ignore RUSTSEC-2026-0459 --ignore RUSTSEC-2023-0071
cargo test --quiet        # 22 passed, 0 failed
```

No HIGH/CRITICAL advisory is untriaged. Both remaining findings are medium,
reachability-analyzed, owned, dated, and time-bounded above. No production
device or credential was involved.
