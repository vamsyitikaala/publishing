import { test, expect } from '@playwright/test';
import { BackendLoginPage } from '../pages/BackendLoginPage';
import { ProductionJobPage } from '../pages/ProductionJobPage';
import { InventoryOperatorPage } from '../pages/InventoryOperatorPage';
import { QcReviewPage } from '../pages/QcReviewPage';

// QC stage on the newest job's inventory — strictly one spec at a time:
// Check Out (or View QC if already checked out) -> QC view -> error counts
// -> 3 comments -> delete one -> Approve -> "Ready For QA" (first two
// specs) or "Ready For Bundling" (the rest), then the next spec. Specs not in
// QC are skipped. Pairs with backend-operator.spec.ts, which gets every
// spec to "Ready for QC".
const BACKEND_CREDENTIAL_CANDIDATES = [
    { username: 'alluser-uat.pb@vmgdigital.com', password: 'Test@1234' },
    { username: 'alluser@vmgdigital.com', password: 'Test@1234' },
];

test('Backend QC: error counts + comments (delete one) -> Approve, one spec at a time', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);

    const backendLogin = new BackendLoginPage(page);
    const productionJob = new ProductionJobPage(page);
    const inventory = new InventoryOperatorPage(page);
    const qc = new QcReviewPage(page);
    const ts = Date.now();

    page.on('pageerror', e => console.warn(`   ⚠️  Page error: ${e.message.slice(0, 200)}`));
    page.on('console', m => { if (m.type() === 'error') console.warn(`   ⚠️  Console error: ${m.text().slice(0, 200)}`); });

    await backendLogin.loginWithFallback(BACKEND_CREDENTIAL_CANDIDATES);
    console.log('✅ Opened job:', await productionJob.viewFirstJob());
    const names = await inventory.articleNames();

    for (const [i, name] of names.entries()) {
        const label = `Spec ${i + 1} "${name}"`;

        await test.step(`${label}: QC`, async () => {
            const row = inventory.row(name);
            const status = await inventory.status(row);
            const opener = /ready for qc/i.test(status) ? 'Check Out'
                : /qc work in progress/i.test(status) ? 'View QC' : null;
            if (!opener) {
                console.log(`   ${label} | Not in QC ("${status}") — skipping`);
                return;
            }

            await inventory.clickAction(row, opener);
            // Confirmed live: Check Out can just assign QC (status -> QC Work
            // In Progress) and stay on the page; the same action button then
            // reads "View QC", which opens the QC view.
            const opened = await page.waitForURL(QcReviewPage.VIEW_URL, { timeout: 15000 }).then(() => true).catch(() => false);
            if (!opened) {
                await expect.poll(() => inventory.status(inventory.row(name)), { timeout: 30000 }).toMatch(/qc work in progress/i);
                await inventory.clickAction(inventory.row(name), 'View QC');
            }
            await qc.verifyLoaded(name);
            console.log(`   ${label} | ${opener} -> QC view`);

            await qc.addErrorCounts({ text: 1, style: 2, image: 1, other: 0 });
            console.log(`   ${label} | Error counts saved: Text 1 / Style 2 / image 1 / other 0`);

            const comments = [1, 2, 3].map(n => `Automation QC comment ${n} - ${name} - ${ts}`);
            const shown: boolean[] = [];
            for (const c of comments) {
                shown.push(await qc.addComment(c));
            }
            console.log(`   ${label} | 3 comments added`);

            // Draft 2 on UAT doesn't list saved comments — nothing to delete.
            if (shown[1]) {
                await qc.deleteComment(comments[1]);
                console.log(`   ${label} | Comment deleted: "${comments[1]}"`);
            } else {
                console.warn(`   ⚠️  ${label} | Comment not listed — delete skipped`);
            }

            // First two specs go on to QA, the rest straight to bundling.
            const option = i < 2 ? 'Ready For QA' : 'Ready For Bundling';
            await qc.approve(option);
            console.log(`   ${label} | Approve -> ${option}`);

            // Confirmed live: after Approve the app returns to the job's Issue
            // Summary by itself; "Ready For QA" shows as "QC Completed".
            await page.getByText(/ISSUE SUMMARY\s*-/).first().waitFor({ state: 'visible', timeout: 30000 });
            await page.getByRole('cell').first().waitFor({ state: 'visible', timeout: 30000 });
            const expected = option === 'Ready For QA' ? /QC Completed|Ready for QA/i : /Ready for bundling/i;
            await expect.poll(() => inventory.status(inventory.row(name)), { timeout: 30000 }).toMatch(expected);
            console.log(`✅ ${label} | QC done -> "${await inventory.status(inventory.row(name))}"`);
        });
    }

    const statuses: string[] = [];
    for (const name of names) statuses.push(`${name}: ${await inventory.status(inventory.row(name))}`);
    console.log('Final statuses:\n  ' + statuses.join('\n  '));
    await page.screenshot({ path: `screenshots/qc-done-${ts}.png`, fullPage: true });
});
