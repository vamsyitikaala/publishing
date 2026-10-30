import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { SignupPage } from '../pages/SignupPage';
import { LoginPage } from '../pages/LoginPage';
import { CreateMagazinePage } from '../pages/CreateMagazinePage';
import { CreateJobPage } from '../pages/CreateJobPage';
import { BackendLoginPage } from '../pages/BackendLoginPage';
import { ProductionJobPage } from '../pages/ProductionJobPage';

// End-to-end: a brand-new client account creates a magazine and a job, then
// that exact job is verified as the first (most recent) row on the
// production/backend Job Dashboard — confirming the whole chain the client
// side feeds into the operator side.
const TEST_DATA_DIR = path.resolve(__dirname, '..', 'test-data');
const LOGO_IMAGE_PATH = path.join(TEST_DATA_DIR, '360_magazine_logo_236x315.png');
const ASSET_PATH = path.join(TEST_DATA_DIR, 'artists&illustrators_20260508.pdf');

const BACKEND_CREDENTIAL_CANDIDATES = [
    { username: 'alluser-uat.pb@vmgdigital.com', password: 'Test@1234' },
    { username: 'alluser@vmgdigital.com', password: 'Test@1234' },
];

function pickRandomCoverImage(): string {
    const files = fs.readdirSync(TEST_DATA_DIR).filter(f => /^magazine-cover-\d+\.png$/.test(f));
    const file = files[Math.floor(Math.random() * files.length)];
    return path.join(TEST_DATA_DIR, file);
}

function daysFromNow(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d;
}

test('Full flow: signup -> login -> create magazine -> create job -> verify in production', async ({ page, context }) => {
    test.setTimeout(8 * 60 * 1000); // signup + magazine (logo retries) + job (41MB asset upload) + backend check

    const signupPage = new SignupPage(page);
    const loginPage = new LoginPage(page);
    const createMagazinePage = new CreateMagazinePage(page);
    const createJobPage = new CreateJobPage(page);

    const newUser = await signupPage.signupNewClient();

    await test.step('Log in as the newly created client', async () => {
        await loginPage.login(newUser.email, newUser.password);
        await loginPage.verifyDashboardLoaded();
        console.log('✅ Logged in as new user:', newUser.email);
    });

    const timestamp = Date.now();
    const magazineName = `${timestamp}_Automation_Magazine`;

    await test.step('Home -> Create Magazine', async () => {
        await loginPage.goToHome();
        await loginPage.goToCreateMagazine();
        console.log('URL after Create Magazine click:', page.url());
    });

    await test.step('Select "Apple News" as content destination', async () => {
        await createMagazinePage.selectContentDestination('Apple News');
    });

    await test.step('Fill Magazine Details (name, cover, logo, candance, description, website)', async () => {
        const coverPath = pickRandomCoverImage();
        await createMagazinePage.fillMagazineDetails({
            magazineName,
            coverPath,
            logoPath: LOGO_IMAGE_PATH,
            candance: 'monthly',
            description: 'Automation test magazine — created by the Publishing Playwright suite.',
            websiteUrl: `https://automation-test-${timestamp}.example.com`
        });
    });

    await test.step('Save Magazine', async () => {
        const result = await createMagazinePage.saveMagazine();
        // Fail fast here rather than silently continuing into Create Job —
        // without a saved magazine there is nothing for the job dropdown to
        // pick, and it would otherwise hang until the full test timeout.
        expect(result.clicked, 'Save Magazine button should have been enabled and clicked').toBe(true);
        expect(result.errorText, `Magazine must save successfully before creating a job on it`).toBeNull();
        console.log('✅ Magazine saved:', magazineName);
    });

    const issueName = `Automation_Issue_${timestamp}`;

    await test.step('Create Job on the newly created magazine', async () => {
        await loginPage.goToHome();
        await createJobPage.goToCreateJob();

        const pickedMagazine = await createJobPage.chooseLatestMagazine();
        console.log('Picked magazine for job:', pickedMagazine);
        expect(pickedMagazine).toBe(magazineName);

        await createJobPage.uploadAsset(ASSET_PATH);

        await createJobPage.fillJobDetails({
            year: new Date().getFullYear(),
            issueName,
            fileDueDate: daysFromNow(14),
            dueDate: daysFromNow(21),
            onSaleDate: daysFromNow(30),
        });

        const confirmed = await createJobPage.submitJobSummary();
        expect(confirmed).toBe(true);
        console.log('✅ Job created:', issueName);
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
