import { Page, expect } from '@playwright/test';

// Job Dashboard (lands here right after backend login) -> View -> Issue
// Summary (/dashboard/viewBrief). Confirmed live: the dashboard lists jobs
// newest-first — the first row's View action is always the most recently
// created job, whichever client created it.
export class ProductionJobPage {

    constructor(private page: Page) {}

    // Confirmed live: clicking the icon without first scrolling it into
    // view intermittently fails to navigate at all (click registers but no
    // navigation follows) — scroll explicitly before clicking.
    // JOB_ISSUE=<issue name> targets that job instead of the newest one, so
    // two jobs can be in flight at once (manual + automatic inventory).
    async viewFirstJob(issueName = process.env.JOB_ISSUE): Promise<{ issueName: string; magazineName: string }> {
        await this.clearJobSearch();
        await this.page.waitForLoadState('networkidle').catch(() => {});
        // Confirmed live: the table can re-render right after it first shows
        // (job list refresh), detaching the row just found — look it up again.
        const viewIcons = this.page.locator('img[alt="View Job"]');
        for (let attempt = 1; ; attempt++) {
            try {
                const viewIcon = issueName ? viewIcons.nth(await this.jobRowIndex(issueName)) : viewIcons.first();
                await viewIcon.scrollIntoViewIfNeeded({ timeout: 10000 });
                await viewIcon.click({ timeout: 15000 });
                break;
            } catch (e) {
                if (attempt >= 3) throw e;
                console.log(`   View Job attempt ${attempt} failed (${(e as Error).message.split('\n')[0]}) — retrying`);
                await this.page.waitForTimeout(2000);
            }
        }

        // Confirmed live: a job without inventory opens /dashboard/viewBrief;
        // once it has inventory, View opens a different Issue Summary layout
        // (different URL, "INVENTORY DRAFT" table) — so wait on the heading,
        // not the URL. The magazine heading uses "-" on one layout and "–"
        // on the other.
        const issueHeading = this.page.getByText(/ISSUE SUMMARY\s*-/).first();
        await issueHeading.waitFor({ state: 'visible', timeout: 30000 });
        await this.page.waitForLoadState('networkidle').catch(() => {});

        const issueSummaryText = (await issueHeading.textContent()) ?? '';
        const magazineText = (await this.page.getByText(/MAGAZINE\s*[-–]/).first().textContent()) ?? '';

        const job = {
            issueName: issueSummaryText.replace(/.*ISSUE SUMMARY\s*-\s*/i, '').trim(),
            magazineName: magazineText.replace(/.*MAGAZINE\s*[-–]\s*/i, '').trim(),
        };
        if (issueName) expect(job.issueName, 'opened the wrong job').toBe(issueName);
        return job;
    }

    // Confirmed live: the dashboard truncates issue names
    // ("Automation_Issue_179..."), and its Search box doesn't narrow the
    // list (the API ignores the term) — but each issue cell's tooltip
    // registers the full name in a hidden aria-describedby message.
    // Searches the first page (newest 20 jobs).
    private async jobRowIndex(issueName: string): Promise<number> {
        const cells = this.page.locator('td.mat-column-issue_name span.short-title');
        await cells.first().waitFor({ state: 'visible', timeout: 30000 });
        const count = await cells.count();
        for (let i = 0; i < count; i++) {
            const id = await cells.nth(i).getAttribute('aria-describedby');
            const name = id ? await this.page.locator(`[id="${id}"]`).textContent() : await cells.nth(i).textContent();
            if (name?.trim() === issueName) return i;
        }
        throw new Error(`Job "${issueName}" is not among the newest ${count} jobs on the Job Dashboard`);
    }

    // Confirmed live: a search term is kept (per user, across sessions) as
    // a "<term> x" chip beside the box, and the box stays disabled until the
    // chip is clicked away — left in place it would also hide the newest job.
    private async clearJobSearch() {
        await this.page.locator('img[alt="View Job"]').first().waitFor({ state: 'visible', timeout: 30000 });
        const search = this.page.getByRole('textbox', { name: 'Search' });
        const chipClose = this.page.locator('.search_key .close_key');
        while (await chipClose.count() > 0) {
            await chipClose.first().click({ timeout: 15000 });
        }
        await expect(search).toBeEnabled({ timeout: 15000 });
        await this.page.locator('img[alt="View Job"]').first().waitFor({ state: 'visible', timeout: 30000 });
    }

    async goToJobDashboard() {
        await this.page.getByText('Home', { exact: true }).first().click({ timeout: 15000 });
        await this.page.locator('img[alt="View Job"]').first().waitFor({ state: 'visible', timeout: 30000 });
    }

    // Confirmed live: once every spec is "Ready for bundling", a bar appears
    // under the inventory table — "Please enter the Bundled Link" + a text
    // box + "To Proof" (disabled until a link is entered).
    async submitBundledLinkToProof(link: string) {
        const bar = this.page.getByText('Please enter the Bundled Link', { exact: false }).first()
            .locator('xpath=ancestor::*[.//button[normalize-space()="To Proof"]][1]');
        await bar.scrollIntoViewIfNeeded({ timeout: 15000 });
        await bar.getByRole('textbox').fill(link, { timeout: 15000 });
        const toProof = bar.getByRole('button', { name: 'To Proof' });
        await expect(toProof).toBeEnabled({ timeout: 15000 });
        // The status change happens in POST .../client-to-proof, which can
        // take a while on UAT — wait for it explicitly, otherwise a reload
        // right after aborts it mid-flight and nothing moves to Proofing.
        const toProofResponse = this.page.waitForResponse(
            r => r.request().method() === 'POST' && /\/client-to-proof/.test(r.url()),
            { timeout: 180000 },
        );
        await toProof.click({ timeout: 15000 });
        const confirm = this.page.getByRole('dialog').getByRole('button', { name: /^(yes|confirm|ok|proceed)$/i }).first();
        if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) {
            await confirm.click({ timeout: 15000 });
        }
        const response = await toProofResponse;
        console.log(`   client-to-proof -> HTTP ${response.status()}: ${(await response.text().catch(() => '')).slice(0, 200)}`);
        expect(response.ok(), `client-to-proof returned HTTP ${response.status()}`).toBeTruthy();
    }

    // Issue Summary with inventory: "INVENTORY DRAFT <n>" heading over a
    // table of Content / Article Name / Page Count / Page Range / ... /
    // Status rows.
    async hasInventoryDraft(): Promise<boolean> {
        return this.page.getByText(/^\s*INVENTORY DRAFT/).first().isVisible();
    }

    async inventoryRows(): Promise<string[]> {
        await this.page.getByText(/^\s*INVENTORY DRAFT/).first().waitFor({ state: 'visible', timeout: 30000 });
        // Rows load after the heading renders.
        await this.page.getByRole('cell').first().waitFor({ state: 'visible', timeout: 30000 });
        const rows = this.page.getByRole('row').filter({ has: this.page.getByRole('cell') });
        return (await rows.allTextContents()).map(t => t.replace(/\s+/g, ' ').trim());
    }

    async verifyInventoryListed(entries: { articleName: string; pageCount: number; pageRange: string }[]) {
        await this.page.getByText(/^\s*INVENTORY DRAFT/).first().waitFor({ state: 'visible', timeout: 30000 });
        for (const entry of entries) {
            const row = this.page.getByRole('row').filter({
                has: this.page.getByRole('cell', { name: entry.articleName, exact: true }),
            }).first();
            await expect(row).toBeVisible({ timeout: 15000 });
            await expect(row.getByRole('cell', { name: String(entry.pageCount), exact: true })).toBeVisible();
            await expect(row.getByRole('cell', { name: entry.pageRange, exact: true })).toBeVisible();
            console.log(`   ✅ Listed: ${entry.articleName} | ${entry.pageCount} | ${entry.pageRange}`);
        }
    }

    // Automatic inventory names come from OCR and its page-range format
    // isn't confirmed on the listing yet — check the article names only.
    async verifyArticlesListed(articleNames: string[]) {
        await this.page.getByText(/^\s*INVENTORY DRAFT/).first().waitFor({ state: 'visible', timeout: 30000 });
        for (const name of articleNames) {
            await expect(this.page.getByRole('row').filter({
                has: this.page.getByRole('cell', { name, exact: true }),
            }).first()).toBeVisible({ timeout: 15000 });
            console.log(`   ✅ Listed: ${name}`);
        }
    }

    // Issue Summary -> INVENTORY card -> "+ Create Inventory" opens a small
    // list of two listitems: "Automatic" (with a status note underneath —
    // "Click to Start" on a fresh job, "* Completed" once run) and "Manual".
    // Returns the menu's visible text so callers can log that status.
    private automaticItem() {
        return this.page.getByRole('listitem').filter({ hasText: /^\s*Automatic/ }).first();
    }

    async openCreateInventoryMenu(): Promise<string> {
        const button = this.page.getByRole('button', { name: /Create Inventory/i }).first();
        await button.scrollIntoViewIfNeeded();
        await button.click({ timeout: 15000 });

        await this.automaticItem().waitFor({ state: 'visible', timeout: 15000 });

        const menu = this.page.getByRole('list').filter({ has: this.automaticItem() }).first();
        return ((await menu.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    }

    // Confirmed live: clicking the "Automatic" listitem itself only closes
    // the menu (no request fires, "No Inventory" stays) — the start action
    // sits on the inner "Click to Start" element.
    // The start is a POST to the AI service (uat-ai.vmgpremedia.com) — a
    // reload right after the click aborts it and nothing starts, so wait for
    // its response (the conversion itself carries on server-side after).
    async chooseAutomaticInventory(): Promise<string> {
        const item = this.automaticItem();
        const html = await item.evaluate(el => el.outerHTML);
        const isStart = (r: { url(): string; method(): string }) => r.method() === 'POST' && /ai\.vmgpremedia\.com/.test(r.url());
        const sent = this.page.waitForRequest(isStart, { timeout: 15000 });
        // Confirmed live: UAT sometimes drops this request (no response,
        // conversion never starts) — report the failure so callers retry.
        const outcome = Promise.race([
            this.page.waitForResponse(isStart, { timeout: 60000 })
                .then(async r => `HTTP ${r.status()}: ${(await r.text().catch(() => '')).slice(0, 200)}`),
            this.page.waitForEvent('requestfailed', { predicate: isStart, timeout: 60000 })
                .then(r => `request failed: ${r.failure()?.errorText}`),
        ]).catch(e => `no response (${(e as Error).message.split('\n')[0]})`);
        await item.getByText('Click to Start', { exact: false }).click({ timeout: 15000 });
        await sent;
        console.log(`   Automatic start -> ${await outcome}`);
        return html;
    }

    // Start Automatic and confirm it left "Click to Start" (reload + reopen
    // the menu) — UAT sometimes drops the start request, so retry. Returns
    // the status afterwards ("In Progress" / "Completed").
    async startAutomaticInventory(attempts = 3): Promise<string> {
        let status = await this.automaticStatus();
        for (let attempt = 1; attempt <= attempts && /click to start/i.test(status); attempt++) {
            await this.chooseAutomaticInventory();
            await this.page.reload();
            await this.openCreateInventoryMenu();
            status = await this.automaticStatus();
            console.log(`   Automatic status after start (attempt ${attempt}): ${status}`);
        }
        expect(status, 'Automatic should have left "Click to Start"').not.toMatch(/click to start/i);
        return status;
    }

    // Status note under "Automatic": "Click to Start", "* In Progress" or
    // "* Completed".
    async automaticStatus(): Promise<string> {
        const text = (await this.automaticItem().textContent()) ?? '';
        return text.replace(/^\s*Automatic/, '').replace(/[*\s]+/g, ' ').trim();
    }

    // Confirmed live: after "Click to Start" the note reads "* In Progress"
    // for ~4-7 min, then "* Completed" — which means the conversion is ready
    // for inventory creation. It only updates on reload, so poll.
    async waitForAutomaticCompleted(timeoutMs = 15 * 60 * 1000): Promise<string> {
        const deadline = Date.now() + timeoutMs;
        let status = await this.automaticStatus();
        while (!/completed/i.test(status)) {
            if (Date.now() > deadline) throw new Error(`Automatic inventory still "${status}" after ${timeoutMs / 60000} min`);
            await this.page.waitForTimeout(30000);
            await this.page.reload();
            await this.reloadIssueSummary();
            await this.openCreateInventoryMenu();
            status = await this.automaticStatus();
            console.log(`   Automatic status: ${status}`);
        }
        return status;
    }

    private async reloadIssueSummary() {
        await this.page.reload();
        await this.page.getByText(/ISSUE SUMMARY\s*-/).first().waitFor({ state: 'visible', timeout: 30000 });
        await this.page.waitForLoadState('networkidle').catch(() => {});
    }

    // Confirmed live: clicking "* Completed" under Automatic opens
    // /dashboard/createinventory pre-filled with the converted articles —
    // but a click before the Issue Summary has finished loading is ignored,
    // so retry once on a settled page. The form then fetches the job's
    // details (GET .../get/<id>/job); a Submit before that lands throws in
    // the app ("reading 'inventory_creation_type'") and hangs on Loading.
    async openCompletedAutomaticInventory() {
        for (let attempt = 1; ; attempt++) {
            const jobDetails = this.page.waitForResponse(r => /\/api\/production\/get\/\d+\/job\?/.test(r.url()), { timeout: 30000 });
            await this.automaticItem().getByText(/Completed/).click({ timeout: 15000 });
            const opened = await this.page.waitForURL(/createinventory/, { timeout: 15000 }).then(() => true, () => false);
            if (opened) {
                await jobDetails;
                return;
            }
            jobDetails.catch(() => {});
            if (attempt === 2) throw new Error('Clicking Automatic "Completed" did not open the inventory form');
            console.log('   Automatic "Completed" click ignored — reloading and retrying');
            await this.reloadIssueSummary();
            await this.openCreateInventoryMenu();
        }
    }

    // Manual opens the "Inventory Log" form (sections Cover page Count /
    // TOC / Ads / Articles / Web Content).
    // Returns the page the form ended up on (same tab or a new one).
    async chooseManualInventory(): Promise<Page> {
        const url = this.page.url();
        const popupPromise = this.page.context().waitForEvent('page', { timeout: 20000 }).catch(() => null);
        await this.page.getByRole('listitem').filter({ hasText: /^\s*Manual\s*$/ }).first().click({ timeout: 15000 });

        const target = await Promise.race([
            popupPromise,
            this.page.waitForURL(u => u.href !== url, { timeout: 20000 }).then(() => this.page).catch(() => null),
        ]) ?? await popupPromise ?? this.page;

        await target.waitForLoadState('networkidle').catch(() => {});
        await target.getByText('Inventory Log').first().waitFor({ state: 'visible', timeout: 30000 });
        return target;
    }
}
