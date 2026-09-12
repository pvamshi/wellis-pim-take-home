# Rough drafts

Raised, not settled. We know it matters; we do not yet know its shape.
Every one of these gets picked up eventually.

Nothing moves to `final-requirements.md` until Vamshi approves it.

Node 4 is not here. Decisions that are taken get lifted out into their own note —
the tech stack lives in `tech-stack.md`, and that is what agents read. We follow
this pattern from here on: rough drafts are for thinking, decision notes are for
building against.

## 0. Delivery
- Iterative. Feature by feature, in order: legacy migration (1), new patient
  intake (2), review of new patients (3).
- As features land we will run data migrations and code upgrades.
- Commit frequently.

## 1. Legacy migration
- Legacy data has many problems. Migration is the process of resolving every
  problem on a row until that row is fit to enter the main table.

### 1.1 Rules engine
- Rules are generated from the initial data structure plus feedback Vamshi gives.
- The engine is living: every round of feedback updates the rules.
- AI never applies a rule. AI only creates rules and collects feedback on them.

#### 1.1.1 Rule catalogue
- The exhaustive list of rules. Assigned to me.
- Not written yet — it needs a pass over `patients.csv`, `intakes.csv` and
  `consents.jsonl` first, not over `EXPORT-NOTES.md` alone.

#### 1.1.2 Rule storage
- Rules live in the database: id, name, description.
- Versions are a second table, one-to-many against the rule.

#### 1.1.3 Rule code
- `(rule id, version)` is the key. Each key has matching code in the codebase.
- A version change means a new key and new code written against it. The old code
  stays.
- This is what lets us say which rule, at which version, made a given change.
- So a rule change is a deploy, not a runtime edit. What that buys is rules that
  are reviewable, testable and in git.

#### 1.1.4 Rules never write
- A rule may read data and run DB queries. It may never update data.
- Hard rule.

#### 1.1.5 Rule scope
- A rule is not scoped to a single value. It can target one value in a row,
  several rows, or data spanning two tables.
- That is why rules get database access instead of being handed a single value.

#### 1.1.6 Rule lifecycle
- A rule is never deleted. It is made inactive.
- Exactly one version of a rule is active at any time.

#### 1.1.7 Rule creation is not gated
- There are not two layers of approval. AI is free to create as many rules as it
  wants, and a new rule runs against the data immediately.
- The only gate is the UI: Vamshi sees the rules that matched something, and
  approves, rejects or modifies them there.
- A rule that matches nothing is invisible and costs nothing, so there is no
  reason to gate creation.

### 1.2 Apply and review
- Rules produce proposals for data updates. The proposals are what the UI shows.
- The user accepts or declines each proposal.
- On acceptance the raw data is modified.
- Only rules that actually match something in the data are shown. A rule with no
  matches does not appear.

#### 1.2.1 Ambiguous findings
- Some rules find a problem but do not know how to fix it.
- These are shown explicitly as ambiguous, not as proposals.
- The user responds with either how to fix it, or by ignoring the rule.
- That feedback either makes the rule inactive, or produces a new version that
  fixes the case the way the user described.

#### 1.2.2 Re-evaluation
- Rules read the modified data, not a frozen snapshot.
- After modifications are applied, every rule is checked again against the
  modified data.

#### 1.2.3 Acceptance is final
- An accepted proposal is settled. We do not revisit it and there is no undo.
- See `deferred.md` D2 for what this costs and why we took it.

### 1.3 Modification log
- Every modification is logged: which rule was applied, and the new structure.

### 1.4 Promotion
- Once all problems on a row are resolved, that row becomes eligible to be added
  to the main table.

### 1.5 Feedback loop
- Two kinds of feedback, both given from the UI:
  - Decline this rule, with a reason.
  - Exclude this row from this rule, with a reason.
- A reason is required on both. There is no feedback without one.
- A workflow reads all the feedback and updates the rule accordingly.

#### 1.5.1 Exclude this row, or change the rule
- The comment carries a checkbox: modify the rule with this change.
- Unchecked: this row alone is excluded. The rule is untouched and its other
  rows can still be approved.
- Checked: the change applies to every value this rule touches. The feedback
  workflow produces a new version of the rule.
- So the checkbox is what separates a one-row carve-out from a rule revision,
  and the user states which one they mean rather than us inferring it.
- Inferring that intent from the free-text reason is the kind of guess that
  produces a rule which looks clean while quietly carrying carve-outs nobody sees.

## 2. New patient intake
- Built after legacy migration.

## 3. Review
- Review for new patients. Built last.

## 5. Agent workflows
- We use workflows heavily. Agents work in the background.
- Workflow scripts live in `.claude/workflows/`.

### 5.1 Three-agent pattern
- Every unit of work runs through three agents, and this is the pattern we
  follow throughout the project, not just for scaffolding.
- Agent 1 clarifies: are the requirements, the design, everything clear?
  It writes no code.
- Agent 2 implements exactly what agent 1 settled.
- Agent 3 reviews.
- A unit whose requirements are not clear is not built. Its gaps come back to
  Vamshi instead. Anything the clarify agent would have to invent counts as a
  gap, not an assumption.

### 5.2 Scaffold workflow
- First workflow. Turns `tech-stack.md` into a running skeleton.
- `.claude/workflows/scaffold.js`. Not run yet.
- Root runs through the three-agent pattern first; backend and frontend then run
  through it in parallel. A report is written to `notes/scaffold-report.md` and
  the open gaps are appended to `notes/unresolved-questions.md`.

### 5.3 Commits
- After every meaningful step, an agent commits and pushes automatically.
- A step is committed only once it passes review. Failing work stays uncommitted.
- Committing is serial and done by one dedicated agent at a time. Parallel agents
  running `git add` in the same repository fight over `index.lock`.
- The commit agent never force-pushes, rebases, resets or checks out. A rejected
  push is reported, not worked around.

### 5.4 What agents read
- `tech-stack.md` is the source of truth for technology decisions.
- `unresolved-questions.md` is what is still open. An agent that finds its answer
  there has found a gap, not an answer.
- Agents never write to `final-requirements.md`.
