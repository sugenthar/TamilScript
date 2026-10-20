# TamilScript benchmarks

## Methodology

- Harness: `bench/bench.js` (ships in the repo, **not** in the published
  package). It builds synthetic sources in memory and calls the synchronous
  `transform()` in-process: 1 warmup iteration (which also validates the
  case) plus N measured iterations (default 25, `--quick` uses 5 for CI
  smoke runs).
- Metric: **median** wall time per case (robust to GC pauses), plus the max
  heap delta observed across iterations. Per-KiB rates are derived, not
  promised — they vary with literal density.
- No caching exists in the transformer (a deliberate decision: caching
  risks stale output; correctness first), so every iteration does full
  one-pass lexical work.
- When quoting numbers, always record: machine, OS/arch, Node version,
  iteration count, and load. Never compare across machines.

## Running

```bash
node bench/bench.js           # full (25 iterations per case)
node bench/bench.js --quick   # CI smoke (5 iterations per case)
```

## Cases

| Case | What it stresses |
|------|------------------|
| small (20 lines, mixed) | startup-sized files |
| medium plain (200 lines, no literals) | passthrough cost |
| medium numbers (200 lines) | Tamil integer literals |
| medium strings (200 lines, ordinary) | passthrough of Tamil text in ordinary strings |
| medium decimals (200 lines) | decimal literals |
| nested templates (20x depth-8) | `${}` recursion |
| large (numbers x10, ~63 KiB) | scaling |

## Reference run (example — your numbers will differ)

Recorded on Windows 11 x64, Node v24.11.1, `--quick` (5 iterations),
idle developer machine — shown only to prove the harness runs, not as a
performance claim:

```text
small (20 lines, mixed): 0.5KiB, median ~0.4ms
medium plain (200 lines, no literals): 3.4KiB, median ~0.5ms
medium numbers (200 lines): 6.3KiB, median ~0.8ms
medium strings (200 lines, ordinary): 12.1KiB, median ~3.8ms
medium decimals (200 lines): 4.8KiB, median ~1.2ms
nested templates (20x depth-8): 2.8KiB, median ~0.3ms
large (numbers x10): 63.0KiB, median ~9.4ms
```

Transform cost is roughly linear in input size (single pass); string
literals cost more per byte than numbers because values are decoded and
re-encoded.
