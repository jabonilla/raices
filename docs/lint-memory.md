# Local lint aborts (exit 134): diagnosis

K2.52, 2026-10-20. Question (Claude): local `pnpm lint` died with exit 134 on
K2's VM during PR #137. Is that a genuine memory ceiling on the machine, or
does the ESLint config load the type graph in a way that will eventually hit
CI too?

Short answer: the config is legitimately heavy and will need watching as the
codebase grows, but the aborts themselves were a local-environment trigger —
an untracked scratch directory inside the repo tree had quietly multiplied
the lint set fivefold. CI was never exposed to it. Details and measurements
below, because the point of this document is that the next exit 134 gets
diagnosed from evidence instead of waved off as "just the OOM thing."

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
box is **2,240 MB** — Node scales the default to total RAM.

| Run | Files linted | Peak RSS | Result |
| --- | --- | --- | --- |
| Clean repo (191 files), cap 6,144 MB | 191 | 2,876 MB | pass |
| Clean repo, default cap | 191 | ~1,662 MB | pass |
| Repo + scratch clones (1,016 files), default cap | 1,016 | ~2.9 GB | **intermittent abort (134)** |
| Clean repo, cap forced to 1,536 MB | 191 | — | abort (134), signature reproduced |

The "scratch clones" row is the trigger. An untracked `work/` directory
inside the repo tree had accumulated nine full repo copies (792 MB) from
local scratch work. ESLint lints the filesystem, not git, so `eslint .`
walked all of them: 1,016 files instead of 191, and nine copies of the
TypeScript program set instead of one. Whether a given run aborted depended
on how much scratch had accumulated — which is why it looked random.

The scratch has been moved out of the repo tree. Rule going forward: **no
scratch clones inside the working tree.** They are invisible to `git status`
review habits and they multiply every repo-wide tool, not just lint.

## What this means for CI

CI checks out clean: 191 files, no scratch, no build output. Runners are
16 GB with Node 22 (`.nvmrc`), whose default heap cap is roughly 4 GB —
about 2.4x headroom over the ~1.7 GB clean-repo peak measured above. CI is
not near this wall today.

The structural trend is still real. Clean-repo lint peaks at ~1.7 GB RSS
locally against a 2.24 GB default cap on an 8 GB machine — about 25%
headroom — and the number grows with the type surface (the Expo SDK 58 bump
visibly grew it). Local machines are the canary: when local lint starts
aborting on a *clean* tree at the default cap, the config has outgrown a
single process and the fix is splitting lint per workspace, not raising caps
forever. Until then, treat a local 134 as a measurement prompt, not a shrug.

## If you hit exit 134

1. Look for the `JavaScript heap out of memory` line. Present → memory
   abort; the run says nothing about code quality. Absent → capture the
   full log before rerunning; a green rerun destroys the evidence.
2. Check for untracked bulk inside the tree (`du -sh` on suspicious
   directories; `eslint . --format json` file count vs. the ~191 baseline).
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
