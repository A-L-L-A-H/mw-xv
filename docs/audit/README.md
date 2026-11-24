# Repository Intelligence & Evolution Engine

Dokumen ini adalah pintu masuk untuk kerangka audit, riset, inovasi, dan evolusi repository.

## Mulai dari sini

1. Baca MASTER_INTELLIGENCE_PROMPT_V3.md. Dokumen ini adalah orchestrator utama.
2. Ikuti playbook yang dirujuk sesuai urutan fase. Jangan hanya membaca master lalu melewati metode pendukungnya.
3. Mulai dari kondisi repository aktual; jangan mengasumsikan project vision atau implementasi dari nama repository.
4. Default execution mode adalah READ-ONLY. Audit tidak boleh membuat perubahan, issue, branch, commit, atau deployment.
5. Hasil audit harus memisahkan temuan terverifikasi, interpretasi, hipotesis, dan pertanyaan terbuka.

## Dokumen

| Dokumen | Fungsi |
|---|---|
| [MASTER_INTELLIGENCE_PROMPT_V3.md](MASTER_INTELLIGENCE_PROMPT_V3.md) | Instruksi utama, urutan fase, orkestrasi, dan output kontrak |
| [REPOSITORY_AUDIT_PLAYBOOK.md](REPOSITORY_AUDIT_PLAYBOOK.md) | Baseline, system mapping, technical/product audit, dan coverage |
| [RESEARCH_INTELLIGENCE_PLAYBOOK.md](RESEARCH_INTELLIGENCE_PLAYBOOK.md) | Riset teknologi, open-source, kompetitor, sumber, dan technology radar |
| [INNOVATION_DISCOVERY_LAB.md](INNOVATION_DISCOVERY_LAB.md) | Eight discovery engines, five signature concept methods, cross-domain discovery, ide out-of-the-box, dan eksperimen |
| [STRATEGIC_DECISION_PLAYBOOK.md](STRATEGIC_DECISION_PLAYBOOK.md) | Pilihan strategis, leverage points, scenario planning, dan keputusan arsitektur/produk |
| [BACKLOG_ENGINEERING_PLAYBOOK.md](BACKLOG_ENGINEERING_PLAYBOOK.md) | Rekonsiliasi task, anti-overlap, agent-ready task, prioritas, dan roadmap |
| [DOMAIN_SPECIFIC_ADAPTERS.md](DOMAIN_SPECIFIC_ADAPTERS.md) | Modul khusus sesuai tipe sistem dan domain proyek |
| [REPOSITORY_INTELLIGENCE_AUDIT_PROMPT_V2.md](REPOSITORY_INTELLIGENCE_AUDIT_PROMPT_V2.md) | Versi sebelumnya; dipertahankan sebagai arsip dan baseline historis |

## Prinsip penggunaan

- V3 tidak berarti harus menghasilkan lebih banyak temuan atau task. V3 harus menghasilkan temuan yang lebih akurat, ide yang lebih orisinal, keputusan yang lebih baik, dan eksperimen yang lebih murah.
- Jalankan domain audit dan adapter secara kondisional. Tandai NOT APPLICABLE dengan alasan; jangan memaksakan checklist.
- Innovation Portfolio dan Execution Portfolio adalah dua jalur berbeda. Ide yang belum terbukti masuk eksperimen, bukan backlog implementasi wajib.
- Referensi eksternal harus benar-benar diperiksa. Popularitas, stars, atau klaim promosi bukan bukti kualitas.
- Setiap perubahan besar harus memiliki strongest counterargument, trade-off, dan cara validasi.
- Jangan membuat metrik, baseline, market size, benchmark, user demand, atau kompetensi sistem yang tidak tersedia.
- V2 tidak dihapus atau ditimpa. V3 menjadi entry point yang direkomendasikan untuk audit baru.

## Siklus kerja yang disarankan

DISCOVER → MAP → AUDIT → RESEARCH → DIVERGE → VALIDATE → DECIDE → RED-TEAM → BACKLOG → ROADMAP.

Lakukan sintesis setelah setiap fase. Hindari mengumpulkan informasi tanpa menjelaskan implikasinya terhadap repository yang sedang diaudit.