# AI Provider Capability Matrix, Data Classification & Secret Setup (`DOC.4`, `DOC.5`, `DOC.8`, `AI3.28`)

- **Status:** Accepted Runtime Specification ([ADR 0007](../decisions/0007-ai-corporation-addon-first-architecture.md) §5–6, [ADR 0008](../architecture/adr/0008-local-first-desktop-agent-harness.md) §4)
- **Implementation:** [`packages/ai-runtime/src/types.ts`](../../packages/ai-runtime/src/types.ts), [`packages/ai-runtime/src/classification-router.ts`](../../packages/ai-runtime/src/classification-router.ts), [`packages/ai-runtime/src/secrets.ts`](../../packages/ai-runtime/src/secrets.ts), [`packages/ai-runtime/src/providers/`](../../packages/ai-runtime/src/providers/shared.ts)
- **Related documents:** [AI Corporation Docs Index](README.md) · [Operator Runbook](operator-runbook.md) · [Local AI Hardware Inventory](../guide/how-to/local-ai-hardware.md)

---

## 1. Provider Adapter Capability & Compatibility Matrix (`DOC.4`, `DOC.8`, `AI3.28`)

MoonWitness separates **provider transport** (`AiProvider`), **model profile** (`ModelProfileConfig` / `ai.model_profile`), and **agent harness** (`AgentHarness` / `BoundedReadOnlyAgentRunner`).

| Provider Kind | Adapter Class              | Transport / Endpoint Contract                                                                                                                                           | Health Check (`healthCheck`)                            | Text Gen | Tool Calling                                    | Streaming                     | Structured JSON Output                                      | Token Usage Source                                                                        |
| ------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------- | ----------------------------------------------- | ----------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `mock`        | `MockProvider`             | Deterministic in-memory fixture queue (zero network calls; default CI & unit test provider)                                                                             | Synthetic deterministic (`ok: true` or scripted outage) | Yes      | Configurable (`true` default)                   | Configurable (`true` default) | Yes (`validateJsonSchema`)                                  | `provider_reported` or `estimated`                                                        |
| `ollama`      | `OllamaAdapter`            | Loopback HTTP/HTTPS (`http://127.0.0.1:11434` default); native `/api/chat` (`chat` mode) or `/api/generate` (`generate` mode) — never assumes `/v1/generate` (`AI3.14`) | `GET /api/tags` (prompt-free model list check)          | Yes      | Yes in `chat` mode (`false` in `generate` mode) | Yes (NDJSON stream)           | Yes (`format: schema` + `validateJsonSchema`)               | `provider_reported` (`prompt_eval_count` / `eval_count`) or fallback `estimated`          |
| `openai`      | `OpenAiProviderAdapter`    | HTTPS `https://api.openai.com/v1/chat/completions` (or loopback OpenAI-compatible DeepSeek / vLLM / llama.cpp when `allowLoopbackHttp: true`)                           | `GET /v1/models` (prompt-free, auth-verified)           | Yes      | Yes (`tools` / `tool_choice`)                   | Yes (SSE `data:` stream)      | Yes (`response_format: json_schema` + `validateJsonSchema`) | `provider_reported` (`usage.prompt_tokens` / `completion_tokens`) or fallback `estimated` |
| `anthropic`   | `AnthropicProviderAdapter` | HTTPS `https://api.anthropic.com/v1/messages` (`anthropic-version: 2023-06-01`)                                                                                         | `GET /v1/models` (prompt-free, `x-api-key` verified)    | Yes      | Yes (`tool_use` content blocks)                 | Yes (SSE event stream)        | Yes (schema prompt/tool envelope + `validateJsonSchema`)    | `provider_reported` (`usage.input_tokens` / `output_tokens`) or fallback `estimated`      |

### Known Limitations (`AI3.28`)

1. **Loopback Default for Ollama & Local Runtimes:** `OllamaAdapter` rejects non-loopback hosts (`localhost`, `127.0.0.1`, `::1`) unless `allowNonLoopback: true` is explicitly configured and passes HTTPS + public DNS SSRF validation (`assertPublicDnsResolution`).
2. **No Silent Capability Assumption:** If a `ProviderRequest` includes `tools` or `responseSchema` against a `ModelProfileConfig` with `toolCall: false` or `structuredOutput: false`, `validateRequestCapabilities` fails fast with `ProviderError` (`code: 'policy_blocked'`, `reasonCode: 'CAPABILITY_UNSUPPORTED'`).
3. **Response Size & Timeout Bounds:** All HTTP adapters enforce `redirect: 'error'`, per-attempt `timeoutMs` (`ProviderExecutionLimits`), concurrency semaphores, and a `2 MiB` default response size ceiling (`DEFAULT_MAX_RESPONSE_BYTES`).
4. **K0–K9 `@moonwitness/local-ai` Boundary:** `@moonwitness/local-ai` (`AI_MODE=disabled|local`) remains a separate, tool-free loopback package for K7 research suggestions and is never used as a tool-calling agent provider.

---

## 2. Data Classification & Routing Rules (`AI3.20`–`AI3.22`)

`DataClassificationRouter` ([`packages/ai-runtime/src/classification-router.ts`](../../packages/ai-runtime/src/classification-router.ts)) and [`isAllowedClassificationRoute`](../../packages/orm-ai/src/validation.ts#L154-L177) enforce fail-closed routing across three normalized classifications (`local_only` / `local-only`, `cloud_eligible` / `cloud-eligible`, `restricted`):

| Classification       |          Rank | Allowed Targets                                                                      | Cloud Egress (`openai` / `anthropic`)                                                                                                               | Cross-Boundary Fallback Policy                                                                           |
| -------------------- | ------------: | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **`restricted`**     | `3` (Highest) | Local `mock` or `ollama` targets classified `restricted` (`deploymentZone: 'local'`) | **Blocked** (`CLASSIFICATION_EGRESS_BLOCKED`) unless an explicit, non-expired `CloudEgressPolicyApproval` is registered for that company & contract | **Never** falls back to `local_only` or `cloud_eligible` targets (`CLASSIFICATION_FALLBACK_BLOCKED`)     |
| **`local_only`**     |           `2` | Local `mock` or `ollama` / loopback targets classified `local_only` or `restricted`  | **Blocked** (`CLASSIFICATION_EGRESS_BLOCKED`) unless an explicit `CloudEgressPolicyApproval` exists                                                 | **Never** falls back to cloud targets when local provider is offline (`CLASSIFICATION_FALLBACK_BLOCKED`) |
| **`cloud_eligible`** |           `1` | Local targets OR HTTPS cloud targets (`openai`, `anthropic`) when policy permits     | Allowed over HTTPS with public DNS SSRF verification                                                                                                | May fall back among eligible targets within the same policy ceiling                                      |

---

## 3. Secret Reference Convention & Rotation Guide (`DOC.5`, `AI3.23`–`AI3.24`)

1. **Zero Raw Secrets in ORM or Git:**
   - `ai.provider_profile.secret_ref` enforces `^MW_AI_(?:C[1-9][0-9]*_)?[A-Z0-9_]{1,100}$` (`AI_SECRET_REF_PATTERN` in [`packages/ai-runtime/src/secrets.ts`](../../packages/ai-runtime/src/secrets.ts)).
   - Attempting to store a raw API key (`sk-...`) in `secret_ref` fails both ORM pattern validation and `assertValidSecretRef`.
2. **Company-Scoped Secret Isolation:**
   - Company-prefixed references (e.g., `MW_AI_C1_OPENAI_API_KEY`) are bound strictly to `companyId = 1` by `assertSecretRefCompanyScope`. A run in Company `2` attempting to resolve `MW_AI_C1_*` is rejected with `ProviderError` (`code: 'auth_failed'`, `reasonCode: 'INVALID_SECRET_REF'`).
3. **Runtime Injection & Rotation Without Downtime:**
   - Inject secrets exclusively via runtime environment variables (or the OS keychain in `apps/desktop`) before starting `apps/api` or the worker:
     ```powershell
     $env:MW_AI_C1_OPENAI_API_KEY = "<runtime-injected-key-never-committed>"
     ```
   - To rotate a credential without downtime: provision a new environment variable `MW_AI_C1_OPENAI_API_KEY_V2`, update `ai.provider_profile.secret_ref` for Company `1` to `MW_AI_C1_OPENAI_API_KEY_V2`, and remove the old variable once in-flight requests drain.
4. **Log & Error Redaction:**
   - Every resolved secret is registered into `RedactionContext` (`createRedactor`), scrubbing raw, URL-encoded, and base64-encoded variants from `ProviderError` messages, stack traces, HTTP headers, and Pino logs.
