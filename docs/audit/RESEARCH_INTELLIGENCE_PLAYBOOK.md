# Research Intelligence Playbook

Panduan untuk riset teknologi, open-source, standar, kompetitor, problem signals, dan technology radar yang berhubungan langsung dengan repository.

## 1. Research objective

Riset bukan lomba mengumpulkan link. Setiap pencarian harus menjawab pertanyaan dan mengubah pemahaman, pilihan teknis, atau peluang proyek. Mulai dari problem dan konteks repository, lalu perluas pencarian.

## 2. Three-circle research model

### Circle 1 — Direct domain

Cari produk, library, framework, standar, dan implementasi yang menyelesaikan problem yang sama.

### Circle 2 — Adjacent domain

Cari sistem yang menghadapi constraint serupa meski kategorinya berbeda: workflow, scale, trust, collaboration, offline use, extensibility, cost, or automation.

### Circle 3 — Distant domain

Cari prinsip dari domain yang tidak berhubungan langsung, seperti game systems, logistics, biology, compilers, distributed systems, knowledge graphs, robotics, manufacturing, or marketplaces. Transfer prinsip, bukan fitur permukaan. Uji apakah analoginya valid.

## 3. Source hierarchy

Prioritaskan:

1. Official specifications, standards, RFCs, security advisories, vendor/framework docs, and source code.
2. Release notes, maintainers' issue trackers, design proposals, technical talks by implementers, and engineering postmortems.
3. Peer-reviewed research and credible academic preprints.
4. Independent technical evaluations with transparent methods.
5. Community discussion and user reports as discovery signals, not definitive facts.
6. Marketing material only for claims about stated positioning, never as independent proof of technical quality.

For each material claim capture source title, author/organization, URL, published/updated date if available, access date, relevant section, claim supported, version applicability, and limitations.

## 4. Research workflow

1. Formulate a research question tied to a repository finding, decision, or innovation candidate.
2. Search authoritative sources and exact implementations.
3. Inspect the actual feature, code, release, or specification; do not infer capability from a project description alone.
4. Compare version and maturity against the repository stack.
5. Seek independent or counter evidence.
6. Extract the mechanism/pattern, not just the feature name.
7. Explain what to adopt, adapt, test, reject, or monitor.
8. Stop when additional research is unlikely to change the decision; record unresolved uncertainty.

For current or fast-changing claims, verify recent dates and current official documentation. Do not present old information as current. If browsing is unavailable, say so and do not pretend current verification occurred.

## 5. Open-source intelligence

Assess a reference project by:

- Maintainer and release activity.
- Open and closed issue patterns, contribution responsiveness, and project governance.
- License and compatibility.
- Architecture and implementation evidence.
- Documentation and testing maturity.
- Security posture and known advisories.
- Extension points, ecosystem, interoperability, and migration cost.
- Operational burden, hosting requirements, and dependency risk.

Stars, downloads, forks, and trending status are weak signals, not quality verdicts. Include date and context when using them. Study small projects if they demonstrate a mechanism worth learning.

## 6. Research comparison matrix

| Reference | Domain circle | Mechanism/capability | Evidence | Maturity | Strength | Limitation | Repository implication |
| --------- | ------------- | -------------------- | -------- | -------- | -------- | ---------- | ---------------------- |

Classify a technology's maturity as:

- Production-proven in relevant use cases.
- Established but context-dependent.
- Emerging with limited field evidence.
- Experimental/research.
- Abandoned/deprecated/unsupported, if verified.

Do not use a paper's research result as proof of production readiness. Distinguish theoretical result, prototype, benchmark, field deployment, and maintained implementation.

## 7. Technology radar

For important technologies, record:

- Name and role.
- Current project usage: adopted / trial / assessed / not used.
- Maturity and evidence.
- Potential benefit for this repository.
- Constraints, license, security, compatibility, and switching cost.
- Recommended action: adopt / trial / assess / hold / avoid.
- Trigger for revisiting the decision.

A radar entry is not automatically a task. Create an experiment or implementation task only after opportunity validation.

## 8. Pain-point and unmet-need research

Where public evidence exists, inspect:

- Repeated issues and feature requests.
- Workarounds in discussions.
- User complaints and workflow friction.
- Integration failures and migration pain.
- Documentation gaps.
- Unmet needs described by maintainers or users.

Separate repeated observations from isolated anecdotes. Do not claim user demand without user evidence. A community complaint can inspire a hypothesis, not establish the target project's requirements.

## 9. Cross-domain pattern transfer

For each imported pattern:

- Original domain and problem.
- Mechanism that makes it work.
- Preconditions and constraints.
- Equivalent problem in the target repository.
- Adaptation needed.
- Why the analogy might fail.
- Small validation experiment.

Reject superficial analogies. For example, game progression is not automatically useful outside products with meaningful progression and motivation loops.

## 10. Citation and research integrity

- Attach sources to the exact claims they support.
- Prefer direct URLs to the original source.
- Report publication and access dates when available.
- Do not fabricate citations, authors, results, metrics, adoption, or release activity.
- Do not use search snippets as sole evidence for complex technical claims.
- Do not reproduce large copyrighted passages; summarize in original words.
- Keep a short bibliography of actually consulted sources, not sources merely discovered.

## 11. Required research outputs

1. Research questions and why they matter.
2. Direct, adjacent, and distant-domain reference landscape.
3. Relevant implementation patterns and source evidence.
4. Technology maturity/radar entries.
5. Pain-point and unmet-need signals.
6. Cross-domain transfer candidates.
7. Adopt/adapt/experiment/hold/reject recommendations.
8. Unresolved questions and what evidence would resolve them.
