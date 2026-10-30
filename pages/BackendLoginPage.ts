import { Page } from '@playwright/test';
import { env } from '../config/env';

// backend-uat.vmgpremedia.com/login. Confirmed live: this is a plain
// Angular Material form, not the client portal's formcontrolname-based one
// — inputs expose a real "name" attribute instead (no formcontrolname on
// either field).
export class BackendLoginPage {

    constructor(private page: Page) {}

    username = 'input[name="username"]';
    password = 'input[name="password"]';

    async navigate() {
        await this.page.goto(env.production.loginUrl);
    }

    async login(username: string, password: string) {
        await this.page.locator(this.username).fill(username);
        await this.page.locator(this.password).fill(password);
        await this.page.getByRole('button', { name: 'Log In' }).click();
        await this.page.waitForLoadState('networkidle');
    }

    // Tries each candidate credential pair in order and proceeds with the
    // first one that actually logs in — confirmed live that
    // "alluser-uat.pb@vmgdigital.com" / "Test@1234" returns an explicit
    // "Invalid Credentials." banner on this environment, so don't hard-fail
    // over one stale account when another candidate may still work.
    async loginWithFallback(candidates: { username: string; password: string }[]): Promise<{ username: string; password: string }> {
        for (const cred of candidates) {
            await this.navigate();
            await this.page.locator(this.username).fill(cred.username);
            await this.page.locator(this.password).fill(cred.password);
            await this.page.getByRole('button', { name: 'Log In' }).click();

            const outcome = await Promise.race([
                this.page.waitForURL(url => !url.pathname.endsWith('/login'), { timeout: 20000 }).then(() => 'success' as const),
                this.page.getByText('Invalid Credentials', { exact: false }).waitFor({ state: 'visible', timeout: 20000 }).then(() => 'invalid' as const),
            ]).catch(() => 'timeout' as const);

            if (outcome === 'success') {
                await this.page.waitForLoadState('networkidle');
                console.log(`✅ Backend login succeeded with: ${cred.username}`);
                return cred;
            }
            console.log(`⚠️  Backend login failed with ${cred.username} (${outcome}) — trying next credential set.`);
        }
        throw new Error('All candidate credentials failed to log in.');
    }
}
