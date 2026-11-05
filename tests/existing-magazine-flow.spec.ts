import { test, expect } from '@playwright/test';
import * as path from 'path';
import { LoginPage } from '../pages/LoginPage';
import { CreateJobPage } from '../pages/CreateJobPage';
import { BackendLoginPage } from '../pages/BackendLoginPage';
import { ProductionJobPage } from '../pages/ProductionJobPage';

// Same client -> production chain as full-flow.spec.ts, minus signup and
// Create Magazine: logs in as an established client and creates the job on
// that account's most recent magazine. Use this while Create Magazine is
// blocked on UAT ("Technical Error Uploading the Logo. Code S3.").
const CLIENT_CREDENTIAL_CANDIDATES = [
    { username: 'a360.pbtest@gmail.com', password: 'Test@1234' },
    { username: 'Immediatemedia.publisher@gmail.com', password: 'Immediate@123' },
];

const BACKEND_CREDENTIAL_CANDIDATES = [
    { username: 'alluser-uat.pb@vmgdigital.com', password: 'Test@1234' },
    { username: 'alluser@vmgdigital.com', password: 'Test@1234' },
];

// ASSET_FILE (a file in test-data/) overrides the asset — the dual run's
// automatic job uses a 4-page cut of this PDF so its conversion yields 4
// inventory cards instead of 41.
const ASSET_PATH = path.resolve(__dirname, '..', 'test-data', process.env.ASSET_FILE || 'artists&illustrators_20260508.pdf');

function daysFromNow(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d;
}

test('Existing magazine flow: login -> create job -> verify in production', async ({ page, context }) => {
    test.setTimeout(8 * 60 * 1000); // 41MB asset upload + backend check

    const loginPage = new LoginPage(page);
    const createJobPage = new CreateJobPage(page);

    const timestamp = Date.now();
    // ISSUE_NAME lets a runner script know the job's name up front.
    const issueName = process.env.ISSUE_NAME || `Automation_Issue_${timestamp}`;
    let magazineName = '';

    await test.step('Log in as established client', async () => {
        const working = await loginPage.loginWithFallback(CLIENT_CREDENTIAL_CANDIDATES);
        await loginPage.verifyDashboardLoaded();
        console.log('✅ Logged in as:', working.username);
    });

    await test.step('Create Job on the latest existing magazine', async () => {
        await createJobPage.goToCreateJob();
        magazineName = await createJobPage.chooseLatestMagazine();
        console.log('✅ Picked latest magazine:', magazineName);

        await createJobPage.uploadAsset(ASSET_PATH);
        console.log('✅ Asset uploaded');

        await createJobPage.fillJobDetails({
            year: new Date().getFullYear(),
            issueName,
            fileDueDate: daysFromNow(14),
            dueDate: daysFromNow(21),
            onSaleDate: daysFromNow(30),
        });

        const confirmed = await createJobPage.submitJobSummary();
        expect(confirmed).toBe(true);
        console.log('✅ Job created:', issueName, '| magazine:', magazineName);
    });

    await test.step('Verify the new job is first in the production (backend) dashboard', async () => {
        const backendPage = await context.newPage();
        const backendLogin = new BackendLoginPage(backendPage);
        const productionJob = new ProductionJobPage(backendPage);

        const working = await backendLogin.loginWithFallback(BACKEND_CREDENTIAL_CANDIDATES);
        console.log('✅ Backend logged in as:', working.username);

        const firstJob = await productionJob.viewFirstJob();
        console.log('First row in production Job Dashboard:', firstJob);

        expect(firstJob.issueName).toBe(issueName);
        expect(firstJob.magazineName).toBe(magazineName);
        console.log('✅ Confirmed: client-created job appears first in production and matches.');

        await backendPage.screenshot({
            path: `screenshots/production-job-view-${timestamp}.png`,
            fullPage: true
        });
    });
});
