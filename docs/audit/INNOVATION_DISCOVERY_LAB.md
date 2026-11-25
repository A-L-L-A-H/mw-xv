# Innovation Discovery Lab

Mesin eksplorasi untuk menemukan peluang yang tidak akan muncul dari checklist audit biasa. Tujuannya adalah menghasilkan ide yang orisinal, relevan, dapat diuji, dan berpotensi menciptakan nilai — bukan mengeluarkan sebanyak mungkin ide.

## 1. Discovery contract

- Divergent thinking dilakukan sebelum evaluasi ketat, tetapi tetap berpijak pada pemahaman repository.
- Convergent thinking menyaring ide berdasarkan masalah, nilai, kelayakan, risiko, dan eksperimen.
- Tidak semua lensa harus menghasilkan ide bagus. Catat hasil kosong daripada mengarang.
- Novelty bukan value; ide baru harus punya alasan mengapa dibutuhkan.
- Jangan langsung mengubah ide HYPOTHESIS menjadi task implementasi.
- Cari peluang untuk menghapus, menyederhanakan, atau mengganti, bukan hanya menambah fitur.

## 2. Discovery engines

### Engine 1 — First principles and assumption destruction

Inventarisasi asumsi tersembunyi: arsitektur, workflow, UI, storage, deployment, ownership, pricing, integration, and user behavior.

Untuk setiap asumsi material:

- Mengapa asumsi ini ada?
- Apa bukti yang mendukungnya?
- Apakah asumsi berasal dari kebutuhan nyata, batasan historis, atau kebiasaan?
- Apa yang terjadi bila asumsi dihilangkan atau dibalik?
- Apa solusi paling sederhana jika masalah dirumuskan ulang?

Gunakan pertanyaan seperti: jika memulai ulang dengan kemampuan dan constraint hari ini, apa yang akan didesain berbeda? Jangan menganggap rewrite sebagai jawaban default.

### Engine 2 — Cross-domain intelligence

Pindahkan prinsip dari domain berbeda. Pertimbangkan:

- Game systems: state, progression, feedback, simulation, emergent behavior.
- Operating systems: process, scheduling, permissions, resource management.
- Biology: adaptation, resilience, feedback, self-organization.
- Logistics: routing, allocation, capacity, optimization.
- Distributed systems: synchronization, fault tolerance, consensus, replication.
- Compilers: intermediate representations, pipelines, transformations, optimization.
- Knowledge graphs: relationships, semantic discovery, provenance.
- Marketplaces: matching, incentives, network effects.
- Robotics/manufacturing: sensing, control loops, quality gates, digital twins.

Untuk setiap analogi, jelaskan mekanisme, preconditions, target problem, adaptasi, dan alasan analogi mungkin gagal. Jangan sekadar menyarankan gamification atau menambahkan istilah dari domain lain.

### Engine 3 — Negative-space discovery

Cari ruang kosong antara kebutuhan dan kemampuan:

- Pekerjaan manual, workaround, handoff, atau data yang dipindahkan antar-tools.
- Pengguna, use case, atau workflow yang belum terlayani.
- Capability yang sudah dimungkinkan data/arsitektur tetapi belum diekspos.
- Feature yang hanya dapat dipakai developer/admin, padahal ada kebutuhan user.
- Kegagalan yang memaksa pengguna mengulang pekerjaan.
- Integrasi, observability, accessibility, or recovery paths yang hilang.

Gunakan issue trackers, discussions, docs, scripts, tests, and user research bila tersedia. Bedakan bukti dari dugaan tentang kebutuhan.

### Engine 4 — Inversion and constraint breaking

Balik asumsi secara sistematis:

- Centralized ↔ distributed/hybrid.
- Online-first ↔ offline-capable.
- Manual ↔ automated with human approval.
- Fixed workflow ↔ adaptive/composable workflow.
- UI-first ↔ API/protocol-first.
- Monolithic capability ↔ composable capabilities.
- Static configuration ↔ context-aware configuration.
- Single-user ↔ collaborative or multi-actor, bila use case mendukung.

Untuk setiap pembalikan, cek apakah constraint nyata membatasi opsi. Jangan memaksakan arsitektur alternatif yang lebih kompleks daripada manfaatnya.

### Engine 5 — Extreme future simulation

Bangun 2–4 skenario yang relevan, bukan fiksi tanpa batas:

- Adoption/workload meningkat tajam.
- Budget, compute, bandwidth, or staff sangat terbatas.
- Koneksi tidak stabil atau sistem harus berjalan offline.
- Perangkat, deployment target, atau integrasi bertambah.
- Platform/dependency utama berubah atau dihentikan.
- Threat model dan regulasi berubah.
- Agent automation menjadi bagian signifikan dari development atau operation.

Lakukan backward reasoning: kapabilitas dan keputusan apa yang perlu ada lebih awal? Tandai skenario sebagai plausible, stress test, atau speculative. Jangan menyajikannya sebagai prediksi.

### Engine 6 — Leverage-point discovery

Cari satu perubahan fondasional yang dapat membuka beberapa kemampuan:

- Stable event/contract model.
- Reusable identity and permission model.
- Extension/plugin interface.
- Unified capability API.
- Data provenance or versioning.
- Automation primitives.
- Consistent state and synchronization model.
- Reproducible environment and validation loop.

Buat capability graph: foundation → enabled capabilities → user/system outcomes. Tunjukkan dependency dan biaya agar leverage tidak diklaim berlebihan. Satu fondasi yang membuka lima fitur bukan otomatis bernilai jika tidak ada kebutuhan untuk fitur-fitur itu.

### Engine 7 — Contrarian and red-team

Ambil posisi menentang ide sendiri:

- Mengapa ide ini bisa salah?
- Apakah masalahnya cukup penting?
- Apakah solusi sederhana sudah tersedia?
- Apakah ini menambah lock-in, surface area, cost, or security exposure?
- Apa efek samping pada usability, maintainability, and operations?
- Bukti apa yang akan membuat kita membatalkan rekomendasi?
- Siapa yang mungkin tidak menginginkan perubahan ini dan mengapa?

Wajib catat strongest counterargument untuk kandidat strategis.

### Engine 8 — Future-back innovation

Bayangkan kondisi 2–3 tahun ke depan sebagai skenario, bukan prediksi pasti:

- Produk apa yang mungkin menjadi?
- Kemampuan berbeda apa yang memberi alasan untuk dipilih?
- Fondasi teknis dan operasional apa yang dibutuhkan?
- Apa yang harus mulai dibangun, dipelajari, atau divalidasi sekarang?
- Keputusan saat ini mana yang dapat menutup pilihan masa depan?

Tarik mundur menjadi capability milestones. Jangan menulis roadmap tiga tahun dengan tanggal palsu atau kepastian yang tidak ada.

## 3. Five signature concept methods

Kelima metode ini adalah lensa kreatif khas yang harus dijalankan saat Innovation Discovery Lab aktif. Gunakan sebagai cara membingkai masalah dan peluang, bukan slogan dekoratif. Satu metode boleh menghasilkan nol kandidat jika tidak ada evidence atau hubungan yang masuk akal. Catat hasilnya tanpa mengarang.

### Method 1 — FIND LIGHT IN DARKNESS

**Nama kerja:** Adversity-to-Opportunity / Shadow Signal Mining.

**Prinsip:** Masalah, kegagalan, keterbatasan, dan situasi yang paling tidak nyaman kadang menyimpan sinyal tentang kebutuhan yang belum terpenuhi. Jangan hanya menghilangkan gejala; cari kemampuan baru atau desain yang dapat lahir dari pemahaman akar masalah.

**Prosedur:**

1. Kumpulkan “dark signals”: bug berulang, incident, bottleneck, workaround, user frustration, unsupported environment, biaya tinggi, dan proses yang sering gagal.
2. Pisahkan gejala, root cause, constraint, dan konsekuensi bagi pengguna.
3. Tanyakan kebutuhan apa yang tersembunyi di balik setiap sinyal.
4. Balik pertanyaan: selain memperbaiki kegagalan, kemampuan apa yang dapat membuat sistem lebih tahan, lebih jelas, atau lebih berguna?
5. Cari kemungkinan mengubah weakness menjadi resilience, failure recovery, observability, accessibility, simplification, atau differentiator produk.
6. Uji apakah peluang itu benar-benar dibutuhkan; jangan mengubah setiap bug menjadi fitur.

**Pertanyaan pemicu:**

- Sinyal apa yang selama ini dianggap gangguan tetapi sebenarnya mengungkap kebutuhan penting?
- Siapa yang paling dirugikan oleh kondisi gelap ini dan apa yang mereka butuhkan?
- Jika masalah ini tidak bisa dihilangkan, bagaimana sistem bisa tetap memberi nilai?
- Apakah kegagalan ini dapat menjadi sumber feedback, recovery, atau pembelajaran sistem?
- Apa yang dapat ditemukan dengan mengamati edge cases, bukan happy path?

**Output wajib:** Dark Signal Register → Root Cause → Hidden Need → Opportunity Candidate → Evidence/Unknowns → Cheapest Validation.

**Guardrail:** Jangan meromantisasi kegagalan, penderitaan, insiden keamanan, atau kerugian pengguna. Prioritaskan perlindungan dan pemulihan sebelum eksplorasi peluang.

### Method 2 — ANGEL WITH A SHOTGUN

**Nama kerja:** Principled Defiance / Guardian's Challenge.

**Creative anchor:** “Sometimes to win you have to sin, but don't mind, I'm not a believer.” Gunakan sebagai metafora untuk berani menantang konvensi, bukan izin untuk melakukan pelanggaran.

**Prinsip:** Beberapa asumsi, kebiasaan industri, legacy constraints, dan aturan internal mungkin bukan hukum alam. Tantang hal-hal tersebut secara berani untuk menemukan jalan yang lebih efektif. Namun, bedakan konvensi yang boleh ditantang dari batas etika dan keselamatan yang tidak boleh dilanggar.

**Prosedur:**

1. Daftar aturan, kebiasaan, pola arsitektur, workflow, atau dogma produk yang dianggap “selalu harus begitu”.
2. Untuk masing-masing, klasifikasikan: hard boundary, external contract, safety/security requirement, legal/privacy obligation, compatibility constraint, atau convention yang dapat diuji.
3. Tanyakan siapa atau apa yang dilindungi oleh aturan tersebut. Jangan menghapus perlindungan sebelum memahami alasan keberadaannya.
4. Bentuk alternatif berani yang menentang convention, bukan melanggar hukum, hak pengguna, privasi, consent, keselamatan, atau batas keamanan.
5. Cari opsi non-konvensional yang lebih sederhana, lebih terbuka, lebih cepat dipelajari, atau memberi kontrol lebih besar kepada pengguna.
6. Uji dengan prototype/simulation terbatas dan reversible. Pertahankan fallback.
7. Minta red-team menguji dampak buruk, abuse case, serta siapa yang dapat dirugikan.

**Pertanyaan pemicu:**

- “Kita harus melakukan ini” — siapa yang menetapkan, kapan, dan berdasarkan bukti apa?
- Apakah aturan ini melindungi sesuatu yang nyata atau hanya mempertahankan kebiasaan?
- Apa versi paling berani yang tetap aman, legal, adil, dan dapat dibatalkan?
- Apakah kita dapat membuang konvensi tanpa membuang perlindungan?
- Apa yang akan dicoba tim kecil yang tidak dibebani legacy assumptions?

**Output wajib:** Convention Register → Protected Boundary → Challenged Assumption → Bold Alternative → Risk/Abuse Review → Reversible Experiment → Decision.

**Guardrail mutlak:** “Angel with a Shotgun” adalah simbol keberanian, perlindungan, dan perlawanan terhadap asumsi usang — bukan instruksi, glorifikasi, atau pembenaran kekerasan. Jangan merekomendasikan pelanggaran hukum, perusakan, manipulasi, eksploitasi, pelanggaran privasi, bypass kontrol keamanan, atau tindakan yang membahayakan orang. “Sin” di sini hanya metafora untuk melanggar konvensi yang tidak sakral, bukan melanggar batas etika atau keselamatan.

### Method 3 — SUNSHINE BELONG

**Nama kerja:** Emergence / Exit Toward the Light.

**Prinsip:** Kemampuan atau pengetahuan yang bernilai tidak seharusnya terperangkap dalam silo, workflow gelap, interface tersembunyi, atau hanya dapat diakses oleh segelintir ahli. Cari jalan agar kemampuan itu “keluar menuju cahaya”: dapat ditemukan, dipahami, diakses, digunakan, dan memberi manfaat pada konteks yang lebih luas.

**Prosedur:**

1. Temukan kemampuan, data, dokumentasi, atau workflow yang ada tetapi tersembunyi, sulit ditemukan, atau hanya diketahui maintainer.
2. Petakan penghalang: permission, UX, jargon, setup, format tertutup, integrasi, biaya, accessibility, atau kurangnya dokumentasi.
3. Tentukan siapa yang seharusnya dapat memanfaatkan kemampuan tersebut.
4. Rancang jalur keluar yang aman: onboarding, discoverability, API, export, standard protocol, extension point, guided workflow, documentation, atau simpler interface.
5. Uji apakah pembukaan akses menambah manfaat tanpa membocorkan data atau memperlebar permission secara tidak perlu.
6. Ukur keberhasilan dengan kemampuan pengguna menyelesaikan pekerjaan, bukan sekadar jumlah menu atau fitur yang ditampilkan.

**Pertanyaan pemicu:**

- Kemampuan apa yang ada tetapi tidak terlihat oleh pengguna yang tepat?
- Apa yang harus keluar dari silo agar dapat memberi nilai lebih besar?
- Apakah sistem dapat menjadi lebih mudah dimasuki tanpa menjadi kurang aman?
- Bagaimana pengguna berpindah dari kebingungan menuju pemahaman dan kendali?
- Jalur mana yang menghubungkan aset internal dengan ekosistem eksternal?

**Output wajib:** Hidden Capability → Access Barrier → Beneficiary → Safe Exit Path → Adoption/Usability Signal.

**Guardrail:** “Terbuka” bukan berarti public-by-default. Pertahankan least privilege, consent, data ownership, privacy, accessibility, dan kontrol pengguna.

### Method 4 — HOW YOU REMIND ME

**Nama kerja:** Reflective Memory / Pattern-to-Learning.

**Prinsip:** Sistem dan tim sering mengulangi masalah karena pengalaman sebelumnya hilang, tidak terhubung, atau tidak berubah menjadi guardrail. Gunakan sejarah proyek sebagai memori operasional untuk menemukan pola, belajar, dan mencegah pengulangan — bukan untuk menyalahkan individu.

**Prosedur:**

1. Kumpulkan jejak yang tersedia: issue, incident, PR, commit, test regression, support feedback, decision record, changelog, dan TODO lama.
2. Cari pola pengulangan: bug sejenis, keputusan yang dibatalkan, workaround berulang, regressions, pertanyaan onboarding, dan dependency yang sering bermasalah.
3. Rekonstruksi konteks: apa yang diketahui pada waktu itu, alasan keputusan, constraint, dan dampaknya.
4. Bedakan kesalahan yang sama dari gejala mirip dengan root cause berbeda.
5. Tanyakan apa yang seharusnya diingat sistem: contract, test, warning, documentation, automation, ADR, migration note, atau user preference yang sah.
6. Ubah pelajaran menjadi mekanisme yang dapat diuji dan dipelihara.
7. Periksa apakah mekanisme baru benar-benar mencegah pengulangan tanpa menciptakan noise atau beban berlebih.

**Pertanyaan pemicu:**

- Masalah apa yang sudah pernah kita selesaikan tetapi muncul kembali?
- Keputusan mana yang tidak diingat oleh developer atau coding agent berikutnya?
- Apa yang gagal dipelajari dari incident, PR review, atau regression?
- Informasi apa yang harus menjadi memory sistem, bukan hanya ingatan seseorang?
- Bagaimana kita tahu bahwa pelajaran benar-benar mencegah pengulangan?

**Output wajib:** Historical Signal → Repeated Pattern → Context/Root Cause → Lesson → Durable Memory/Guardrail → Regression Check.

**Guardrail:** Gunakan data secara proporsional. Jangan menyimpan secret, data pribadi yang tidak perlu, atau membuat profil sensitif. Hormati retention, consent, access control, dan konteks historis. Jangan menyimpulkan kesalahan individu dari artefak teknis yang tidak lengkap.

### Method 5 — WHEN THE MOON IS HIGH, WE SHARE A MESSAGE

**Nama kerja:** Shared Moment / Context-Aware Signal Synchronization.

**Creative anchor:** MoonWitness — “When the moon is high, we share a message.”

**Prinsip:** Komunikasi bernilai bukan hanya tentang mengirim pesan secepat mungkin. Kadang pesan menjadi bermakna ketika aktor, konteks, kesiapan, dan kesempatan bertemu pada waktu atau kondisi yang tepat. Cari mekanisme untuk menghubungkan orang, sistem, agen, atau data melalui shared context dan meaningful signals — termasuk pola asynchronous dan distributed.

**Prosedur:**

1. Petakan siapa yang perlu berbagi informasi: users, teams, services, agents, devices, atau communities.
2. Temukan momen atau kondisi ketika suatu pesan benar-benar berguna: event, state transition, availability, milestone, deadline, request, atau shared activity.
3. Bedakan message transport dari message meaning: payload, context, audience, provenance, urgency, expiry, and expected action.
4. Cari peluang asynchronous delivery, store-and-forward, subscriptions, event streams, digest, presence, or scheduled windows bila sesuai.
5. Rancang acknowledgement, delivery status, retries, deduplication, ordering, and conflict handling sesuai kebutuhan.
6. Uji apakah pesan tepat sasaran, tepat konteks, dapat ditindaklanjuti, dan tidak membanjiri penerima.
7. Pertimbangkan timezone, offline recipients, quiet hours, accessibility, and user-controlled notification preferences.
8. Definisikan kapan pesan kedaluwarsa, kapan perlu diteruskan, dan kapan tidak perlu dikirim.

**Pertanyaan pemicu:**

- Siapa yang perlu mengetahui apa, dalam konteks apa, dan untuk melakukan tindakan apa?
- Apa “moon high moment” dalam domain ini — kondisi bersama yang menandakan waktu tepat untuk bertukar sinyal?
- Bisakah pesan menunggu sampai konteksnya siap tanpa kehilangan nilai?
- Bagaimana sistem menghubungkan aktor yang tidak online secara bersamaan?
- Apa yang membuat pesan menjadi noise, stale, duplicated, atau unsafe?
- Dapatkah event yang sama menjadi sinyal koordinasi untuk banyak capability tanpa coupling yang rapuh?

**Output wajib:** Actors → Shared Context/Event → Message Contract → Delivery/Sync Model → Expected Action → Privacy/Noise Controls → Validation.

**Guardrail:** “Moon high” adalah metafora untuk konteks atau momen bersama, bukan klaim bahwa fase bulan menentukan perilaku, keputusan, atau akurasi sistem. Jangan membuat lunar timing, tracking, atau pengumpulan lokasi tanpa kebutuhan produk yang jelas, persetujuan, dan dasar yang memadai. Lindungi privasi, batasi broadcast, sediakan kontrol notifikasi, dan jangan membocorkan pesan kepada audience yang salah.

### How to combine the five methods

Gunakan kelimanya secara komplementer, bukan sebagai lima nama untuk ide yang sama:

| Method                 | Discovery question                                                         | Typical result                                 |
| ---------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| Find Light in Darkness | Apa peluang yang tersembunyi di balik kegagalan/constraint?                | Resilience, recovery, unmet need               |
| Angel with a Shotgun   | Konvensi apa yang aman untuk ditantang demi melindungi nilai yang penting? | Principled alternative, simplification         |
| Sunshine Belong        | Apa yang perlu keluar dari silo agar dapat memberi manfaat?                | Discoverability, access, interoperability      |
| How You Remind Me      | Pelajaran apa yang terus hilang atau diulang?                              | Durable memory, regression prevention          |
| When the Moon Is High  | Kapan dan bagaimana aktor berbagi sinyal dalam konteks yang tepat?         | Event/message model, asynchronous coordination |

Untuk tiap kandidat, catat method yang memunculkannya. Jika beberapa metode menemukan ide serupa, deduplicate dan catat multi-lens origin. Jangan menilai kualitas ide dari jumlah metode yang mendukungnya.

## 4. Supporting ideation methods

Gunakan metode ini bila relevan:

- Jobs-to-be-Done: progress yang ingin dicapai pengguna dan hambatannya.
- SCAMPER: substitute, combine, adapt, modify, put to another use, eliminate, reverse.
- Morphological matrix: kombinasikan alternatif untuk dimensi sistem yang berbeda.
- Theory of Constraints: identifikasi bottleneck yang membatasi keseluruhan sistem.
- Adjacent possible: capability baru yang menjadi mungkin karena aset yang sudah ada.
- Wardley-style mapping: posisi capability dan ketergantungannya dalam value chain, jika data mencukupi.
- Capability recombination: gabungkan kemampuan existing untuk use case baru.
- Failure-driven design: jadikan mode kegagalan sebagai sumber mekanisme produk yang lebih kuat.

Metode adalah lensa, bukan kewajiban untuk menyebut semua istilah di laporan.

## 5. Divergent exploration

Lakukan eksplorasi dalam tiga horizon:

### A. Adjacent innovation

Peningkatan atau kombinasi kemampuan dekat dengan produk dan aset saat ini. Potensial diuji lebih cepat.

### B. Transformational innovation

Mengubah cara user menyelesaikan pekerjaan, cara komponen bekerja sama, model interaksi, atau batas produk.

### C. Radical exploration

Kemungkinan paradigma, kategori use case, atau model teknis yang sangat berbeda. Tetap harus terkait dengan kemampuan, masalah, atau aset proyek; jika tidak, labeli sebagai speculative dan jangan prioritaskan tinggi.

Bangun candidate pool yang cukup beragam, tetapi jangan mengejar jumlah ide. Variasikan sumber inspirasi dan problem framing. Deduplicate ide yang sebenarnya sama dengan nama berbeda.

## 6. Innovation Card

Setiap kandidat yang lolos screening wajib memiliki:

| Field               | Isi                                                      |
| ------------------- | -------------------------------------------------------- |
| Innovation ID       | ID stabil, misalnya INN-001                              |
| Concept             | Nama dan gambaran ide                                    |
| Horizon             | Adjacent / Transformational / Radical                    |
| Discovery engines   | Lensa yang memunculkan ide                               |
| Source analogy      | Domain/pola asal dan mekanismenya                        |
| User/problem        | Siapa terdampak dan problem apa                          |
| Current limitation  | Bukti kondisi repository                                 |
| Novelty             | Apa yang benar-benar baru/different                      |
| Strategic fit       | Hubungan dengan tujuan produk                            |
| Enablers            | Capability, data, API, architecture, or ecosystem needed |
| Leverage            | Dampak turunan dan dependency graph                      |
| Feasibility         | Alasan dan maturity                                      |
| Unknowns            | Hal yang belum diketahui                                 |
| Risks/trade-offs    | Security, privacy, cost, UX, operations, lock-in         |
| Cheapest experiment | Cara termurah menguji                                    |
| Success signal      | Hasil yang mendukung hipotesis                           |
| Kill criteria       | Bukti/kondisi untuk menghentikan                         |
| Decision            | Experiment / Adopt / Defer / Reject                      |

## 7. Novelty and value test

Jangan menyebut ide “first”, “unique”, atau “revolutionary” tanpa pencarian dan bukti yang memadai. Gunakan istilah yang terukur:

- New to this repository.
- Uncommon in the reviewed reference set.
- Adaptation of an established pattern.
- Potentially differentiated, not yet validated.
- Novelty unknown.

Tanyakan:

- Apakah ini hanya fitur standar dengan nama baru?
- Apakah perbedaan utamanya bermakna bagi user?
- Apakah ada produk/proyek yang telah melakukan hal serupa?
- Apakah ide ini dapat dibangun dari aset existing?
- Apakah user akan mengubah perilakunya karena ini?
- Apakah value-nya lebih besar daripada learning/maintenance cost?

## 8. Explore vs exploit portfolios

### Experiment / Innovation Portfolio

Untuk ide high-upside dan uncertain. Nilai:

- Potential upside.
- Strategic fit.
- Differentiation potential.
- Leverage.
- Cost to learn.
- Reversibility.
- Uncertainty and feasibility.

Gunakan experiment untuk mengurangi ketidakpastian, bukan membuat estimasi benefit palsu. Prioritaskan eksperimen yang memberi informasi terbesar dengan biaya terkecil.

### Execution Portfolio

Hanya untuk pekerjaan yang cukup terbukti atau keputusan strategis yang secara sadar disetujui. Gunakan backlog playbook terpisah.

Jangan membandingkan kedua portfolio hanya dengan satu angka. Risiko keamanan kritis dan bug tidak menunggu innovation scoring.

## 9. Experiment design

Setiap experiment harus menjelaskan:

- Hypothesis.
- User/problem/context.
- Smallest testable artifact or investigation.
- Time/effort boundary as estimate, not promise.
- Evidence to collect.
- Success signal.
- Kill criteria.
- Risks and rollback/disposal.
- Decision after experiment: proceed / revise / stop.

Eksperimen harus aman, legal, dan tidak menyentuh production data tanpa izin. Jangan melakukan eksperimen pada pengguna nyata tanpa persetujuan dan perlindungan yang sesuai.

## 10. Required lab output

1. Assumption register and challenged assumptions.
2. Results from each applicable discovery engine.
3. Cross-domain inspiration map.
4. Negative-space and unmet-need candidates.
5. Adjacent, transformational, and radical idea portfolio.
6. Capability/leverage graph.
7. Strongest counterarguments.
8. Experiment cards with kill criteria.
9. Rejected/deferred ideas and rationale.
10. The few ideas most likely to change the project's trajectory.

A strong result may contain only a few high-quality ideas. Do not fill every category with generic suggestions.
