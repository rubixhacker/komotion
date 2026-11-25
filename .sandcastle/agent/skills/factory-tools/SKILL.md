---
name: factory-tools
description: Load this first in the factory sandbox, before any build, search or library lookup. It lists the command that replaces ./gradlew here, the denied commands, and how to work inwards from one test class to the all-target gate.
---

# Working in the factory sandbox

Three commands exist only here. Each replaces a habit that costs time.

## Build and test: `.sandcastle/agent/bin/gradle`

```bash
.sandcastle/agent/bin/gradle :komotion-core:desktopTest --tests '*FreezeTest*'
.sandcastle/agent/bin/gradle :komotion-core:compileKotlinJvm
.sandcastle/agent/bin/gradle desktopTest compileAllTargets
```

- `./gradlew` is **denied** in the shell; use `.sandcastle/agent/bin/gradle`. This sandbox prepares
  its own host, so no host preflight applies here.
- Set no environment variable for it. `GRADLE_USER_HOME`, `KONAN_DATA_DIR` and `JAVA_HOME` are
  already right; the command drops any override, because each one starts an empty cache.
- It prints the result and what failed: compiler errors, failed tests, lint findings. The whole
  log is in the file it names. Search that file with `grep`; do not print it.
- One build at a time, in the foreground. Never add `&`, `nohup` or a second shell.

Work inwards: the one test class you changed, then its module's test task, then
`./gradlew desktopTest compileAllTargets` once at the end. The gate compiles every target in every
module, so it catches a change that breaks iOS, Android or wasmJs even when the desktop tests pass.

## Find code: `.sandcastle/agent/bin/find-symbol`

Search for a declaration without printing unrelated source. Use it instead of a broad `grep -r`.

## Read a library source: `.sandcastle/agent/bin/lib-source`

Read the source of a dependency from the local cache instead of fetching it from the network.

## Denied commands

The shell wrapper denies `gh *`, all `git push`/`git stash`/`git reset --hard`/`git clean` forms,
`--no-verify`, `pkill`, `killall` and `./gradlew`. The host owns delivery and the network; an agent
that needs GitHub state reads the issue context file the host wrote into this worktree.
