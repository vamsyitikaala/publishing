import { test } from '@playwright/test';
import { BackendLoginPage } from '../pages/BackendLoginPage';
import { ProductionJobPage } from '../pages/ProductionJobPage';
import { CreateInventoryPage, InventoryEntry } from '../pages/CreateInventoryPage';

// Backend only: open the newest job (or JOB_ISSUE) on the Job Dashboard and
// build its inventory via Create Inventory, then confirm it is listed in
// the job's INVENTORY DRAFT table.
//   - Job already has inventory  -> just verify/list it (no duplicate).
//   - Otherwise                  -> create the inventory Manually
//     (INVENTORY_MODE=automatic: from the Automatic conversion instead).
// Pairs with existing-magazine-flow.spec.ts, which creates the newest job.
const BACKEND_CREDENTIAL_CANDIDATES = [
    { username: 'alluser-uat.pb@vmgdigital.com', password: 'Test@1234' },
    { username: 'alluser@vmgdigital.com', password: 'Test@1234' },
];

// Simple fixed split; the test PDF has well over 8 pages.
const MANUAL_ENTRIES: InventoryEntry[] = [
    { section: 'Cover page Count', articleName: 'Automation Cover', pageCount: 1, pageRange: '1-1' },
    { section: 'TOC', articleName: 'Automation TOC', pageCount: 1, pageRange: '2-2' },
    { section: 'Ads', articleName: 'Automation Ads', pageCount: 2, pageRange: '3-4' },
    { section: 'Articles', articleName: 'Automation Article', pageCount: 4, pageRange: '5-8' },
];

test('Backend: newest job -> Create Inventory', async ({ page }) => {
    // Automatic mode may wait out the conversion (up to 15 min).
    test.setTimeout((process.env.INVENTORY_MODE === 'automatic' ? 20 : 5) * 60 * 1000);

    const backendLogin = new BackendLoginPage(page);
    const productionJob = new ProductionJobPage(page);
    const timestamp = Date.now();

    await test.step('Backend login', async () => {
        const working = await backendLogin.loginWithFallback(BACKEND_CREDENTIAL_CANDIDATES);
        console.log('✅ Backend logged in as:', working.username);
    });

    await test.step('Open newest job (View Job)', async () => {
        const job = await productionJob.viewFirstJob();
        console.log('✅ Opened job:', job);
    });

    if (await productionJob.hasInventoryDraft()) {
        await test.step('Job already has inventory -> list it', async () => {
            const rows = await productionJob.inventoryRows();
            console.log(`✅ Inventory already listed (${rows.length} rows):\n  ` + rows.join('\n  '));            await page.screenshot({ path: `screenshots/inventory-listed-${timestamp}.png`, fullPage: true });
        });
        return;
    }

    let status = '';
    await test.step('Create Inventory -> read Automatic status', async () => {
        console.log('Create Inventory menu:', await productionJob.openCreateInventoryMenu());
        status = await productionJob.automaticStatus();
        console.log('Automatic status:', status);
    });

    // INVENTORY_MODE=automatic: start the conversion if needed (normally
    // backend-start-automatic.spec.ts already did, minutes earlier), wait
    // for "Completed", then submit the pre-filled form as converted.
    // Confirmed live: dropping cards before Submit still answers HTTP 200
    // but no inventory is ever created (and Automatic can't be redone on
    // that job) — so keep the job small via a short PDF instead.
    // AUTO_KEEP=<n> trims anyway, for investigating that.
    if (process.env.INVENTORY_MODE === 'automatic') {
        await test.step(`Automatic is "${status}" -> wait for Completed`, async () => {
            if (/click to start/i.test(status)) {
                await productionJob.chooseAutomaticInventory();
                console.log('✅ Automatic inventory started');
                await page.reload();
                await productionJob.openCreateInventoryMenu();
            }
            console.log('✅ Automatic status:', await productionJob.waitForAutomaticCompleted());
        });

        let kept: { articleName: string; pageCount: string; pageRange: string }[] = [];
        await test.step('Create inventory from the Automatic result', async () => {
            await productionJob.openCompletedAutomaticInventory();
            kept = await new CreateInventoryPage(page).submitAutomaticInventory(Number(process.env.AUTO_KEEP || Infinity));
            console.log('✅ Inventory submitted');
        });

        await test.step('Verify the inventory is listed on the job (INVENTORY DRAFT)', async () => {
            await productionJob.goToJobDashboard();
            await productionJob.viewFirstJob();
            const rows = await productionJob.inventoryRows();
            console.log(`Inventory (${rows.length} rows):\n  ` + rows.join('\n  '));
            await productionJob.verifyArticlesListed(kept.map(k => k.articleName));
            await page.screenshot({ path: `screenshots/inventory-listed-${timestamp}.png`, fullPage: true });
            console.log('✅ Automatic inventory created and listed on the job');
        });
        return;
    }

    await test.step(`Automatic is "${status}" -> create Manual inventory`, async () => {
        const manualPage = await productionJob.chooseManualInventory();
        console.log('✅ Manual Inventory Log opened:', manualPage.url());

        await new CreateInventoryPage(manualPage).createInventory(MANUAL_ENTRIES);
        console.log('✅ Inventory submitted');
    });

    await test.step('Verify the inventory is listed on the job (INVENTORY DRAFT)', async () => {
        await productionJob.goToJobDashboard();
        await productionJob.viewFirstJob();
        await productionJob.verifyInventoryListed(MANUAL_ENTRIES);
        await page.screenshot({ path: `screenshots/inventory-listed-${timestamp}.png`, fullPage: true });
        console.log('✅ Inventory created and listed on the job');
    });
});
