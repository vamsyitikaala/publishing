import { test, expect } from '@playwright/test';
import { BackendLoginPage } from '../pages/BackendLoginPage';
import { ProductionJobPage } from '../pages/ProductionJobPage';

// Kick off Automatic inventory on a job (JOB_ISSUE, else the newest) and
// return straight away — the conversion runs server-side for ~5-7 min, so
// the dual run does a whole manual job in the meantime and only comes back
// to this one afterwards (backend-create-inventory.spec.ts with
// INVENTORY_MODE=automatic).
const BACKEND_CREDENTIAL_CANDIDATES = [
    { username: 'alluser-uat.pb@vmgdigital.com', password: 'Test@1234' },
    { username: 'alluser@vmgdigital.com', password: 'Test@1234' },
];

test('Backend: start Automatic inventory conversion', async ({ page }) => {
    test.setTimeout(3 * 60 * 1000);

    const productionJob = new ProductionJobPage(page);
    await new BackendLoginPage(page).loginWithFallback(BACKEND_CREDENTIAL_CANDIDATES);
    console.log('✅ Opened job:', await productionJob.viewFirstJob());

    console.log('Create Inventory menu:', await productionJob.openCreateInventoryMenu());
    const status = await productionJob.automaticStatus();
    console.log('Automatic status:', status);
    if (!/click to start/i.test(status)) {
        console.log(`✅ Automatic already started ("${status}") — nothing to do`);
        return;
    }

    await productionJob.chooseAutomaticInventory();
    await page.reload();
    await productionJob.openCreateInventoryMenu();
    const after = await productionJob.automaticStatus();
    console.log('Automatic status after start:', after);
    expect(after, 'Automatic should have left "Click to Start"').not.toMatch(/click to start/i);
    console.log('✅ Automatic inventory conversion started');
});
