# TASK

Review the code changes on branch `{{BRANCH}}` and improve code clarity,
consistency, and maintainability while preserving exact functionality.

# CONTEXT

## Branch diff

!`git diff {{TARGET_BRANCH}}...{{BRANCH}}`

## Commits on this branch

!`git log {{TARGET_BRANCH}}..{{BRANCH}} --oneline`

# REVIEW PROCESS

1. **Understand the change**: read the diff and commits above to understand the intent.

2. **Analyze for improvements**: look for opportunities to
   - reduce unnecessary complexity and nesting
   - eliminate redundant code and abstractions
   - improve readability through clear names
   - consolidate related logic
   - remove comments that describe obvious code

3. **Check correctness**:
   - does the implementation match the issue's acceptance criteria? are edge cases handled?
   - are new/changed behaviors covered by tests?
   - are there unsafe casts, unchecked assumptions, or frame-window off-by-one errors?
   - does the change introduce credential leaks or other security issues?

4. **Maintain balance**: avoid over-simplification that reduces clarity, creates
   overly clever solutions, or removes helpful abstractions.

5. **Apply project standards**: follow the coding standards defined in
   @.sandcastle/CODING_STANDARDS.md and the build and test conventions in
   AGENTS.md

6. **Separate change-provable criteria from live evidence**: criteria verifiable from the change are judged from the diff and available checks. A criterion
   that needs a live CI run or deployed state is flagged `LIVE-EVIDENCE REQUIRED`,
   reported as unverified from the change, and named with the observation that would close it —
   which check at which commit, and which deployed state must be seen. A spec pass never implies that live verification happened. Pending live evidence stays out of scope for the diff review.

7. **Diagnose failures before charging them to the branch**: a check fails a
   branch only when it carries a source diagnostic. Report a host fault, a
   nested-sandbox refusal or an empty excerpt as not checked, never as a branch
   failure. The two documented Seatbelt refusals — `seatbelt() needs macOS` and
   `sandbox_apply: Operation not permitted` / `refuses to nest` — are host
   faults, not defects in the adapter or the branch.

8. **Block stale restated guidance**: a branch that changes a command, a hook step, a lane list
   or a path must update every place that restates that behavior, or name each stale line as a
   blocking finding. A line that still
   describes the old behavior is documentation drift, not a follow-up. Search
   the whole repository for restatements of the old behavior, read every hit,
   and list each stale line with its file and line reference.

9. **Preserve functionality**: never change what the code does — only how it
   does it. All original features, outputs, and behaviors must remain intact.

# EXECUTION

If you find improvements to make:

1. Make the changes directly on this branch
2. Run `.sandcastle/agent/bin/gradle desktopTest` to ensure nothing is broken.
   Never call `gradlew` directly; it is denied. If the wrapper exits 75, the
   heavy-work lock is busy: stop and report the review as deferred instead of
   bypassing the wrapper.
3. Commit describing the refinements

If the code is already clean and well-structured, do nothing.

Once complete, output <promise>COMPLETE</promise>.
