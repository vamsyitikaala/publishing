import { Page, Locator, expect } from '@playwright/test';
import { ErrorCounts } from './QcReviewPage';

// Client side of Proofing: Home -> magazine card "Recent Jobs" -> View Job
// -> Issue Summary (/dashboard/reviewjob). Confirmed live:
//   - the job-level "Approve" (beside the Delivery Link) posts
//     /api/pc/<job id>/approve straight away — no confirm — and returns
//     to the dashboard;
//   - per spec row (Title / Status "To Proof"), the last Action icon opens
//     the feedback page (/feedbackCommentUpload): "Write Your Feedback" +
//     Add, error counts Text / Style / Image / Others + Save, and Submit,
//     which returns to the job with the spec "Feedback Submitted";
//   - "Submit Feedback" under the table posts /api/pc/<job id>/feedback
//     ("Feedback Received") + /feedback/submit-status, which opens Draft 2
//     on the production side with every spec in "Rework".
export class ClientReviewPage {

    constructor(private page: Page) {}

    // Confirmed live: magazine cards render only after the slow
    // client-magazines call, and the job name itself isn't clickable — its
    // "View Job" sibling is.
    async openJob(issueName: string) {
        await this.page.locator('a.nav-link', { hasText: 'Home' }).click({ timeout: 15000 });
        const viewJob = this.page.locator(`xpath=//p[normalize-space()="${issueName}"]/following::p[normalize-space()="View Job"][1]`);
        await viewJob.waitFor({ state: 'visible', timeout: 90000 });
        await viewJob.click({ timeout: 15000 });
        await this.page.getByText(`ISSUE SUMMARY - ${issueName}`).waitFor({ state: 'visible', timeout: 60000 });
        await this.specRows().first().waitFor({ state: 'visible', timeout: 60000 });
        await this.page.waitForLoadState('networkidle').catch(() => {});
    }

    private specRows(): Locator {
        return this.page.getByRole('row').filter({ has: this.page.getByRole('cell') });
    }

    private row(title: string): Locator {
        return this.specRows().filter({ has: this.page.getByRole('cell', { name: title, exact: true }) }).first();
    }

    // Columns: S.No, Content Type, Title, Page Count, Page Range, Status, Action.
    async specs(): Promise<{ title: string; status: string }[]> {
        const rows = this.specRows();
        const specs: { title: string; status: string }[] = [];
        for (let i = 0; i < await rows.count(); i++) {
            const cells = rows.nth(i).getByRole('cell');
            specs.push({ title: (await cells.nth(2).innerText()).trim(), status: (await cells.nth(5).innerText()).trim() });
        }
        return specs;
    }

    async status(title: string): Promise<string> {
        return (await this.row(title).getByRole('cell').nth(5).innerText()).trim();
    }

    async approveJob(): Promise<string> {
        const approved = this.page.waitForResponse(
            r => /\/api\/pc\/\d+\/approve/.test(r.url()) && r.request().method() === 'POST', { timeout: 90000 });
        await this.page.getByRole('button', { name: 'Approve', exact: true }).click({ timeout: 15000 });
        const response = await approved;
        const body = await response.text().catch(() => '');
        expect(response.ok(), `approve returned HTTP ${response.status()}: ${body}`).toBeTruthy();
        return body;
    }

    async giveFeedback(title: string, comment: string, counts: ErrorCounts) {
        // The page loads any saved counts on open — let that land before
        // typing, or it overwrites the fields.
        const countsLoaded = this.page.waitForResponse(r => /\/get\/article-files\/error-count/.test(r.url()), { timeout: 60000 });
        await this.row(title).getByRole('cell').last().locator('img').last().click({ timeout: 15000 });
        const box = this.page.getByRole('textbox', { name: 'Write Your Feedback' });
        await box.waitFor({ state: 'visible', timeout: 60000 });
        await countsLoaded.catch(() => {});

        await box.fill(comment);
        const added = this.page.waitForResponse(r => /\/upload\/article-feedbackfile/.test(r.url()), { timeout: 60000 });
        await this.page.getByRole('button', { name: 'Add', exact: true }).click({ timeout: 15000 });
        expect((await added).ok(), 'feedback comment upload').toBeTruthy();
        await expect(this.page.getByRole('row').filter({ hasText: comment }).first()).toBeVisible({ timeout: 30000 });

        const edit = this.page.getByRole('button', { name: 'Edit', exact: true });
        if (await edit.isVisible()) await edit.click();
        const values: [string, number][] = [['Text', counts.text], ['Style', counts.style], ['Image', counts.image], ['Others', counts.other]];
        for (const [name, value] of values) {
            await this.page.getByRole('spinbutton', { name, exact: true }).fill(String(value), { timeout: 15000 });
        }
        const saved = this.page.waitForResponse(r => /\/(save|update)\/article-files\/error-count/.test(r.url()), { timeout: 60000 });
        await this.page.getByRole('button', { name: /^(Save|Update)$/ }).click({ timeout: 15000 });
        const savedRes = await saved;
        expect(savedRes.ok(), `error-count save: ${await savedRes.text().catch(() => '')}`).toBeTruthy();
        await expect(edit).toBeVisible({ timeout: 30000 });

        const submitted = this.page.waitForResponse(r => /article-client-feedbacksubmit/.test(r.url()), { timeout: 60000 });
        await this.page.getByRole('button', { name: 'Submit', exact: true }).click({ timeout: 15000 });
        expect((await submitted).ok(), 'spec feedback submit').toBeTruthy();
        await this.specRows().first().waitFor({ state: 'visible', timeout: 60000 });
        await expect.poll(() => this.status(title), { timeout: 30000 }).toMatch(/feedback submitted/i);
    }

    async submitFeedback(): Promise<string[]> {
        const job = this.page.waitForResponse(
            r => /\/api\/pc\/\d+\/feedback/.test(r.url()) && r.request().method() === 'POST', { timeout: 90000 });
        const specs = this.page.waitForResponse(r => /\/feedback\/submit-status/.test(r.url()), { timeout: 90000 });
        await this.page.getByRole('button', { name: 'Submit Feedback' }).click({ timeout: 15000 });
        const messages: string[] = [];
        for (const response of [await job, await specs]) {
            const body = await response.text().catch(() => '');
            expect(response.ok(), `${response.url()} returned HTTP ${response.status()}: ${body}`).toBeTruthy();
            messages.push(body);
        }
        return messages;
    }
}
