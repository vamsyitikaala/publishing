import { Page } from '@playwright/test';

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
        await this.page.waitForURL('**/viewBrief**', { timeout: 20000 });
        await this.page.waitForLoadState('networkidle').catch(() => {});

        // Confirmed live headings: "ISSUE SUMMARY - <issue name>" and
        // "MAGAZINE - <magazine name>".
        const issueSummaryText = (await this.page.getByText(/ISSUE SUMMARY -/, { exact: false }).first().textContent()) ?? '';
        const magazineText = (await this.page.getByText(/MAGAZINE -/, { exact: false }).first().textContent()) ?? '';

        return {
            issueName: issueSummaryText.replace(/.*ISSUE SUMMARY\s*-\s*/i, '').trim(),
            magazineName: magazineText.replace(/.*MAGAZINE\s*-\s*/i, '').trim(),
        };
    }
}
