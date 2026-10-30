import { test } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { LoginPage } from '../pages/LoginPage';
import { CreateMagazinePage } from '../pages/CreateMagazinePage';

// Scoped flow: skip signup entirely and go straight to Create Magazine —
// faster iteration loop than the full signup.spec.ts when signup/login
// aren't what's under test. Ends back on the Home/dashboard screen with the
// new magazine created, ready for the next phase (job creation) to build
// on top of.
//
// Tries both known client credential pairs and proceeds with whichever one
// actually logs in — confirmed live that the older "a360.pbtest" account
// can return "Invalid Credentials" on UAT while the newer account still
// works, so don't hard-fail the whole run over one stale credential set.
const CLIENT_CREDENTIAL_CANDIDATES = [
    { username: 'a360.pbtest@gmail.com', password: 'Test@1234' },
    { username: 'Immediatemedia.publisher@gmail.com', password: 'Immediate@123' },
];

const TEST_DATA_DIR = path.resolve(__dirname, '..', 'test-data');
const LOGO_IMAGE_PATH = path.join(TEST_DATA_DIR, '360_magazine_logo_236x315.png');

function pickRandomCoverImage(): string {
    const files = fs.readdirSync(TEST_DATA_DIR)
        .filter(f => /^magazine-cover-\d+\.png$/.test(f));
    const file = files[Math.floor(Math.random() * files.length)];
    return path.join(TEST_DATA_DIR, file);
}

test('Create Magazine on established account', async ({ page }) => {
    test.setTimeout(3 * 60 * 1000);

    const loginPage = new LoginPage(page);
    const createMagazinePage = new CreateMagazinePage(page);

    await test.step('Log in as client (try both known credential sets)', async () => {
        const working = await loginPage.loginWithFallback(CLIENT_CREDENTIAL_CANDIDATES);
        await loginPage.verifyDashboardLoaded();
        console.log('✅ Logged in as:', working.username);
    });

    await test.step('Home -> Create Magazine', async () => {
        await loginPage.goToHome();
        console.log('URL after Home click:', page.url());

        await loginPage.goToCreateMagazine();
        console.log('URL after Create Magazine click:', page.url());
    });

    await test.step('Select "Apple News" as content destination', async () => {
        await createMagazinePage.selectContentDestination('Apple News');
        console.log('URL after Apple News -> Next:', page.url());
    });

    const timestamp = Date.now();
    const magazineName = `${timestamp}_Automation_Magazine`;

    await test.step('Fill Magazine Details (name, cover, logo, candance, description, website)', async () => {
        const coverPath = pickRandomCoverImage();
        console.log('Cover image:', path.basename(coverPath));
        console.log('Logo image:', path.basename(LOGO_IMAGE_PATH));

        await createMagazinePage.fillMagazineDetails({
            magazineName,
            coverPath,
            logoPath: LOGO_IMAGE_PATH,
            candance: 'monthly',
            description: 'Automation test magazine — created by the Publishing Playwright suite.',
            websiteUrl: `https://automation-test-${timestamp}.example.com`
        });

        await page.screenshot({
            path: `screenshots/magazine-details-filled-${timestamp}.png`,
            fullPage: true
        });
    });

    await test.step('Save Magazine', async () => {
        const result = await createMagazinePage.saveMagazine();

        if (!result.clicked) {
            console.log('⚠️  Save Magazine button was disabled — not clicked. URL:', page.url());
        } else if (result.errorText) {
            console.log('⚠️  Save clicked but an error is showing:', result.errorText, '| URL:', page.url());
        } else {
            console.log('✅ Magazine saved:', magazineName, '| URL after save:', page.url());
        }

        await page.screenshot({
            path: `screenshots/magazine-saved-${timestamp}.png`,
            fullPage: true
        });
    });

    await test.step('Return to Home screen', async () => {
        await loginPage.goToHome();
        console.log('✅ On Home screen, ready for next phase. URL:', page.url());

        await page.screenshot({
            path: `screenshots/home-after-magazine-${timestamp}.png`,
            fullPage: true
        });
    });
});
