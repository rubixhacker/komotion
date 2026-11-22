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

6. **Preserve functionality**: never change what the code does — only how it
   does it. All original features, outputs, and behaviors must remain intact.

# EXECUTION

If you find improvements to make:

1. Make the changes directly on this branch
2. Run `./gradlew desktopTest` to ensure nothing is broken
3. Commit describing the refinements

If the code is already clean and well-structured, do nothing.

Once complete, output <promise>COMPLETE</promise>.
