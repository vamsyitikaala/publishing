import { test, expect } from '@playwright/test';
import * as path from 'path';
import { LoginPage } from '../pages/LoginPage';
import { CreateJobPage } from '../pages/CreateJobPage';

// Reuses the most recently created magazine already in the account (no
// Create Magazine step here) — Create Job is the flow that actually
// produces a job on the backend, by attaching an issue (asset + dates) to
// an existing magazine.
const CLIENT_CREDENTIAL_CANDIDATES = [
    { username: 'a360.pbtest@gmail.com', password: 'Test@1234' },
    { username: 'Immediatemedia.publisher@gmail.com', password: 'Immediate@123' },
];

const ASSET_PATH = path.resolve(__dirname, '..', 'test-data', 'artists&illustrators_20260508.pdf');

function daysFromNow(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d;
}

test('Create Job on the most recently created magazine', async ({ page }) => {
    test.setTimeout(6 * 60 * 1000); // the 41MB PDF asset takes a while to upload

    const loginPage = new LoginPage(page);
    const createJobPage = new CreateJobPage(page);

    await test.step('Log in as client (try both known credential sets)', async () => {
        const working = await loginPage.loginWithFallback(CLIENT_CREDENTIAL_CANDIDATES);
        await loginPage.verifyDashboardLoaded();
        console.log('✅ Logged in as:', working.username);
    });

    let magazineName = '';
    await test.step('Create Job -> Choose Magazine (latest)', async () => {
        await createJobPage.goToCreateJob();
        magazineName = await createJobPage.chooseLatestMagazine();
        console.log('✅ Picked latest magazine:', magazineName, '| URL:', page.url());
    });

    await test.step('Upload Your Assets', async () => {
        await createJobPage.uploadAsset(ASSET_PATH);
        console.log('✅ Asset uploaded, URL:', page.url());
    });

    const timestamp = Date.now();
    const issueName = `Automation_Issue_${timestamp}`;

    await test.step('Fill Job Details (year, issue name, dates)', async () => {
        await createJobPage.fillJobDetails({
            year: new Date().getFullYear(),
            issueName,
            fileDueDate: daysFromNow(14),
            dueDate: daysFromNow(21),
            onSaleDate: daysFromNow(30),
        });
        console.log('✅ Job Details filled:', issueName, '| URL:', page.url());

        await page.screenshot({
            path: `screenshots/create-job-summary-${timestamp}.png`,
            fullPage: true
        });
    });

    await test.step('Submit Job Summary', async () => {
        const confirmed = await createJobPage.submitJobSummary();
        expect(confirmed).toBe(true);
        console.log('✅ Job created for magazine:', magazineName, '| issue:', issueName);

        await page.screenshot({
            path: `screenshots/create-job-submitted-${timestamp}.png`,
            fullPage: true
        });
    });
});
