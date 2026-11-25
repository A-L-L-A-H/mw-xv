# Strategic Decision Playbook

Gunakan playbook ini untuk mengubah temuan dan ide menjadi pilihan strategis yang jelas, dapat dipertanggungjawabkan, dan reversible bila memungkinkan.

## 1. Strategic framing

Mulailah dengan menjawab:

- Siapa pengguna/aktor yang dilayani? Apa yang mereka coba capai?
- Problem mana yang paling bernilai untuk diselesaikan?
- Apa keunggulan atau aset unik yang sudah dimiliki repository?
- Apa constraint yang benar-benar tidak dapat diubah?
- Apa differentiator yang diharapkan, dan apakah ada bukti?
- Apa yang bukan tujuan proyek?

Pisahkan project vision yang dinyatakan dari vision yang disimpulkan. Jangan mengarang target market, revenue, adoption, atau business model.

## 2. Strategic thesis

Susun satu atau beberapa thesis dalam format:

- We believe: key proposition.
- Because: evidence and reasoning.
- Therefore: capability or direction to pursue.
- We will not: explicit exclusions/trade-offs.
- We will know by: measurable or observable signals.
- Revisit when: trigger that could invalidate the thesis.

Thesis adalah hipotesis strategi, bukan fakta.

## 3. Capability and leverage mapping

Petakan:

- Existing capabilities and maturity.
- Shared primitives and reusable foundations.
- Missing enablers.
- Capability dependencies.
- User/system outcomes enabled by each capability.
- Operational, security, and maintenance cost.

Gunakan hubungan foundation → capability → outcome. Bedakan direct leverage dari speculative downstream effects. Prioritaskan fondasi yang menyelesaikan masalah nyata atau membuka opsi dengan nilai jelas, bukan fondasi abstrak tanpa konsumen.

## 4. Option space: build / buy / integrate / fork / partner / defer / stop

Untuk setiap kebutuhan penting, bandingkan opsi:

| Option    | Meaning                              | Evaluate                                                    |
| --------- | ------------------------------------ | ----------------------------------------------------------- |
| Build     | Implementasi sendiri                 | Control, fit, cost, maintenance, differentiation            |
| Buy       | Menggunakan layanan/produk komersial | Total cost, vendor lock-in, data, availability, portability |
| Integrate | Memakai proyek/library yang ada      | API fit, maturity, security, license, upgrade path          |
| Fork      | Memodifikasi proyek open-source      | Upstream divergence, merge burden, license, ownership       |
| Partner   | Integrasi atau kolaborasi            | Dependency, governance, continuity, incentives              |
| Defer     | Menunda sampai ada bukti/trigger     | Cost of waiting, opportunity loss, option value             |
| Stop      | Tidak mengerjakan atau menghapus     | Sunk cost, alternatives, user impact, migration             |

Jangan menganggap build selalu lebih baik atau buy selalu lebih murah. Hitung total cost of ownership secara kualitatif bila angka tidak tersedia.

## 5. Architecture and product evolution choices

Untuk keputusan utama:

1. Rumuskan keputusan dan constraint.
2. Buat 2–4 opsi nyata, termasuk status quo dan opsi sederhana.
3. Cari bukti implementasi dan compatibility.
4. Nilai trade-off: complexity, operability, security, performance, cost, lock-in, UX, reversibility.
5. Identifikasi migration path dan transition risk.
6. Catat strongest counterargument.
7. Pilih keputusan sementara atau eksperimen yang mengurangi uncertainty.
8. Tentukan kondisi untuk revisit.

Jangan membuat pilihan teknologi hanya karena sedang trending atau familiar bagi model.

## 6. Scenario planning

Buat 2–4 skenario yang relevan, misalnya:

- Continuity: kebutuhan dan constraint berkembang bertahap.
- Growth/stress: volume, pengguna, integrations, or complexity bertambah.
- Constraint shock: budget, staff, bandwidth, vendor, or infrastructure terbatas.
- Technology/ecosystem shift: dependency, standard, platform, or user expectations berubah.

Untuk setiap skenario:

- Apa yang berubah?
- Apa dampak pada produk dan arsitektur?
- Apa yang menjadi bottleneck?
- Kemampuan apa yang menjadi penting?
- Keputusan sekarang mana yang robust di beberapa skenario?
- Apa early warning signal?
- Apa yang sebaiknya tidak dilakukan sampai ada bukti?

Skenario adalah stress tests, bukan prediksi. Gunakan horizon yang relevan dan hindari tanggal/angka tanpa dasar.

## 7. Future-back roadmap

Dari strategic outcome yang diinginkan:

1. Tentukan capabilities yang dibutuhkan.
2. Uraikan prerequisite dan dependency.
3. Identifikasi keputusan yang bersifat irreversible atau mahal.
4. Pisahkan foundations, experiments, and delivery milestones.
5. Susun urutan yang menjaga pilihan masa depan tetap terbuka.
6. Tentukan trigger untuk mempercepat, menunda, atau mengubah arah.

Roadmap harus berbasis dependency dan learning gates, bukan tanggal kalender fiktif.

## 8. Stop / remove / simplify / replace

Untuk setiap kandidat yang diusulkan untuk dihentikan:

- Apa yang ada sekarang?
- Siapa/apa yang bergantung padanya?
- Apakah masih digunakan?
- Apa bukti rendahnya nilai atau tingginya biaya?
- Alternatif atau migration path?
- Dampak terhadap backward compatibility dan user?
- Rollback plan?
- Apa risiko jika dibiarkan?

Jangan hapus fitur atau dependency hanya karena tampak tidak digunakan dari satu pencarian. Verifikasi reference, dynamic loading, runtime configuration, external consumers, and tests.

## 9. Decision record

Gunakan template:

### DEC-XXX — Decision title

- Status: Proposed / Accepted / Rejected / Superseded.
- Context:
- Problem:
- Options considered:
- Evidence:
- Assumptions:
- Trade-offs:
- Strongest counterargument:
- Decision and rationale:
- Migration/compatibility:
- Security/operations:
- Reversibility:
- Reconsideration trigger:
- Related findings, ideas, and tasks:

Keputusan besar tidak boleh hanya berupa kalimat “gunakan teknologi X”. Catat mengapa opsi lain tidak dipilih.

## 10. Decision quality gate

Sebelum merekomendasikan keputusan:

- Apakah problem nyata dan penting?
- Apakah status quo atau solusi yang lebih sederhana sudah dibandingkan?
- Apakah evidence sesuai dengan versi dan konteks repository?
- Apakah biaya operasional dan maintenance ikut dihitung?
- Apakah license, privacy, security, and lock-in diperiksa?
- Apa counterargument terbaik?
- Apa yang dapat membuktikan kita salah?
- Apakah ada eksperimen lebih murah daripada keputusan permanen?

## 11. Required output

1. Strategic context and thesis.
2. Capability/leverage map.
3. Strategic option comparison.
4. Scenario implications and early-warning signals.
5. Recommended decisions with strongest counterarguments.
6. Stop/remove/simplify/replace candidates.
7. Future-back capability milestones.
8. Decision records and revisit triggers.
