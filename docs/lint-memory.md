# Local lint aborts (exit 134): diagnosis

K2.52, 2026-10-20. Question (Claude): local `pnpm lint` died with exit 134 on
K2's VM during PR #137. Is that a genuine memory ceiling on the machine, or
does the ESLint config load the type graph in a way that will eventually hit
CI too?

Short answer: a local-environment problem, in two layers. An untracked
scratch directory inside the repo tree had quietly multiplied the lint set
fivefold, and the machine's `node_modules` had drifted from the lockfile
(TypeScript 6.0.3 installed where 5.9.3 is pinned). The config itself —
fully type-aware linting — peaks at ~1.1–1.3 GB RSS on the clean tree,
which is real weight but nowhere near any cap CI runs with. CI was never
exposed to any of it. Details and measurements below, because the point of
this document is that the next exit 134 gets diagnosed from evidence
instead of waved off as "just the OOM thing." An earlier draft of this
document carried peak figures measured under uncontrolled conditions;
they were re-measured under controlled ones and corrected — see the
caveats in the measurements section.

## The failure signature

Exit 134 is SIGABRT. For Node that almost always means V8 gave up:

```
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
```

Reproduced on demand by lowering the heap cap
(`--max-old-space-size=1536`): same FATAL ERROR, same SIGABRT. A lint run
that fails with rule messages is a real lint failure. A run that dies with
the line above reported **nothing** about the code — it never finished.

## What drives the memory

`eslint.config.js` uses `tseslint.configs.strictTypeChecked` with
`projectService: true`. That is fully type-aware linting: typescript-eslint
builds and retains TypeScript programs for the projects it lints, in one
ESLint process. The `no-unsafe-*` rules this enables are load-bearing (they
caught real defects on PRs #135 and #139), so the weight is a deliberate
trade, not config sloppiness. But peak memory scales with the total type
surface linted, and there is no per-directory relief valve in a single run.

## Measurements (K2's VM: 8 GB RAM, no swap, 2 cores, Node 24)

Node's default heap cap (`v8.getHeapStatistics().heap_size_limit`) on this
box is **2,240 MB** — Node scales the default to total RAM. Controlled
runs: stable tree, lockfile-true install (`pnpm install
--frozen-lockfile`), single ESLint process, RSS sampled from
`/proc/<pid>/status` every second.

| Run | Files linted | Peak RSS | Result |
| --- | --- | --- | --- |
| Clean repo, cap 6,144 MB | 191 | 1,082 MB | pass |
| Clean repo, default cap | 191 | 1,263 MB | pass |
| Repo + scratch clones, cap 6,144 MB (TS 5.9) | 1,016 | 5,530 MB | exit 1 — 27 lint errors *inside the scratch clones*, not OOM |
| Repo + scratch clones, default cap (TS 5.9) | 1,016 | 4,424 MB | pass — marginal |
| Repo + scratch clones, default cap (TS 6.0) | 1,016 | ~2,370 MB | **abort (134), 3 of 3 runs** |
| Clean repo, cap forced to 1,536 MB | 191 | — | abort (134), signature reproduced |

Three caveats, stated plainly:

1. **RSS overstates heap.** It includes file-backed pages the process has
   merely read. Treat the figures as directional (the scratch runs peak
   ~4–5x the clean runs), not as heap accounting.
2. **The outcome depends on the TypeScript version's memory profile.**
   Under TS 5.9 the scratch-inflated run at the default cap is marginal —
   it completed once, at 4,424 MB, GC working hard. Under TS 6.0 the
   same tree at the same cap aborted 3 of 3 times, each dying right at
   the heap cap (hence the *lower* RSS peak: it aborts before reading
   most files into cache). The clean tree passes comfortably under both
   versions.
3. **That combination is what the historical aborts ran under.** While
   diagnosing, a local typecheck failed with the TypeScript 6 `baseUrl`
   deprecation error: the VM's `node_modules` had drifted from the
   lockfile (TS 6.0.3 installed, 5.9.3 pinned), left over from
   dependabot-bump experiments. So during PRs #137/#146 the local lint
   runs faced the TS 6.0 memory profile *and* the fivefold lint set on
   an 8 GB box — the configuration that now aborts deterministically.
   All of it is local-environment fact; none of it is a repo or CI fact.

One forward-looking consequence: when the TypeScript 6 upgrade lands,
local lint memory pressure rises measurably even though the clean tree
still fits with room. The canary in the CI section below applies with
TS 6 in mind.

The scratch directory was the largest single multiplier found. An
untracked `work/` directory inside the repo tree had accumulated nine
full repo copies (792 MB) from local scratch work. ESLint lints the
filesystem, not git, so `eslint .` walked all of them: 1,016 files
instead of 191, and nine copies of the TypeScript program set instead of
one. It has been moved out of the repo tree. Rules going forward: **no
scratch clones inside the working tree**, and **if a local gate fails in
a way CI does not, reinstall with `--frozen-lockfile` before diagnosing
the code** — install drift impersonates code failure.

## What this means for CI

CI checks out clean: 191 files, no scratch, no build output, lockfile-true
install. Runners are 16 GB with Node 22 (`.nvmrc`), whose default heap cap
is roughly 4 GB — about 3x headroom over the ~1.1–1.3 GB clean-repo RSS
peak measured above. CI is not near this wall.

The trend is worth one sentence, no more: type-aware lint memory grows
with the codebase's type surface, so the margin shrinks as the repo grows.
Local machines are the canary — when local lint starts aborting on a
*clean, lockfile-true* tree at the default cap, the config has outgrown a
single process and the fix is splitting lint per workspace, not raising
caps forever. Until then, treat a local 134 as a measurement prompt, not
a shrug.

## If you hit exit 134

1. Look for the `JavaScript heap out of memory` line. Present → memory
   abort; the run says nothing about code quality. Absent → capture the
   full log before rerunning; a green rerun destroys the evidence.
2. Check for untracked bulk inside the tree (`du -sh` on suspicious
   directories; `eslint . --format json` file count vs. the ~191 baseline).
   And check the install is lockfile-true (`pnpm install
   --frozen-lockfile`) — drift there impersonates both code failure and
   memory failure.
3. One-off local workaround on an idle machine:
   `NODE_OPTIONS=--max-old-space-size=4096 pnpm lint`. This is deliberately
   **not** baked into the lint script: forcing a 4 GB cap would push
   smaller contributor machines from a clean abort into swap thrash, and
   CI does not need it.

## Related fix in the same PR

`apps/mobile/dist-web/` (Expo web build output) is not named in the ESLint
config; only `.gitignore` marks it as output. Its exclusion from local
lint turned out to be inconsistent: some local runs skipped it, while
others — a plain `eslint .` on the lockfile-true install, and any
`--ignore-pattern` run — linted its 13 bundle files and produced 5,581
phantom errors. (The inconsistency appears to track local install state;
an earlier node_modules drift on this VM had silently diverged from the
lockfile. It is not worth reverse-engineering further: build output does
not belong in lint's input set either way.) It is now in the config's
`ignores` directly, so lint's view of the tree is deterministic and no
longer depends on `.gitignore` or install state.
