# SKILL: UDO Agency Engineering Workflow

A consolidated guide for AI agents operating inside the `udo-agency` project. It merges the role-based `.ai.agents/*_RULES.md` workflow with the Node.js service engineering conventions from `EXT.md`.

## 1. Project Context

- Project: `udo-agency`
- Runtime: Node.js v25
- Module system: ES Modules (`"type": "module"` in `package.json`)
- Architecture style: Clean Architecture, layered services
- Audience: Local Thai-speaking engineering team (comments must be in Thai)

## 2. Multi-Agent Workflow (Handoff Chain)

The pipeline flows in a fixed order. Each agent updates `STATUS.md` and pings the next agent in the chain.

| # | Role | Source File | Owns | Reads | Hands off to |
|---|------|-------------|------|-------|--------------|
| 0 | Product Owner | `00_PO_RULES.md` | `docs/BUSINESS_GOALS.md` | — | PM |
| 1 | Product Manager / UX | `01_PM_RULES.md` | `docs/REQUIREMENTS.md`, `docs/USER_JOURNEY.md` | `BUSINESS_GOALS.md` | Tech Lead |
| 2 | Technical Lead | `02_TECH_LEAD_RULES.md` | `docs/TECH_STACK.md`, high-level coding standards | `REQUIREMENTS.md` | Architect |
| 3 | Architect | `03_ARCHITECT_RULES.md` | `docs/SYSTEM_DESIGN.md`, folder structure | `TECH_STACK.md`, `REQUIREMENTS.md` | Coder |
| 4 | TDD Coder | `04_CODER_RULES.md` | `src/`, `tests/` | `SYSTEM_DESIGN.md`, tech standards | Reviewer |
| 5 | Reviewer / QA | `05_REVIEWER_RULES.md` | `docs/REVIEWS.md` (read `src/` + `tests/`) | All upstream docs | DevOps (if approved) or Coder (if rejected) |
| 6 | DevOps | `06_DEVOPS_RULES.md` | `.github/`, `scripts/`, `Dockerfile`, CI/CD configs | — | Production |

### Allowed Workspaces (Hard Boundaries)

Each agent must only write inside its permitted workspace. Cross-workspace edits are not allowed without explicit escalation.

- **PO**: `docs/BUSINESS_GOALS.md`
- **PM**: `docs/REQUIREMENTS.md`, `docs/USER_JOURNEY.md`
- **Tech Lead**: `docs/TECH_STACK.md` + coding standards
- **Architect**: `docs/SYSTEM_DESIGN.md` + folder layout
- **Coder**: `src/`, `tests/`
- **Reviewer**: `docs/REVIEWS.md` (feedback only, no business-logic changes)
- **DevOps**: `.github/`, `scripts/`, `Dockerfile`, CI/CD configs (no `src/` edits)

### Handoff Protocol

Every agent must:
1. Update `STATUS.md` with current state.
2. Ping the next agent in the chain.
3. Stop work outside its own scope, even if it notices an issue elsewhere (raise it through the handoff message instead).

## 3. Role Responsibilities

- **PO** — Defines the "What" and the "Why": vision, target audience, must-have vs nice-to-have, success KPIs.
- **PM** — Translates goals into functional requirements, UX flows, UI standards, and acceptance criteria.
- **Tech Lead** — Validates feasibility, finalizes stack, sets coding conventions, branching strategy, and security baselines.
- **Architect** — Designs DB schema, internal API contracts, component hierarchy, data flow, and design patterns.
- **Coder** — Implements via TDD (Red → Green → Refactor), writes clean code, documents "Why" for complex logic.
- **Reviewer** — Audits code for smells, vulnerabilities, standards compliance; verifies tests cover AC; approves or rejects.
- **DevOps** — Builds CI/CD, IaC, Docker, monitoring, and health checks. Marks `STATUS.md` as "Production Ready" only when the pipeline is green and the app is deployed.

## 4. Node.js / Service Engineering Standards (from EXT.md)

When writing any new `services/*.js` file (or comparable module), follow these strict rules:

### 4.1 Exports

- Use **Modern ES Modules** only. Always export a class named after the service.
  ```js
  export class UdoService { /* ... */ }
  ```

### 4.2 Single Responsibility Principle (SRP)

- One class = one responsibility.
- Keep the surface area small and the internals focused.

### 4.3 Comments

- All code comments must be written in **Thai**.
- Cover logic, edge cases, and design rationale (not what the code literally does).

### 4.4 Error Handling & Logging

- Wrap risky operations in `try/catch`.
- Emit meaningful log messages with a `[UDO <ServiceName>]` prefix.
  ```js
  console.log("[UDO GoogleSheets] wrote 42 rows");
  console.error("[UDO GoogleSheets] failed to fetch sheet:", err);
  ```

### 4.5 Self-Test / TDD Suite

Every service file must end with an ESM main-module self-test guard:

```js
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runSelfTest();
}
```

This allows direct execution via `node services/<filename>.js` for quick verification.

## 5. TDD Workflow for the Coder

1. **Red** — Write a failing test in `tests/` that expresses the next behavior.
2. **Green** — Write the minimum implementation in `src/` to make the test pass.
3. **Refactor** — Clean up while keeping tests green.
4. Document non-obvious business logic with Thai comments explaining the "Why".
5. When all features pass, update `STATUS.md` and notify the Reviewer.

## 6. Definition of Done (per role)

- **Coder**: all tests green, no skipped tests, code matches Tech Lead standards, "Why" comments present.
- **Reviewer**: `docs/REVIEWS.md` entry written, AC checklist fully satisfied, code smells and vulnerabilities addressed.
- **DevOps**: CI pipeline green, container image builds, deploy succeeds, health checks reachable, `STATUS.md` set to "Production Ready".

## 7. Operating Principles for AI Agents

- Respect workspace boundaries; never edit outside your role's allowed files.
- Always read upstream artifacts before producing downstream artifacts (e.g., PM must read `BUSINESS_GOALS.md` before writing `REQUIREMENTS.md`).
- Prefer composition over inheritance; favor dependency injection for testability.
- Match existing project conventions; introduce new libraries only after confirming they are installed.
- Never expose secrets, keys, or credentials in logs or committed files.
- Keep responses concise; the human owns final decisions on scope and priority.
