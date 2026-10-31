// Full publishing run on UAT, client job creation through to Proofing.
// Runs each stage's spec in order against the newest job (the one the
// first stage creates) and stops at the first failing stage. Every stage
// records a Playwright trace (test-results/) for post-mortem.
//
//   node scripts/full-run.js            (headed)
//   HEADLESS=1 node scripts/full-run.js
//   FROM_STAGE=3 node scripts/full-run.js   (resume on the newest job)
const { spawnSync } = require('child_process');

const STAGES = [
    ['Client: login -> create job -> backend check', 'tests/existing-magazine-flow.spec.ts'],
    ['Backend: create inventory', 'tests/backend-create-inventory.spec.ts'],
    ['Operator: checkout -> upload -> Ready for QC', 'tests/backend-operator.spec.ts'],
    ['QC: errors + comments -> approve', 'tests/backend-qc.spec.ts'],
    ['QA: errors + comments -> approve', 'tests/backend-qa.spec.ts'],
    ['Bundled link -> To Proof', 'tests/backend-to-proof.spec.ts'],
];

const started = Date.now();
const fromStage = Number(process.env.FROM_STAGE || 1);
for (const [i, [name, spec]] of STAGES.entries()) {
    if (i + 1 < fromStage) continue;
    console.log(`\n=== Stage ${i + 1}/${STAGES.length}: ${name} (${spec}) ===`);
    const args = ['playwright', 'test', spec, '--trace=on', '--output', `test-results/full-run-stage-${i + 1}`];
    if (!process.env.HEADLESS) args.push('--headed');
    const result = spawnSync('npx', args, {
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, TEST_ENV: process.env.TEST_ENV || 'uat' },
    });
    if (result.status !== 0) {
        console.log(`\n❌ Full run stopped at stage ${i + 1}: ${name}`);
        process.exit(result.status || 1);
    }
}
console.log(`\n✅ Full run completed — all ${STAGES.length} stages passed in ${Math.round((Date.now() - started) / 60000)} min`);
