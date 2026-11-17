import { test, expect } from '@playwright/test';
import { BackendLoginPage } from '../pages/BackendLoginPage';
import { ProductionJobPage } from '../pages/ProductionJobPage';
import { InventoryOperatorPage } from '../pages/InventoryOperatorPage';
import { QcReviewPage } from '../pages/QcReviewPage';
import { backendCredentials } from '../config/credentials';

// QA stage on the newest job's inventory — same pattern as QC, strictly one
// spec at a time: Check Out (or View QA if already checked out) -> review
// view -> error counts -> 3 comments -> delete one -> Approve -> "Ready For
// Bundling", then the next spec. Only specs QC sent to QA ("QC Completed" /
// "Ready for QA" / "QA Work In Progress") are handled. Pairs with
// backend-qc.spec.ts.
const BACKEND_CREDENTIAL_CANDIDATES = backendCredentials();

test('Backend QA: error counts + comments (delete one) -> Approve -> Ready For Bundling, one spec at a time', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);

    const backendLogin = new BackendLoginPage(page);
    const productionJob = new ProductionJobPage(page);
    const inventory = new InventoryOperatorPage(page);
    const review = new QcReviewPage(page);
    const ts = Date.now();

    const user = (await backendLogin.loginWithFallback(BACKEND_CREDENTIAL_CANDIDATES)).username;
    console.log('✅ Opened job:', await productionJob.viewFirstJob());
    const names = await inventory.articleNames();

    for (const [i, name] of names.entries()) {
        const label = `Spec ${i + 1} "${name}"`;

        await test.step(`${label}: QA`, async () => {
            const row = inventory.row(name);
            const status = await inventory.status(row);
            if (!/qc completed|ready for qa|qa work in progress/i.test(status)) {
                console.log(`   ${label} | Not in QA ("${status}") — skipping`);
                return;
            }

            const actions = (await row.locator('.viewtooltiptext').allTextContents()).map(t => t.trim());
            console.log(`   ${label} | "${status}" | actions: ${actions.join(', ')}`);

            if (!/qa work in progress/i.test(status)) {
                // Time Log (beside Check Out) at least 10s, then Check Out.
                expect(await inventory.logTime(row, label, user), `${label}: Time Log before Check Out`).not.toBe('no-assignee');
                await inventory.clickAction(inventory.row(name), 'Check Out');
            }
            // As in QC: Check Out can just assign and stay on the page; the
            // same action button then opens the review view.
            const opened = await page.waitForURL(QcReviewPage.VIEW_URL, { timeout: 15000 }).then(() => true).catch(() => false);
            if (!opened) {
                await expect.poll(() => inventory.status(inventory.row(name)), { timeout: 30000 }).toMatch(/qa work in progress/i);
                const view = (await inventory.row(name).locator('.viewtooltiptext').allTextContents())
                    .map(t => t.trim()).find(t => /^View Q[AC]$/i.test(t));
                expect(view, `${label}: a "View QA" action after Check Out`).toBeTruthy();
                await inventory.clickAction(inventory.row(name), view!);
            }
            await review.verifyLoaded(name, false);
            console.log(`   ${label} | QA view: ${page.url()}`);

            await review.addErrorCounts({ text: 1, style: 1, image: 0, other: 1 });
            console.log(`   ${label} | Error counts saved: Text 1 / Style 1 / image 0 / other 1`);

            const comments = [1, 2, 3].map(n => `Automation QA comment ${n} - ${name} - ${ts}`);
            const shown: boolean[] = [];
            for (const c of comments) {
                shown.push(await review.addComment(c));
            }
            console.log(`   ${label} | 3 comments added`);

            // Draft 2 on UAT doesn't list saved comments — nothing to delete.
            if (shown[1]) {
                await review.deleteComment(comments[1]);
                console.log(`   ${label} | Comment deleted: "${comments[1]}"`);
            } else {
                console.warn(`   ⚠️  ${label} | Comment not listed — delete skipped`);
            }

            const offered = await review.approve('Ready For Bundling');
            console.log(`   ${label} | Approve${offered.length ? ` -> menu (${offered.join(' / ')}) -> Ready For Bundling` : ' (submitted directly)'}`);

            await page.getByText(/ISSUE SUMMARY\s*-/).first().waitFor({ state: 'visible', timeout: 30000 });
            await page.getByRole('cell').first().waitFor({ state: 'visible', timeout: 30000 });
            await expect.poll(() => inventory.status(inventory.row(name)), { timeout: 30000 }).toMatch(/Ready for bundling/i);
            console.log(`✅ ${label} | QA done -> "${await inventory.status(inventory.row(name))}"`);
        });
    }

    const statuses: string[] = [];
    for (const name of names) statuses.push(`${name}: ${await inventory.status(inventory.row(name))}`);
    console.log('Final statuses:\n  ' + statuses.join('\n  '));
    await page.screenshot({ path: `screenshots/qa-done-${ts}.png`, fullPage: true });
    for (const s of statuses) {
        expect(s, 'every spec should end up Ready for bundling').toMatch(/Ready for bundling/i);
    }
});
