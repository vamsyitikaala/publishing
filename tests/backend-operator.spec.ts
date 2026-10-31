import { test, expect } from '@playwright/test';
import * as path from 'path';
import { BackendLoginPage } from '../pages/BackendLoginPage';
import { ProductionJobPage } from '../pages/ProductionJobPage';
import { InventoryOperatorPage } from '../pages/InventoryOperatorPage';

// Operator stage on the newest job's inventory — strictly one spec at a
// time: checkout (Assign) -> Upload (Drag and Drop -> sample JPEGs) ->
// Ready for QC, and only then move on to the next spec. Specs already past the
// operator stage are skipped; one already checked out resumes at Upload.
// Pairs with backend-create-inventory.spec.ts, which builds the inventory.
const BACKEND_CREDENTIAL_CANDIDATES = [
    { username: 'alluser-uat.pb@vmgdigital.com', password: 'Test@1234' },
    { username: 'alluser@vmgdigital.com', password: 'Test@1234' },
];

// One asset per spec — the upload dialog rejects multi-file selections.
// Must be under 2 MB: UAT answers HTTP 500 ("The website encountered an
// unexpected error") for sample01.jpg (2.29 MB) every time, while
// sample02.jpg (1.84 MB) and small PNGs upload fine — consistent with a
// 2 MB server upload limit.
const SAMPLE_FILE = path.resolve(__dirname, '..', 'test-data', process.env.SAMPLE_FILE || 'sample02.jpg');

test('Backend operator: checkout -> upload -> Ready for QC, one spec at a time', async ({ page }) => {
    test.setTimeout(15 * 60 * 1000);

    const backendLogin = new BackendLoginPage(page);
    const productionJob = new ProductionJobPage(page);
    const operator = new InventoryOperatorPage(page);
    const ts = Date.now();

    const requests: string[] = [];
    page.on('response', async r => {
        if (['xhr', 'fetch'].includes(r.request().resourceType()) && !/google-analytics|fullstory/.test(r.url())) {
            const body = r.status() >= 400 || /article-files/.test(r.url())
                ? ` -> ${(await r.text().catch(() => '')).slice(0, 600)}` : '';
            requests.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 160)}${body}`);
        }
    });

    page.on('console', m => { if (m.type() === 'error') requests.push(`console.error: ${m.text().slice(0, 300)}`); });
    page.on('pageerror', e => requests.push(`pageerror: ${e.message.slice(0, 300)}`));

    await test.step('Backend login + open newest job', async () => {
        await backendLogin.loginWithFallback(BACKEND_CREDENTIAL_CANDIDATES);
        console.log('✅ Opened job:', await productionJob.viewFirstJob());
    });

    const names = await operator.articleNames();
    console.log(`Specs (${names.length}):`, names.join(', '));

    for (const [i, name] of names.entries()) {
        const label = `Spec ${i + 1} "${name}"`;

        await test.step(`${label}: checkout -> upload -> Ready for QC`, async () => {
            const row = operator.row(name);
            const status = await operator.status(row);

            if (/get started/i.test(status)) {
                await operator.assignToMe(row, label);
            } else if (!/operator work in progress/i.test(status)) {
                console.log(`   ${label} | Already past operator stage ("${status}") — skipping`);
                return;
            } else {
                console.log(`   ${label} | Already checked out — resuming at Upload`);
            }

            requests.length = 0;
            try {
                const uniqueName = `${name.toLowerCase().replace(/\s+/g, '-')}-${ts}`;
                await operator.uploadAndReadyForQc(row, label, SAMPLE_FILE, uniqueName);
            } finally {
                console.log(`   ${label} | Requests during upload:\n      ` + requests.join('\n      '));
            }
            console.log(`✅ ${label} done`);
        });
    }

    await test.step('Verify every spec is in the QC stage', async () => {
        await page.reload();
        await page.getByRole('cell').first().waitFor({ state: 'visible', timeout: 30000 });
        const statuses: string[] = [];
        for (const name of names) {
            statuses.push(`${name}: ${await operator.status(operator.row(name))}`);
        }
        console.log('Final statuses:\n  ' + statuses.join('\n  '));
        await page.screenshot({ path: `screenshots/operator-done-${ts}.png`, fullPage: true });
        for (const s of statuses) {
            expect(s, 'every spec should have left the operator stage for QC').not.toMatch(/get started|operator work in progress/i);
            expect(s, 'every spec should be in the QC stage').toMatch(/qc/i);
        }
        console.log(`✅ All ${names.length} specs are in the QC stage`);
    });
});
