'use strict';

/**
 * TamilScript benchmarks (repeatable, no claims beyond measured numbers).
 *
 * Methodology: each case builds a synthetic source string in memory, runs
 * `transform()` N times (1 warmup + measured iterations), and reports the
 * median wall time plus the max heap delta observed. No caching exists in
 * the transformer, so every iteration does full work. Run with:
 *
 *   node bench/bench.js [--quick]
 *
 * `--quick` shrinks iterations for CI smoke use. Results depend on machine,
 * Node version and load; record all three when quoting numbers.
 */

const { transform } = require('../src/transformer');

const QUICK = process.argv.includes('--quick');

function tamil(n) {
  const digits = ['௦', '௧', '௨', '௩', '௪', '௫', '௬', '௭', '௮', '௯'];
  if (n === 0) return digits[0];
  let out = '';
  while (n > 0) {
    out = digits[n % 10] + out;
    n = Math.floor(n / 10);
  }
  return out;
}

function buildCases() {
  const lines = [];
  for (let i = 0; i < 200; i++) lines.push(`const v${i} = ${i * 3 + 1};`);
  const plain = lines.join('\n') + '\n';

  const numLines = [];
  for (let i = 0; i < 200; i++) numLines.push(`let n${i} = $${tamil(i + 1)} + $${tamil(i + 2)};`);
  const manyNumbers = numLines.join('\n') + '\n';

  const strLines = [];
  for (let i = 0; i < 200; i++) strLines.push(`let s${i} = "தமிழ் மதிப்பு ${i} value";`);
  const manyStrings = strLines.join('\n') + '\n';

  const decLines = [];
  for (let i = 0; i < 200; i++) decLines.push(`let d${i} = $${tamil(i + 1)}.${tamil((i % 9) + 1)};`);
  const manyDecimals = decLines.join('\n') + '\n';

  let nested = 'const t0 = `l0 ';
  for (let i = 1; i <= 8; i++) nested += `\${$${tamil(i)} + \`l${i} `;
  nested += 'deep';
  for (let i = 1; i <= 8; i++) nested += '`}';
  nested += '`;\n';
  const nestedTemplates = nested.repeat(20);

  return [
    { name: 'small (20 lines, mixed)', source: manyNumbers.split('\n').slice(0, 20).join('\n') },
    { name: 'medium plain (200 lines, no literals)', source: plain },
    { name: 'medium numbers (200 lines)', source: manyNumbers },
    { name: 'medium strings (200 lines, ordinary)', source: manyStrings },
    { name: 'medium decimals (200 lines)', source: manyDecimals },
    { name: 'nested templates (20x depth-8)', source: nestedTemplates },
    { name: 'large (numbers x10)', source: manyNumbers.repeat(10) },
  ];
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function measure(source, iterations) {
  transform(source); // warmup (also validates the case)
  const times = [];
  let maxHeap = 0;
  for (let k = 0; k < iterations; k++) {
    const before = process.memoryUsage().heapUsed;
    const start = process.hrtime.bigint();
    transform(source);
    const elapsedNs = process.hrtime.bigint() - start;
    const after = process.memoryUsage().heapUsed;
    times.push(Number(elapsedNs) / 1e6);
    if (after - before > maxHeap) maxHeap = after - before;
  }
  return { medianMs: median(times), maxHeapDeltaKb: maxHeap / 1024, bytes: Buffer.byteLength(source, 'utf8') };
}

function main() {
  const iterations = QUICK ? 5 : 25;
  console.log(`tamilscript bench | node ${process.version} | ${process.platform}/${process.arch} | iterations=${iterations}`);
  console.log(`no transform cache exists; every iteration does full work.`);
  for (const c of buildCases()) {
    const r = measure(c.source, iterations);
    const perKb = r.medianMs / (r.bytes / 1024);
    console.log(
      `${c.name}: size=${(r.bytes / 1024).toFixed(1)}KiB median=${r.medianMs.toFixed(2)}ms ` +
      `(${perKb.toFixed(3)}ms/KiB) maxHeapDelta=${r.maxHeapDeltaKb.toFixed(1)}KiB`
    );
  }
}

if (require.main === module) main();

module.exports = { buildCases, measure };
