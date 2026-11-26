# Wave 0 Spec — My Plan

Spec sections are keyed 1:1 by task code (`## Txx`). Each section holds the rich,
fenced-code detail that does not belong in the strict wave JSON: exact code to
write, DO / DO-NOT rules, and expected outputs.

---

## T01

- **Owner File(s):** `src/example.ts`
- **Depends On:** None
- **Exact Spec:**

  ```ts
  // Concrete skeleton or signature the implementer must produce.
  export function example(): string {
    return "replace me";
  }
  ```

- **DO NOT:**
  - Never touch files outside `owner_files`.
  - Never add dependencies to make a trivial task pass.

- **Acceptance Criteria:**
  - Binary criterion 1 (e.g. `node src/example.ts` prints `replace me`).
  - Binary criterion 2 (e.g. typecheck exits 0).

- **Verify:**

  ```bash
  node --version
  ```
