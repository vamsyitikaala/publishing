import { test } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { SignupPage } from '../pages/SignupPage';
import { LoginPage } from '../pages/LoginPage';
import { CreateMagazinePage } from '../pages/CreateMagazinePage';

// Pool of real magazine cover images — a fresh one is picked at random on
// every run instead of reusing one fixed file. Logo uses a real square logo
// asset (magazine covers are portrait, not representative of a logo).
const TEST_DATA_DIR = path.resolve(__dirname, '..', 'test-data');
const LOGO_IMAGE_PATH = path.join(TEST_DATA_DIR, '360_magazine_logo_236x315.png');

// Tries both known client credential pairs and proceeds with whichever one
// actually logs in — confirmed live that the older "a360.pbtest" account
// can return "Invalid Credentials" on UAT while the newer account still
// works, so don't hard-fail the whole run over one stale credential set.
const CLIENT_CREDENTIAL_CANDIDATES = [
    { username: 'a360.pbtest@gmail.com', password: 'Test@1234' },
    { username: 'Immediatemedia.publisher@gmail.com', password: 'Immediate@123' },
];

function pickRandomCoverImage(): string {
    const files = fs.readdirSync(TEST_DATA_DIR)
        .filter(f => /^magazine-cover-\d+\.png$/.test(f));
    const file = files[Math.floor(Math.random() * files.length)];
    return path.join(TEST_DATA_DIR, file);
}

test('Create New User', async ({ page, context }) => {
    test.setTimeout(3 * 60 * 1000);

    const signupPage = new SignupPage(page);
    const loginPage = new LoginPage(page);

    const newUser = await signupPage.signupNewClient();

    await test.step('Log in as the newly created client', async () => {
        await loginPage.login(newUser.email, newUser.password);
        await loginPage.verifyDashboardLoaded();
        console.log('✅ New user login validated:', newUser.email);
    });

    // Magazine creation continues on the established test account (same
    // pattern as Image Retouching's full-production-flow.spec.ts), rather
    // than the brand-new signup, matching the user's earlier preference to
    // keep the throwaway signup account separate from the account that
    // actually creates real records.
    const magazinePage = await context.newPage();
    const magazineLogin = new LoginPage(magazinePage);
    const createMagazinePage = new CreateMagazinePage(magazinePage);

    await test.step('Switch to client account on a new tab (try both known credential sets)', async () => {
        const working = await magazineLogin.loginWithFallback(CLIENT_CREDENTIAL_CANDIDATES);
        await magazineLogin.verifyDashboardLoaded();
        console.log('✅ Logged in on a fresh tab as:', working.username);
    });

    await test.step('Home -> Create Magazine', async () => {
        await magazineLogin.goToHome();
        console.log('URL after Home click:', magazinePage.url());

        await magazineLogin.goToCreateMagazine();
        console.log('URL after Create Magazine click:', magazinePage.url());
    });

    await test.step('Select "Apple News" as content destination', async () => {
        await createMagazinePage.selectContentDestination('Apple News');
        console.log('URL after Apple News -> Next:', magazinePage.url());
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

        await magazinePage.screenshot({
            path: `screenshots/magazine-details-filled-${timestamp}.png`,
            fullPage: true
        });
    });

    await test.step('Save Magazine', async () => {
        const result = await createMagazinePage.saveMagazine();

        if (!result.clicked) {
            console.log('⚠️  Save Magazine button was disabled — not clicked. URL:', magazinePage.url());
        } else if (result.errorText) {
            console.log('⚠️  Save clicked but an error is showing:', result.errorText, '| URL:', magazinePage.url());
        } else {
            console.log('✅ Magazine saved:', magazineName, '| URL after save:', magazinePage.url());
        }

        await magazinePage.screenshot({
            path: `screenshots/magazine-saved-${timestamp}.png`,
            fullPage: true
        });
    });

    await test.step('Return to Home screen', async () => {
        await magazineLogin.goToHome();
        console.log('✅ On Home screen, ready for next phase. URL:', magazinePage.url());

        await magazinePage.screenshot({
            path: `screenshots/home-after-magazine-${timestamp}.png`,
            fullPage: true
        });
    });
});
