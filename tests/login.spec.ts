import { test } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { env } from '../config/env';

test.describe('Login Module', () => {

    test('Valid Login', async ({ page }) => {

        const loginPage = new LoginPage(page);

        await loginPage.navigate();

        await loginPage.login(
            env.client.username,
            env.client.password
        );

        await loginPage.verifyDashboardLoaded();
    }); // Valid Login

});
