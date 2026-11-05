// Full publishing run on UAT, client job creation through Proofing to
// the client approving it.
// Runs each stage's spec in order against the job the first stage
// creates (ISSUE_NAME / JOB_ISSUE) and stops at the first failing stage. Every stage
// records a Playwright trace (test-results/) for post-mortem.
//
//   node scripts/full-run.js            (headed)
//   HEADLESS=1 node scripts/full-run.js
//   FROM_STAGE=3 ISSUE_NAME=<job> node scripts/full-run.js   (resume)
const { spawnSync } = require('child_process');

// Named up front so every stage (including the client one) targets this job.
const ISSUE_NAME = process.env.ISSUE_NAME || `Automation_Issue_${Date.now()}`;

const STAGES = [
    ['Client: login -> create job -> backend check', 'tests/existing-magazine-flow.spec.ts'],
    ['Backend: create inventory', 'tests/backend-create-inventory.spec.ts'],
    ['Operator: checkout -> upload -> Ready for QC', 'tests/backend-operator.spec.ts'],
    ['QC: errors + comments -> approve', 'tests/backend-qc.spec.ts'],
    ['QA: errors + comments -> approve', 'tests/backend-qa.spec.ts'],
    ['Bundled link -> To Proof', 'tests/backend-to-proof.spec.ts'],
    ['Client: review -> Approve', 'tests/client-approve.spec.ts'],
];

console.log(`Job: ${ISSUE_NAME}`);
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
        env: { ...process.env, TEST_ENV: process.env.TEST_ENV || 'uat', ISSUE_NAME, JOB_ISSUE: ISSUE_NAME },
    });
    if (result.status !== 0) {
        console.log(`\n❌ Full run stopped at stage ${i + 1}: ${name}`);
        console.log(`   Resume: FROM_STAGE=${i + 1} ISSUE_NAME=${ISSUE_NAME} node scripts/full-run.js`);
        process.exit(result.status || 1);
    }
}
console.log(`\n✅ Full run completed — all ${STAGES.length} stages passed in ${Math.round((Date.now() - started) / 60000)} min`);
