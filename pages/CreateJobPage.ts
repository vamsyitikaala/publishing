import { Page, expect } from '@playwright/test';

const MONTH_FULL = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

// Sidebar "Create Job" -> "Choose Magazine" (/dashboard/magazineList) ->
// "Upload Your Assets" (/assetUpload) -> "Job Details" (/jobDetails) ->
// "Job Summary" -> Submit. Confirmed live this is a SEPARATE flow from
// Create Magazine — a magazine alone never produces a backend job; this is
// the flow that actually does, by attaching an issue (assets + dates) to an
// already-created magazine.
export class CreateJobPage {

    constructor(private page: Page) {}

    // Confirmed live: sidebar nav text is " Create Job" (leading space from a
    // preceding icon, same CSS text-transform situation as "Home" in
    // LoginPage.ts) — class + text filter, not an exact match.
    async goToCreateJob() {
        await this.page.locator('a.nav-link', { hasText: 'Create Job' }).click({ timeout: 15000 });
        await this.page.waitForURL('**/magazineList**', { timeout: 20000 });
    }

    // Confirmed live: the magazine picker is an Angular Material mat-select
    // (not a native <select>), loads disabled until the magazine list
    // fetches async. Its options are sorted newest-first — option 0 is
    // "Add New Magazine +", option 1 is always the most recently created
    // magazine, confirmed by timestamp-based test magazine names appearing
    // in descending creation order.
    async chooseLatestMagazine(): Promise<string> {
        const matSelect = this.page.locator('mat-select').first();
        await this.page.waitForFunction(() => {
            const el = document.querySelector('mat-select');
            return el && !el.classList.contains('mat-mdc-select-disabled');
        }, { timeout: 20000 });

        await matSelect.click({ timeout: 15000 });
        await this.page.waitForTimeout(500);

        const options = this.page.locator('mat-option');
        const optionCount = await options.count();
        if (optionCount < 2) {
            throw new Error(
                `Choose Magazine dropdown has no real magazine to pick (only "Add New Magazine +" / ${optionCount} option(s) total) — ` +
                `a prior magazine creation likely failed to save.`
            );
        }
        const latestOption = options.nth(1); // 0 = "Add New Magazine +"
        const latestName = (await latestOption.textContent({ timeout: 10000 }))?.trim() ?? '';
        await latestOption.click({ timeout: 10000 });
        await this.page.waitForTimeout(300);

        await this.page.getByRole('button', { name: 'Next' }).click({ timeout: 15000 });
        await this.page.waitForURL('**/assetUpload**', { timeout: 20000 });

        return latestName;
    }

    // Confirmed live via network trace: the visible "Drag and Drop / Choose
    // file" zone is an ngx-file-drop component with for="logo_file" — it
    // proxies clicks to a SEPARATE external #logo_file input, not its own
    // internal .ngx-file-drop__file-input. Clicking the internal input
    // (even via a raw DOM click to bypass Playwright's visibility check)
    // still correctly opens #logo_file's native dialog, which filechooser
    // intercepts. Large files (confirmed with a 41MB PDF) go through a real
    // chunked S3 multipart upload — poll for the "minimum one asset"
    // warning to disappear rather than a fixed wait.
    async uploadAsset(filePath: string, timeoutMs = 3 * 60 * 1000) {
        const chooserPromise = this.page.waitForEvent('filechooser', { timeout: 10000 });
        await this.page.locator('input.ngx-file-drop__file-input').evaluate((el: HTMLInputElement) => el.click());
        const chooser = await chooserPromise;
        await chooser.setFiles(filePath);

        const warning = this.page.getByText('A Minimum of one asset should be Uploaded', { exact: false });
        const deadline = Date.now() + timeoutMs;
        let uploaded = false;
        while (Date.now() < deadline) {
            if (!(await warning.isVisible().catch(() => false))) { uploaded = true; break; }
            await this.page.waitForTimeout(3000);
        }
        if (!uploaded) {
            throw new Error(`Asset upload did not complete within ${timeoutMs}ms`);
        }

        await this.page.getByRole('button', { name: 'Next' }).click({ timeout: 15000 });
        await this.page.waitForURL('**/jobDetails**', { timeout: 20000 });
    }

    // Confirmed live: Issue Year is a mat-select; Issue Name is a plain
    // input; File Due Date / Final Due Date / On Sale Date are READONLY
    // mat-datepicker-input fields (aria-haspopup="dialog") — typing
    // directly does nothing, each needs its calendar-icon toggle clicked
    // and a day selected from the popup. Day cells are
    // <button aria-label="November 15, 2026"> (role=button, not gridcell,
    // and not safely matchable by day-number text alone since hidden
    // animation panes can duplicate it) — click by the exact aria-label.
    async fillJobDetails(params: {
        year: number;
        issueName: string;
        fileDueDate: Date;
        dueDate: Date;
        onSaleDate: Date;
    }) {
        const { year, issueName, fileDueDate, dueDate, onSaleDate } = params;

        await this.page.locator('mat-select[formcontrolname="year"]').click({ timeout: 10000 });
        await this.page.waitForTimeout(400);
        await this.page.locator('mat-option', { hasText: String(year) }).first().click();
        await this.page.waitForTimeout(300);

        await this.page.locator('[formcontrolname="issueName"]').fill(issueName);

        await this.pickDate('fileDueDate', fileDueDate);
        await this.pickDate('dueDate', dueDate);
        await this.pickDate('onSaleDate', onSaleDate);

        await this.page.getByRole('button', { name: 'Next' }).click({ timeout: 15000 });
        await this.page.waitForLoadState('networkidle').catch(() => {});
    }

    private async pickDate(formControlName: string, target: Date) {
        const toggle = this.page.locator(`[formcontrolname="${formControlName}"]`)
            .locator('xpath=ancestor::mat-form-field')
            .locator('mat-datepicker-toggle button, .mat-datepicker-toggle');

        await toggle.first().click({ timeout: 10000 });
        await this.page.waitForTimeout(400);

        const targetYear = target.getFullYear();
        const targetMonthIdx = target.getMonth(); // 0-11
        const targetIdx = targetYear * 12 + targetMonthIdx;

        for (let i = 0; i < 24; i++) {
            const label = (await this.page.locator('.mat-calendar-period-button').textContent())?.trim() ?? '';
            const [abbr, yr] = label.split(' ');
            const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
            const curIdx = parseInt(yr, 10) * 12 + MONTH_ABBR.indexOf(abbr);
            if (curIdx === targetIdx) break;
            await this.page.locator(curIdx < targetIdx ? '.mat-calendar-next-button' : '.mat-calendar-previous-button')
                .click({ timeout: 5000 });
            await this.page.waitForTimeout(250);
        }

        const ariaLabel = `${MONTH_FULL[targetMonthIdx]} ${target.getDate()}, ${targetYear}`;
        await this.page.getByRole('button', { name: ariaLabel, exact: true }).click({ timeout: 8000 });
        await this.page.waitForTimeout(300);
    }

    // Confirmed live: Submit shows a "Thank you! We've successfully created
    // your Job." confirmation dialog.
    async submitJobSummary(): Promise<boolean> {
        await this.page.getByRole('button', { name: /submit/i }).first().click({ timeout: 15000 });
        const confirmed = await this.page.getByText('successfully created your Job', { exact: false })
            .waitFor({ state: 'visible', timeout: 20000 })
            .then(() => true)
            .catch(() => false);
        return confirmed;
    }
}
