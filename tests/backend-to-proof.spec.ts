import { test, expect } from '@playwright/test';
import { BackendLoginPage } from '../pages/BackendLoginPage';
import { ProductionJobPage } from '../pages/ProductionJobPage';
import { InventoryOperatorPage } from '../pages/InventoryOperatorPage';
import { backendCredentials } from '../config/credentials';

// Bundling -> proof on the newest job: once every spec is "Ready for
// bundling" (after QC/QA), enter the Apple magazine (bundled) link in the
// bar under the inventory and click "To Proof". Pairs with
// backend-qa.spec.ts. BUNDLED_LINK overrides the default link.
const BACKEND_CREDENTIAL_CANDIDATES = backendCredentials();

test('Backend: all specs Ready for bundling -> Bundled Link -> To Proof', async ({ page }) => {
    test.setTimeout(5 * 60 * 1000);

    const productionJob = new ProductionJobPage(page);
    const inventory = new InventoryOperatorPage(page);
    const ts = Date.now();

    await new BackendLoginPage(page).loginWithFallback(BACKEND_CREDENTIAL_CANDIDATES);
    const job = await productionJob.viewFirstJob();
    console.log('✅ Opened job:', job);
    const names = await inventory.articleNames();

    const before: string[] = [];
    for (const name of names) before.push(await inventory.status(inventory.row(name)));
    console.log('Statuses before:\n  ' + names.map((n, i) => `${n}: ${before[i]}`).join('\n  '));
    // A rerun after the To Proof already went through.
    if (before.every(s => /proofing/i.test(s))) {
        console.log('✅ Every spec is already in Proofing — nothing to do');
        return;
    }
    for (const [i, s] of before.entries()) {
        expect(s, `"${names[i]}" must finish QC/QA before To Proof`).toMatch(/Ready for bundling/i);
    }

    const link = process.env.BUNDLED_LINK || `https://apple.news/automation-${job.issueName}`;
    await productionJob.submitBundledLinkToProof(link);
    console.log(`✅ Bundled link entered and To Proof clicked: ${link}`);

    await page.reload();
    await productionJob.inventoryRows();
    const after: string[] = [];
    for (const name of names) after.push(await inventory.status(inventory.row(name)));
    console.log('Statuses after:\n  ' + names.map((n, i) => `${n}: ${after[i]}`).join('\n  '));
    await page.screenshot({ path: `screenshots/to-proof-${ts}.png`, fullPage: true });
    for (const [i, s] of after.entries()) {
        expect(s, `"${names[i]}" should have moved on from Ready for bundling`).not.toMatch(/Ready for bundling/i);
    }
});
