// scripts/validate-templates/fixtures/failing-template/server.js
// Intentionally violates stdout-purity. Used by harness --self-test to prove
// the stdout-purity probe correctly rejects log bleed.
//
// INVARIANT (RESEARCH §Pitfall 6): single-file CommonJS, zero non-builtin requires.
// Do not convert to TypeScript, do not add dependencies, do not use tsx to run.
console.log("startup banner (this is the violation)");
process.stdin.on("data", () => {
  process.stdout.write("not-json-rpc-noise\n");
});
process.stdin.on("end", () => process.exit(0));
