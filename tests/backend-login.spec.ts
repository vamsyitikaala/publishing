import { test } from '@playwright/test';
import { BackendLoginPage } from '../pages/BackendLoginPage';

// Tries both known backend (operator) credential pairs and proceeds with
// whichever actually logs in. Confirmed live:
// "alluser-uat.pb@vmgdigital.com" / "Test@1234" -> "Invalid Credentials."
const BACKEND_CREDENTIAL_CANDIDATES = [
    { username: 'alluser-uat.pb@vmgdigital.com', password: 'Test@1234' },
    { username: 'alluser@vmgdigital.com', password: 'Test@1234' },
];

test('Backend login (try both known credential sets)', async ({ page }) => {
    test.setTimeout(2 * 60 * 1000);

    const backendLogin = new BackendLoginPage(page);
    const working = await backendLogin.loginWithFallback(BACKEND_CREDENTIAL_CANDIDATES);
    console.log('✅ Logged in to backend as:', working.username, '| URL:', page.url());

    await page.screenshot({ path: 'screenshots/backend-dashboard-loaded.png', fullPage: true });
});
