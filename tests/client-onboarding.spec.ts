import { test, expect } from '@playwright/test';
import * as path from 'path';
import { SignupPage } from '../pages/SignupPage';
import { LoginPage } from '../pages/LoginPage';
import { CreateMagazinePage } from '../pages/CreateMagazinePage';
import { env } from '../config/env';

// One-off onboarding of a named client for an environment: sign up the
// account in .env.<name> (CLIENT_USERNAME / CLIENT_PASSWORD), log in, and
// create its magazine (MAGAZINE_NAME) — the magazine every later job in that
// environment goes on. Names and images come from ONBOARD_* below.
//
//   TEST_ENV=production npx playwright test tests/client-onboarding.spec.ts --headed
const TEST_DATA_DIR = path.resolve(__dirname, '..', 'test-data');
const ONBOARD = {
    clientName: process.env.ONBOARD_CLIENT_NAME || 'Immediate',
    publisherName: process.env.ONBOARD_PUBLISHER || 'ImmediateTest',
    firstName: 'Immediate',
    lastName: 'Test',
    mobileNumber: '9876543210',
    coverPath: path.join(TEST_DATA_DIR, process.env.ONBOARD_COVER || 'Immediate_Media_Magazine_Cover_RES.jpg'),
    logoPath: path.join(TEST_DATA_DIR, process.env.ONBOARD_LOGO || 'Immediate_Media_Logo_Blue_RES.jpg'),
    description: 'ImmediateTMdia — Publishing automation magazine for Immediate.',
    websiteUrl: 'https://www.immediate.co.uk',
};

test('Onboard client: sign up -> login -> create magazine', async ({ page }) => {
    test.setTimeout(10 * 60 * 1000);
    const magazineName = process.env.MAGAZINE_NAME;
    expect(magazineName, `MAGAZINE_NAME must be set in .env.${env.name}`).toBeTruthy();
    const signup = new SignupPage(page);
    const login = new LoginPage(page);
    const magazine = new CreateMagazinePage(page);

    // Rerunnable: an account that already logs in is not signed up again,
    // and an existing magazine is not created again. Confirmed live
    // (production): right after signup the API answers 401 to the new
    // account for a while (provisioning lag), so a first run can create the
    // account but fail the magazine — just run it again.
    const exists = await login.loginWithFallback([{ username: env.client.username, password: env.client.password }])
        .then(() => true).catch(() => false);

    if (!exists) await test.step(`Sign up client "${ONBOARD.clientName}" (${env.client.username})`, async () => {
        await signup.navigate();
        await signup.openRegisterForm();
        await signup.fillForm({
            clientName: ONBOARD.clientName,
            firstName: ONBOARD.firstName,
            lastName: ONBOARD.lastName,
            email: env.client.username,
            mobileNumber: ONBOARD.mobileNumber,
            password: env.client.password,
            publisherName: ONBOARD.publisherName,
        });
        await page.screenshot({ path: `screenshots/onboard-signup-form-${env.name}.png`, fullPage: true });
        await signup.submit();
        console.log(`✅ Signed up: ${env.client.username} | Client "${ONBOARD.clientName}" | Publisher "${ONBOARD.publisherName}"`);
    });

    if (!exists) await test.step('Log in as the new client', async () => {
        await login.loginWithFallback([{ username: env.client.username, password: env.client.password }]);
    });
    await login.verifyDashboardLoaded();

    // Magazine cards render only after the slow client-magazines call.
    const magazineCard = page.getByRole('heading', { name: magazineName!, exact: true });
    const magazines = page.waitForResponse(r => /client-magazines/.test(r.url()), { timeout: 90000 }).catch(() => null);
    await login.goToHome();
    await magazines;
    const alreadyThere = await magazineCard.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
    if (alreadyThere) console.log(`✅ Magazine "${magazineName}" already exists — not creating it again`);

    if (!alreadyThere) await test.step(`Create magazine "${magazineName}"`, async () => {
        await login.goToCreateMagazine();
        await magazine.selectContentDestination('Apple News');
        await magazine.fillMagazineDetails({
            magazineName: magazineName!,
            coverPath: ONBOARD.coverPath,
            logoPath: ONBOARD.logoPath,
            candance: 'monthly',
            description: ONBOARD.description,
            websiteUrl: ONBOARD.websiteUrl,
        });
        await page.screenshot({ path: `screenshots/onboard-magazine-form-${env.name}.png`, fullPage: true });
        const result = await magazine.saveMagazine();
        expect(result.clicked, 'Save Magazine should be enabled').toBe(true);
        expect(result.errorText, 'Save Magazine should not show an error').toBeNull();
        console.log(`✅ Magazine saved: ${magazineName}`);
    });

    await test.step('Magazine is listed on the dashboard', async () => {
        await login.goToHome();
        await expect(magazineCard).toBeVisible({ timeout: 90000 });
        await page.screenshot({ path: `screenshots/onboard-dashboard-${env.name}.png`, fullPage: true });
        console.log(`✅ "${magazineName}" is on ${env.client.username}'s dashboard`);
    });
});
