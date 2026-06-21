// test/fixtures/failing-template/server.js
// Intentionally violates stdout-purity. Used by the stdout-purity test to prove
// the checker correctly rejects log bleed (fail-ability without a broken file
// in src/).
//
// INVARIANT: single-file CommonJS, zero non-builtin requires. Do not convert to
// TypeScript, do not add dependencies, do not use tsx to run.
console.log("startup banner (this is the violation)");
process.stdin.on("data", () => {
  process.stdout.write("not-json-rpc-noise\n");
});
process.stdin.on("end", () => process.exit(0));
