// Manual + Automatic inventory publishing run on UAT, two jobs per run.
// Automatic conversion takes ~5-7 min, so it is started first and a whole
// manual job is pushed through to Proofing while it converts:
//
//   1. Client creates job A                     (automatic job)
//   2. Backend starts Automatic inventory on A  (conversion runs server-side)
//   3. Client creates job B                     (manual job)
//   4-8. Job B: manual inventory -> operator -> QC -> QA -> To Proof
//   9.   Job B: client reviews and Approves
//   10-14. Job A: automatic inventory (waits for "Completed") -> operator
//          -> QC -> QA -> To Proof
//   15.  Job A: client feedback on every spec -> Submit Feedback (Draft 2)
//   16-19. Job A Draft 2: operator -> QC -> QA -> To Proof
//
// ONLY_AUTO=1 runs job A alone (steps renumber: 1-2, 3-7, 8, 9-12).
//
// Each step targets its job by name (JOB_ISSUE), and stops at the first
// failing step. Every step records a Playwright trace under
// test-results/dual-run-step-<n>.
//
//   node scripts/dual-run.js            (headed)
//   HEADLESS=1 node scripts/dual-run.js
//   FROM_STEP=9 AUTO_ISSUE=<A> MANUAL_ISSUE=<B> node scripts/dual-run.js   (resume)
const { spawnSync } = require('child_process');

const ts = Date.now();
const AUTO_ISSUE = process.env.AUTO_ISSUE || `Automation_Issue_${ts}`;
const MANUAL_ISSUE = process.env.MANUAL_ISSUE || `Automation_Issue_${ts + 1}`;
const AUTO_ASSET = process.env.AUTO_ASSET || 'artists&illustrators_20260508_p1-4.pdf';

// Operator -> QC -> QA -> To Proof: Draft 1, and again for Draft 2 after
// client feedback (specs come back as "Rework").
const proofChain = (label, issue) => [
    [`${label}: operator checkout -> upload -> Ready for QC`, 'tests/backend-operator.spec.ts', { JOB_ISSUE: issue }],
    [`${label}: QC errors + comments -> approve`, 'tests/backend-qc.spec.ts', { JOB_ISSUE: issue }],
    [`${label}: QA errors + comments -> approve`, 'tests/backend-qa.spec.ts', { JOB_ISSUE: issue }],
    [`${label}: bundled link -> To Proof`, 'tests/backend-to-proof.spec.ts', { JOB_ISSUE: issue }],
];
const backendChain = (label, issue, inventoryMode) => [
    [`${label}: create inventory (${inventoryMode})`, 'tests/backend-create-inventory.spec.ts', { JOB_ISSUE: issue, INVENTORY_MODE: inventoryMode }],
    ...proofChain(label, issue),
];

// ONLY_AUTO=1 skips job B: create job A, start Automatic, then job A's
// backend chain straight away (step 6 waits out the conversion).
const ONLY_AUTO = !!process.env.ONLY_AUTO;
const STEPS = [
    // Pages 1-4 of the usual PDF: converts to 4 cards (Cover / Ads / Article
    // / TOC) instead of 41 — the backend only creates an automatic inventory
    // when every converted card is submitted, so the job must be small.
    ['Client: create job A (automatic)', 'tests/existing-magazine-flow.spec.ts', { ISSUE_NAME: AUTO_ISSUE, ASSET_FILE: AUTO_ASSET }],
    ['Backend: start Automatic inventory on job A', 'tests/backend-start-automatic.spec.ts', { JOB_ISSUE: AUTO_ISSUE }],
    ...(ONLY_AUTO ? [] : [
        ['Client: create job B (manual)', 'tests/existing-magazine-flow.spec.ts', { ISSUE_NAME: MANUAL_ISSUE }],
        ...backendChain('Job B', MANUAL_ISSUE, 'manual'),
        ['Job B: client review -> Approve', 'tests/client-approve.spec.ts', { JOB_ISSUE: MANUAL_ISSUE }],
    ]),
    ...backendChain('Job A', AUTO_ISSUE, 'automatic'),
    ['Job A: client feedback on every spec -> Submit Feedback', 'tests/client-feedback.spec.ts', { JOB_ISSUE: AUTO_ISSUE }],
    ...proofChain('Job A Draft 2', AUTO_ISSUE),
];

// UAT intermittently drops requests (login, uploads, the Automatic start).
// Every backend/feedback spec resumes where it stopped (finished specs are
// skipped), so a failed step is simply rerun — up to STEP_RETRIES more
// times. Creating a job and the client Approve are not repeatable (a rerun
// would make a duplicate job / find the job already approved), so those
// stop the run straight away.
const STEP_RETRIES = Number(process.env.STEP_RETRIES ?? 2);
const NOT_REPEATABLE = /existing-magazine-flow|client-approve/;

console.log(`Job A (automatic): ${AUTO_ISSUE}\nJob B (manual):    ${MANUAL_ISSUE}`);
const started = Date.now();
const fromStep = Number(process.env.FROM_STEP || 1);
const retried = [];
for (const [i, [name, spec, extraEnv]] of STEPS.entries()) {
    if (i + 1 < fromStep) continue;
    const attempts = NOT_REPEATABLE.test(spec) ? 1 : 1 + STEP_RETRIES;
    let result;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        console.log(`\n=== Step ${i + 1}/${STEPS.length}: ${name} (${spec})${attempt > 1 ? ` — retry ${attempt - 1}/${STEP_RETRIES}` : ''} ===`);
        const out = `test-results/dual-run-step-${i + 1}${attempt > 1 ? `-retry${attempt - 1}` : ''}`;
        const args = ['playwright', 'test', spec, '--trace=on', '--output', out];
        if (!process.env.HEADLESS) args.push('--headed');
        result = spawnSync('npx', args, {
            stdio: 'inherit',
            shell: true,
            env: { ...process.env, TEST_ENV: process.env.TEST_ENV || 'uat', ...extraEnv },
        });
        if (result.status === 0) {
            if (attempt > 1) retried.push(`step ${i + 1} (${name}) passed on retry ${attempt - 1}`);
            break;
        }
    }
    if (result.status !== 0) {
        console.log(`\n❌ Dual run stopped at step ${i + 1}: ${name}`);
        console.log(`   Resume: ${ONLY_AUTO ? 'ONLY_AUTO=1 ' : ''}FROM_STEP=${i + 1} AUTO_ISSUE=${AUTO_ISSUE} MANUAL_ISSUE=${MANUAL_ISSUE} node scripts/dual-run.js`);
        process.exit(result.status || 1);
    }
}
console.log(`\n✅ Dual run completed — all ${STEPS.length} steps passed in ${Math.round((Date.now() - started) / 60000)} min`);
console.log(`   Job A (automatic): ${AUTO_ISSUE}\n   Job B (manual):    ${MANUAL_ISSUE}`);
if (retried.length) console.log('   Retried:\n     ' + retried.join('\n     '));
