import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { ClientReviewPage } from '../pages/ClientReviewPage';
import { clientCredentials } from '../config/credentials';

// Client review after To Proof (manual job): every spec is "To Proof" ->
// Approve the job. JOB_ISSUE names the job. Pairs with
// backend-to-proof.spec.ts.
const CLIENT_CREDENTIAL_CANDIDATES = clientCredentials();

test('Client: review the proofed job -> Approve', async ({ page }) => {
    test.setTimeout(6 * 60 * 1000);
    const issueName = process.env.JOB_ISSUE;
    expect(issueName, 'JOB_ISSUE must name the job').toBeTruthy();
    const review = new ClientReviewPage(page);

    await test.step('Client login + open the job', async () => {
        await new LoginPage(page).loginWithFallback(CLIENT_CREDENTIAL_CANDIDATES);
        await review.openJob(issueName!);
    });

    await test.step('Review: every spec is in To Proof', async () => {
        const specs = await review.specs();
        console.log(`Specs (${specs.length}):\n  ` + specs.map(s => `${s.title}: ${s.status}`).join('\n  '));
        for (const s of specs) expect(s.status, `"${s.title}" should be in To Proof`).toMatch(/to proof/i);
    });

    await test.step('Approve the job', async () => {
        console.log('   approve ->', await review.approveJob());
        await page.screenshot({ path: `screenshots/client-approved-${Date.now()}.png`, fullPage: true });
        console.log(`✅ Client approved ${issueName}`);
    });
});
