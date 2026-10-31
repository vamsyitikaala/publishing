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
    async viewFirstJob(): Promise<{ issueName: string; magazineName: string }> {
        const viewIcons = this.page.locator('img[alt="View Job"]');
        await viewIcons.first().scrollIntoViewIfNeeded();
        await viewIcons.first().click({ timeout: 15000 });

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

        return {
            issueName: issueSummaryText.replace(/.*ISSUE SUMMARY\s*-\s*/i, '').trim(),
            magazineName: magazineText.replace(/.*MAGAZINE\s*[-–]\s*/i, '').trim(),
        };
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
        await toProof.click({ timeout: 15000 });
        const confirm = this.page.getByRole('dialog').getByRole('button', { name: /^(yes|confirm|ok|proceed)$/i }).first();
        if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) {
            await confirm.click({ timeout: 15000 });
        }
        await this.page.waitForLoadState('networkidle').catch(() => {});
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
    async chooseAutomaticInventory(): Promise<string> {
        const item = this.automaticItem();
        const html = await item.evaluate(el => el.outerHTML);
        await item.getByText('Click to Start', { exact: false }).click({ timeout: 15000 });
        await this.page.waitForLoadState('networkidle').catch(() => {});
        return html;
    }

    // Status note under "Automatic": "Click to Start", "* In Progress" or
    // "* Completed".
    async automaticStatus(): Promise<string> {
        const text = (await this.automaticItem().textContent()) ?? '';
        return text.replace(/^\s*Automatic/, '').replace(/[*\s]+/g, ' ').trim();
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
