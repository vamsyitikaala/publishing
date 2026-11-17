import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { ClientReviewPage } from '../pages/ClientReviewPage';
import { clientCredentials } from '../config/credentials';

// Client review after To Proof (automatic job): feedback + error counts on
// every spec, Submit each, then "Submit Feedback" — sends the job back to
// production as Draft 2 (specs in "Rework"). JOB_ISSUE names the job.
// Specs already "Feedback Submitted" are skipped, so a rerun resumes.
const CLIENT_CREDENTIAL_CANDIDATES = clientCredentials();

const COUNTS = { text: 1, style: 1, image: 1, other: 0 };

test('Client: feedback on every spec -> Submit Feedback (Draft 2)', async ({ page }) => {
    test.setTimeout(10 * 60 * 1000);
    const issueName = process.env.JOB_ISSUE;
    expect(issueName, 'JOB_ISSUE must name the job').toBeTruthy();
    const review = new ClientReviewPage(page);

    await test.step('Client login + open the job', async () => {
        await new LoginPage(page).loginWithFallback(CLIENT_CREDENTIAL_CANDIDATES);
        await review.openJob(issueName!);
    });

    const specs = await review.specs();
    console.log(`Specs (${specs.length}):\n  ` + specs.map(s => `${s.title}: ${s.status}`).join('\n  '));

    for (const [i, spec] of specs.entries()) {
        const label = `Spec ${i + 1} "${spec.title}"`;
        await test.step(`${label}: feedback + error counts -> Submit`, async () => {
            if (/feedback submitted/i.test(spec.status)) {
                console.log(`   ${label} | Already "Feedback Submitted" — skipping`);
                return;
            }
            expect(spec.status, `${label} should be in To Proof`).toMatch(/to proof/i);
            await review.giveFeedback(spec.title, `Automation client feedback (${spec.title}): please rework`, COUNTS);
            console.log(`✅ ${label} | feedback submitted`);
        });
    }

    await test.step('Submit Feedback for the job', async () => {
        const messages = await review.submitFeedback();
        console.log('   ' + messages.join('\n   '));
        await page.screenshot({ path: `screenshots/client-feedback-${Date.now()}.png`, fullPage: true });
        console.log(`✅ Feedback submitted for ${issueName} — back to production as Draft 2`);
    });
});
