Merging is a host-controlled delivery step, never an agent action. The host may enable rebase
auto-merge only for a green, cleanly mergeable pull request whose exact head has every required check
green and current `main` as an ancestor. Under the default `SANDCASTLE_AUTO_MERGE=green` policy the
factory's review, gate and CI bar suffice; no human approval is required. With the opt-in `approval`
policy the host also waits for an authorized non-bot human to approve the exact head — no agent
review or historical approval counts toward that bar. A delivery labelled `device-evidence-pending`,
or one touching factory plumbing, workflows, `scripts/ci/` or credentials, is never armed under
either policy and waits for a human. No skipped required check or branch-protection bypass counts.
The host closes fully satisfied issues only after verifying their work landed on origin/main;
pending native, device, store or production evidence keeps its issue open. Do not merge branches,
close issues, tag releases, or deploy from this prompt.
