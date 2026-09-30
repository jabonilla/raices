# K2.36 Low-end Device Profile Report

**Date:** 2026-09-29  
**Profile:** 2GB RAM Android class (cheap, full phone)

## Measurements

| Metric | Value | Budget/Target | Status |
|--------|-------|---------------|--------|
| JS Bundle size | 1.80 MiB | 2.5 MiB | ✓ 75.6% of budget |
| Est. Hermes parse time | 185ms | <500ms | ✓ |
| Est. JS memory footprint | 4.5 MiB | <100MB | ✓ |
| Est. cold start | 1.0s | <3s | ✓ |

## Methodology

Bundle exported via `expo export --platform android`. Parse time estimated at 0.1ms/KB (conservative for low-end ARM based on Hermes benchmarks). Memory estimated at 2.5x bundle size (parsed bytecode + runtime overhead). Cold start = parse + ~500ms native init + ~300ms first render.

**Limitation:** These are bundle-analysis estimates, not measurements from a physical 2GB device. Real-world memory includes the Hermes runtime, native modules, and OS overhead (typically 100-200MB total for RN apps, which is fine for 2GB).

## Dependency Analysis

15 direct dependencies. Heaviest likely contributors:
- `react-native-reanimated` (~4.7.0) — animation; necessary for smooth UI
- `react-native-gesture-handler` — touch handling; necessary
- `expo-router` — navigation; necessary
- `i18next` + `react-i18next` — internationalization; necessary for en/es

**Verdict:** No disproportionately expensive dependencies. The bundle is lean for a React Native app. The 75.6% budget usage leaves headroom for growth, but we should watch it — another heavy dependency would push us over.

## Recommendations

1. **No action needed now.** The app is well within all targets.
2. **Watch the budget.** At 75.6%, we have ~600KB headroom. A single heavy dependency (e.g., a charting library, video player) could exceed it.
3. **Future work:** If we add heavy features, consider code-splitting or lazy loading.
