---
name: code-mode
description: Control how much of an implementation the agent writes versus what it leaves for you. Modes are scaffold (structure, plumbing, and tests only — all real logic left as stubs), half (straightforward logic done, the hard/design-critical parts left as stubs), and full (write everything). Invoke with an argument, e.g. /skill:code-mode scaffold. Use when starting an implementation to set the delegation scope.
---

# Code Mode

Decide, per task, how much of the code *you* write and how much the agent writes.
The mode is passed as an argument after the skill command:

- `/skill:code-mode scaffold`
- `/skill:code-mode half`
- `/skill:code-mode full`

Read the `User:` argument that follows this content to determine the mode. If no
argument is given, list the three modes and ask which one the user wants.

## scaffold — structure, plumbing, and tests only

You write the skeleton; the human writes every function body that has real logic.

- Produce package layout, types, exported interfaces, and function signatures.
- Wire dependencies, config, CLI/HTTP entry points, and the test harness.
- Leave every non-trivial function as a compiling stub:

  ```go
  // TODO(you): implement the dedupe + merge logic.
  // Contract: see TestMerge in merge_test.go.
  func Merge(left, right []Record) ([]Record, error) {
      return nil, errors.New("not implemented: Merge")
  }
  ```

- Write the test that pins each stub's contract first; it will fail until the human
  implements the body. That failing test is the hand-off.
- Tell the user exactly which files and lines are theirs.
- Do NOT fill in any stub, even if it looks easy. The point is that the human owns the
  logic. If asked to fill one in, do it — that is the user changing the mode.

## half — straightforward logic done, hard parts left for the human

You write everything except the genuinely hard or design-critical parts.

- Implement CRUD, marshalling, validation, glue, error plumbing, and wiring.
- Identify the parts that are algorithmically hard, performance-critical, or
  design-defining (concurrency, transactions, the core transformation) and leave those
  as stubs with a contract comment + a failing test, exactly as in scaffold mode.
- State clearly what you implemented and what you left, and why each leftover is "the
  hard part."
- If unsure whether something counts as hard, ask rather than assuming.

## full — write everything

- Implement the whole thing. No stubs.
- Still follow plan-first: present the design first (in the actual technology) and wait
  for approval before writing.
- Flag any design decision the user should be aware of.

## Rules for every mode

- Follow plan-first for the plan: present Go types/signatures, Terraform resources, or
  Dockerfile stages before writing, and wait for approval.
- A stub must compile and carry a contract comment + a failing test.
- Never "helpfully" fill in a stub in scaffold or half mode.
- Report at the end: what you wrote, what you left, and where.
