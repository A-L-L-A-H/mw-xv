# MoonWitness AI Corporation — Research Register

**Prepared:** 2026-11-21  
**Purpose:** Record the research signals, comparable projects, design implications and novelty limits behind the Grand Plan.

## 1. Executive synthesis

The evidence points to five engineering truths:

1. Multi-agent systems can fail through task duplication, contradictory results, bad handoffs, misaligned roles and premature termination. More agents are not automatically better.
2. Long-running projects need continuity: previous accepted behavior and requirements must be checked after later changes.
3. Memory should be evaluated by its effect on future actions and transfer, not just retrieval quality.
4. MCP and A2A solve complementary boundaries: agent-to-tool and agent-to-agent.
5. Reliable autonomy requires deterministic permissions, isolation, audit, verification and recovery outside the model prompt.

The research opportunity for MoonWitness is to integrate these in a metadata-driven, ORM Addon-First domain system with a persistent obligation ledger and evidence-carrying work.

## 2. Research papers and specifications

### R1 — Why Do Multi-Agent LLM Systems Fail?

- **Authors:** Cemri et al.
- **Venue:** NeurIPS 2025, Datasets and Benchmarks Track.
- **What it contributes:** MAST failure taxonomy, 14 failure modes grouped into system design, inter-agent misalignment and task verification; MAST-Data includes 1,600+ annotated traces across seven frameworks.
- **MoonWitness implication:** all run outcomes should be classified, not merely pass/fail. Include duplicate work, role mismatch, missed handoff, contradiction, tool failure, verifier failure and premature stop in trace review.
- **Limitation:** taxonomy is not exhaustive and benchmark traces do not prove real-world incident rates.
- **Link:** https://proceedings.neurips.cc/paper_files/paper/2025/hash/b1041e52d3be19f0a9bc491657488e4a-Abstract-Datasets_and_Benchmarks_Track.html

### R2 — LLM-Based Multi-Agent Orchestration: A Survey of Frameworks, Communication Protocols, and Emerging Patterns

- **Venue:** Future Internet, 2026.
- **What it contributes:** distinguishes workflow orchestration from organization-level coordination; surveys centralized, decentralized and hierarchical patterns; explains why MCP (agent-to-tool) and A2A (agent-to-agent) should remain complementary.
- **MoonWitness implication:** two control loops: a deterministic workflow controller and a bounded organization-adaptation controller. The org optimiser may propose staffing changes but cannot alter security/authority policy.
- **Limitation:** literature and implementations evolve quickly; framework comparisons are snapshot-dependent.
- **Link:** https://www.mdpi.com/1999-5903/18/6/326

### R3 — Long-Horizon Software Engineering Agents: From Tasks to Projects

- **Authors:** Luo et al., researchers from NUS, HKBU, CUHK, Waterloo and ANU.
- **Date:** 2026 survey.
- **What it contributes:** shifts evaluation from isolated issue solving to continuing projects; distinguishes retained functionality from conformance to active requirements; emphasizes selective revision.
- **MoonWitness implication:** accepted deliverables should create persistent obligations, and future changes should re-evaluate affected obligations.
- **Limitation:** this is a survey and proposed evaluation framework, not proof that a specific obligation graph solves the problem.
- **Link:** https://longhorizonswe.github.io/

### R4 — Benchmarking Agent Memory in Interdependent Multi-Session Agentic Tasks (MemoryArena)

- **Authors:** He et al.
- **Venue:** ICML 2026, PMLR 306, pp. 41975–42005.
- **What it contributes:** evaluates whether memory acquired in earlier sessions improves later actions in interdependent tasks; reports a gap between conversational recall benchmarks and real agentic memory use.
- **MoonWitness implication:** memory promotion must be evaluated on later tasks, not on whether stored facts can be recalled.
- **Link:** https://proceedings.mlr.press/v306/he26am.html

### R5 — Memory-Centric Continual Learning for AI Agents

- **Authors:** Li et al.
- **Date:** 21 October 2026, arXiv:2610.29357 (preprint).
- **What it contributes:** proposes a memory-centric continual-learning framing with memory substrates, assets and management policies; suggests two loops for memory updates and policy improvement; evaluates retention, adaptation and task transfer.
- **MoonWitness implication:** keep memory updates separate from policy updates; version both; evaluate interference, transfer and cost.
- **Limitation:** preprint; the framework is a research direction, not a settled standard.
- **Link:** https://arxiv.org/abs/2610.29357

### R6 — Delivered, Not Used: Evaluating Agent Memory at Its Point of Use

- **Authors:** Xu et al.
- **Date:** 1 November 2026, arXiv:2611.01718 (preprint).
- **What it contributes:** checks whether delivered memory is actually read, relevant, novel, influences an action and changes its consequence.
- **MoonWitness implication:** instrument memory delivery/use/effect; measure harmful memory and unused memory. Do not count retrieval as learning.
- **Limitation:** preprint and benchmark scope; results should not be generalized to all agents without replication.
- **Link:** https://arxiv.org/abs/2611.01718

### R7 — Model Context Protocol, 2026-07-28 Specification

- **Maintainers:** MCP project.
- **What it contributes:** stateless protocol core, multi-round-trip requests, header-based routing, cacheable list results and authorization hardening.
- **MoonWitness implication:** expose approved ORM-backed operations via MCP adapters. Do not make MCP server state the authoritative business state.
- **Link:** https://blog.modelcontextprotocol.io/posts/2026-07-28/

### R8 — Agent2Agent (A2A) Protocol

- **What it contributes:** Agent Cards, task-oriented interactions, stateful task lifecycle, artifacts, status updates and authorization requirements for peer-agent work.
- **MoonWitness implication:** introduce an A2A adapter only when cross-runtime agent collaboration is required. Map all remote tasks to internal request/run/evidence identifiers.
- **Link:** https://a2a-protocol.org/latest/specification/agent-card/

### R9 — Security guidance for agentic systems

- **Sources:** OWASP DevSecOps AI Agent and MCP Security; NCSC guidance; Microsoft Secure Agentic Systems.
- **Common themes:** least privilege, time-bounded access, sandboxing, explicit action schemas, deterministic human approval, secret protection, monitoring, incident response and tool-output prompt-injection defense.
- **MoonWitness implication:** enforce capability checks outside the model; default no authority; use unique agent identities and ephemeral capabilities.
- **Links:**
  - https://owasp.github.io/DevSecOpsGuideline/2-Process/2-2-Develop/2-2-5-AI-Agent-and-MCP-Security/
  - https://www.ncsc.gov.uk/sites/default/files/2026-06/Thinking-carefully-before-adopting-agentic-AI.pdf
  - https://learn.microsoft.com/en-us/security/zero-trust/sfi/secure-agentic-systems

### O1 — OpenTelemetry GenAI conventions

- **What it contributes:** emerging trace conventions for agent invocations, planning, model inference, retrieval and tool execution.
- **MoonWitness implication:** standardize traces so a goal can be followed through jobs, agent runs, provider calls, tools, verifiers and obligations.
- **Status:** conventions are in development; pin versions and avoid treating unstable fields as permanent API.
- **Link:** https://github.com/open-telemetry/semantic-conventions-genai

## 3. GitHub projects reviewed (21 November 2026)

GitHub stars/trend gains are only momentum indicators. They are not a substitute for security review, architecture fit, license review, or local testing.

| Project | Signal / pattern | What MoonWitness should learn | What not to copy blindly |
|---|---|---|---|
| [SoduWork](https://github.com/mdiri-ai/SoduWork) | Strong weekly GitHub momentum; self-hosted team-agent workspace; public beta | Acceptance criteria, separate reviewer, human sign-off, plugins as reusable team procedures, model/harness dispatch, audit | Do not make a third-party hub the MoonWitness source of truth; public beta requires evaluation |
| [LoopForge](https://github.com/Tencent/LoopForge) | Strong weekly momentum; Tencent; MIT | Docker workspaces, role-based delegation, checkpoints, SOPs, approval gates, repeatable development process | Coding workflow is not the entire company/ERP domain; do not duplicate request, workflow or jobs |
| [Paperclip](https://github.com/PaperclipAI/paperclip) | Mature and high adoption in AI-company orchestration | Company goals, reporting structure, budgets, agents as employees, heartbeat scheduling | Do not copy a second org/task database into MoonWitness |
| [OpenHands Software Agent SDK](https://github.com/OpenHands/software-agent-sdk) | Modular agent execution SDK, local or ephemeral workspace | Treat coding harness as replaceable runtime adapter; isolate workspaces | Avoid bringing the entire runtime into core monorepo without a measured need |
| [DeepSeek dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) | Fast-moving research prototype | Event-triggered proactive work, separate workspace, exception panel, only act when requested/allowed | The authors explicitly say it is research code and not production-ready |
| [Letta](https://github.com/letta-ai/letta) | Stateful agent and memory system | Compare memory blocks, versioning, agent state and memory APIs | Do not create a parallel memory source before comparing with MoonWitness knowledge contracts |
| [Graphiti](https://github.com/getzep/graphiti) | Temporal knowledge graph for agent memory | Temporal relationships, change-aware memory retrieval | Do not add graph DB until relational proof-of-concept demonstrates a search/scale gap |
| [Mem0](https://github.com/mem0ai/mem0) | Memory infrastructure | Compare memory lifecycle and integration model | Do not equate automatic extraction with validated learning |

**Trend snapshot:** third-party GitHub trend trackers on 21 November 2026 ranked SoduWork and LoopForge among the fastest-rising multi-agent projects that week; Paperclip remained a heavily starred orchestration project. Metrics vary across trackers and timestamps. See https://upstar.dev/t/ai-agents and https://makerrelay.com/trending/topic/multi-agent.

## 4. Candidate novelty and prior-art discipline

### Candidate contribution

**Proof-Carrying Continuity for Adaptive Agent Organizations:** a system in which persistent obligations, evidence, organizational authority, execution artifacts and measured memory utility are linked through one typed domain model.

### What seems potentially differentiated

- ORM Addon-First as the organizational and authority ontology rather than a separate PM app.
- Accepted output creates active obligations that later work must preserve, revise or explicitly supersede.
- Evidence is attached to task acceptance and continuing obligations, not only to one final answer.
- Memory promotion is tied to later measurable outcomes and obligation retention.
- Organization adaptation is constrained by a fixed policy/authority graph.

### What is already known / overlapping

- Paperclip already manages AI employee hierarchy, goals, tasks, budgets and heartbeats.
- SoduWork already uses acceptance criteria, independent AI review, human sign-off and reusable plugins.
- LoopForge already provides sandboxed coding workspaces, checkpoints and repeatable SOPs.
- AgentVerse and related research examine dynamic expert recruitment and organization-level adaptation.
- Provenance, evidence graphs, external memory and long-horizon regression evaluation all have prior art.

### Novelty rule

Do not say “the first,” “never built before,” or “AGI architecture” until a formal related-work review, implementation comparison, and independent benchmark show a defensible distinction. The near-term defensible claim is that MoonWitness is **exploring an integrated architecture and benchmark** for this combination.

## 5. Research experiments to run

1. **Obligation continuity experiment:** task-only vs obligation-aware runs on the same evolving project; measure retained functionality and conformance.
2. **Evidence contract experiment:** self-report completion vs evidence manifest + deterministic verifier + independent reviewer.
3. **Memory utility experiment:** no memory vs retrieval-only vs procedural memory vs outcome-gated memory; use interdependent multi-session tasks.
4. **Adaptive team experiment:** fixed teams vs dynamically composed teams under identical budgets; measure task success, coordination errors, total cost and latency.
5. **Communication experiment:** broadcast vs capability-filtered publish/subscribe; measure information loss and token overhead.
6. **Recovery experiment:** inject crash, provider timeout, stale lease, duplicate delivery, interrupted approval, corrupted artifact and conflicting agent outputs.
7. **Cross-domain transfer experiment:** reuse a verified procedure across coding, research, document production and data analysis; measure transfer gain and negative transfer.
8. **Safety experiment:** prompt-injection corpus across issue text, web content, tool output and documents; measure unauthorized action rate and recovery quality.

## 6. Reference register

- Cemri et al., NeurIPS 2025, MAST: https://proceedings.neurips.cc/paper_files/paper/2025/hash/b1041e52d3be19f0a9bc491657488e4a-Abstract-Datasets_and_Benchmarks_Track.html
- Multi-Agent Orchestration survey, Future Internet 2026: https://www.mdpi.com/1999-5903/18/6/326
- Long-Horizon SWE survey 2026: https://longhorizonswe.github.io/
- MemoryArena, ICML 2026: https://proceedings.mlr.press/v306/he26am.html
- Memory-Centric Continual Learning, arXiv 2610.29357: https://arxiv.org/abs/2610.29357
- MemUse, arXiv 2611.01718: https://arxiv.org/abs/2611.01718
- MCP 2026-07-28: https://blog.modelcontextprotocol.io/posts/2026-07-28/
- A2A specification: https://a2a-protocol.org/latest/specification/agent-card/
- OWASP AI Agent & MCP Security: https://owasp.github.io/DevSecOpsGuideline/2-Process/2-2-Develop/2-2-5-AI-Agent-and-MCP-Security/
- OpenTelemetry GenAI conventions: https://github.com/open-telemetry/semantic-conventions-genai
- GitHub trend snapshot: https://upstar.dev/t/ai-agents
- MoonWitness README: https://github.com/A-L-L-A-H/mw-xv
- MoonWitness ROADMAP: https://github.com/A-L-L-A-H/mw-xv/blob/main/ROADMAP.md
