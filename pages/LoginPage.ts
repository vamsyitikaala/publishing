import { Page } from '@playwright/test';
import { env } from '../config/env';

export class LoginPage {

    constructor(private page: Page) {}

    username = '[formcontrolname="username"]';
    password = '[formcontrolname="password"]';

    async navigate() {
        await this.page.goto(env.client.loginUrl);
    }

    async login(username: string, password: string) {

        await this.page.locator(this.username).fill(username);

        await this.page.locator(this.password).fill(password);

        await this.page.getByRole('button', {
            name: 'Login'
        }).click();

        // Confirmed live: login does an OAuth token exchange + user-details
        // fetch before the SPA router redirects, which can take ~8-10s —
        // give it a generous timeout rather than asserting early. A
        // brand-new signup with no magazines yet lands on
        // "/dashboard/getFTP" (a first-run FTP-setup interstitial) instead
        // of plain "/dashboard" — match any path under /dashboard, not an
        // exact one.
        await this.page.waitForURL('**/dashboard**', {
            timeout: 60000
        });

    }

    // Tries each candidate credential pair in order and proceeds with the
    // first one that actually logs in — confirmed live that the previously
    // "established" test account can go stale (UAT returned an explicit
    // "Invalid Credentials" banner for it on a later run) while a newer
    // account still works. Races the dashboard redirect against the
    // "Invalid Credentials" banner per candidate instead of waiting out the
    // full navigation timeout on each failure.
    async loginWithFallback(candidates: { username: string; password: string }[]): Promise<{ username: string; password: string }> {
        for (const cred of candidates) {
            await this.navigate();
            await this.page.locator(this.username).fill(cred.username);
            await this.page.locator(this.password).fill(cred.password);
            await this.page.getByRole('button', { name: 'Login' }).click();

            const outcome = await Promise.race([
                this.page.waitForURL('**/dashboard**', { timeout: 20000 }).then(() => 'success' as const),
                this.page.getByText('Invalid Credentials', { exact: false }).waitFor({ state: 'visible', timeout: 20000 }).then(() => 'invalid' as const),
            ]).catch(() => 'timeout' as const);

            if (outcome === 'success') {
                console.log(`✅ Login succeeded with: ${cred.username}`);
                return cred;
            }
            console.log(`⚠️  Login failed with ${cred.username} (${outcome}) — trying next credential set.`);
        }
        throw new Error('All candidate credentials failed to log in.');
    }

    async verifyDashboardLoaded() {

        await this.page.waitForURL('**/dashboard**', {
            timeout: 60000
        });

        await this.page.waitForLoadState('networkidle');

        await this.page.screenshot({
            path: 'screenshots/dashboard-loaded.png',
            fullPage: true
        });

    }

    // Sidebar nav is present on every /dashboard** route (including the
    // first-run FTP interstitial), so this is the reliable way back to the
    // magazine-grid home view regardless of where login dropped us.
    //
    // Confirmed live, two selector dead ends before this one:
    //  - getByText('HOME', exact): visible uppercase is CSS text-transform,
    //    actual text node is " Home" (leading space from a preceding icon
    //    <img>) — never matches.
    //  - getByRole('link', { name: 'Home' }): the <a class="nav-link..."> has
    //    no href attribute, so it gets no implicit ARIA link role either —
    //    also never matches. Both hang until the test timeout instead of
    //    failing fast, since neither has an explicit action timeout.
    // CSS class + text filter on the actual <a> instead.
    async goToHome() {
        await this.page.locator('a.nav-link', { hasText: 'Home' })
            .click({ timeout: 15000 });
        await this.page.waitForLoadState('networkidle');
    }

    // The dashboard's own "+Create Magazine" button (top-right of the
    // Magazines grid), not the sidebar nav item — confirmed live via its
    // button text "Create Magazine".
    async goToCreateMagazine() {
        await this.page.getByRole('button', { name: 'Create Magazine' })
            .click({ timeout: 15000 });
        await this.page.waitForLoadState('networkidle');
    }

}
