import { Page, Locator, expect } from '@playwright/test';

export interface ErrorCounts { text: number; style: number; image: number; other: number; }

// QC review window (/dashboard/qcHtmlView), opened from a spec row's
// "Check Out" (Ready for QC) or "View QC" (QC Work In Progress) action.
// Confirmed live:
//   - header: Reject / Approve
//   - "Number of Errors": Text / Style / image / other spinbuttons + Add
//     (reads "Edit" once counts have been saved)
//   - comment box "Write your Comment" at the bottom of the right panel
//     (scroll down to it) + a Send arrow that saves the comment
export class QcReviewPage {

    constructor(private page: Page) {}

    // Same review screen serves QC and QA.
    static readonly VIEW_URL = /\/(qc|qa)HtmlView/i;

    // QC: the header shows the spec name once the spec's data (artData) has
    // loaded. From the view's source, saving error counts reads artData —
    // acting before it loads greys out Add and sends nothing — so for QC
    // wait for the name (reloading once). The QA view's header stays blank
    // even when loaded, so QA only warns.
    async verifyLoaded(specName: string, requireName = true) {
        await this.page.waitForURL(QcReviewPage.VIEW_URL, { timeout: 30000 });
        await expect(this.page.getByRole('heading', { name: 'Number of Errors' })).toBeVisible({ timeout: 30000 });
        const name = this.page.getByText(specName, { exact: true }).first();
        if (await name.isVisible({ timeout: 30000 }).catch(() => false)) return;
        if (!requireName) {
            console.warn(`   ⚠️  Review view header does not show the spec name "${specName}"`);
            return;
        }
        console.warn(`   ⚠️  Spec data not loaded in the review view (no "${specName}" in header) — reloading`);
        await this.page.reload();
        await expect(name, `review view should load spec "${specName}"`).toBeVisible({ timeout: 60000 });
    }

    // Spinbuttons in on-screen order: Text, Style, image, other. Confirmed
    // live: once saved they lock read-only and the button reads "Edit" —
    // click Edit to unlock before refilling.
    // Confirmed live (QA view only): the first "Add" on a fresh panel saved
    // all zeros despite the filled values; Edit -> refill -> save then stores
    // them. So verify what the panel shows after saving and retry via Edit.
    async addErrorCounts(counts: ErrorCounts) {
        const inputs = this.page.getByRole('spinbutton');
        await expect(inputs).toHaveCount(4, { timeout: 15000 });
        const edit = this.page.getByRole('button', { name: 'Edit', exact: true });
        const values = [counts.text, counts.style, counts.image, counts.other].map(String);

        for (let attempt = 1; attempt <= 2; attempt++) {
            if (await edit.isVisible()) {
                await edit.click({ timeout: 15000 });
                await expect(inputs.first()).toBeEditable({ timeout: 15000 });
            }
            for (let i = 0; i < 4; i++) {
                await inputs.nth(i).fill(values[i], { timeout: 15000 });
            }
            // From the view's source: "Add" posts /save/article-files/error-count,
            // "Update" (what Edit turns into) posts /update/...; the button
            // stays greyed out until the response — wait on the request itself.
            const saveResponse = this.page.waitForResponse(
                r => /\/(save|update)\/article-files\/error-count/.test(r.url()), { timeout: 90000 });
            await this.page.getByRole('button', { name: /^(Add|Save|Update)$/ }).click({ timeout: 15000 });
            const saveRes = await saveResponse;
            console.log(`   Error counts save -> HTTP ${saveRes.status()}: ${(await saveRes.text().catch(() => '')).slice(0, 150)}`);
            expect(saveRes.status(), 'error-count save').toBeLessThan(400);
            await expect(edit).toBeVisible({ timeout: 30000 });

            // The panel re-fetches the saved counts after the update.
            const saved = await expect.poll(
                () => Promise.all([0, 1, 2, 3].map(i => inputs.nth(i).inputValue())),
                { timeout: 15000 }
            ).toEqual(values).then(() => true).catch(() => false);
            if (saved) return;

            const shown = await Promise.all([0, 1, 2, 3].map(i => inputs.nth(i).inputValue()));
            console.warn(`   ⚠️  Error counts saved as ${shown.join('/')} instead of ${values.join('/')} (attempt ${attempt})${attempt < 2 ? ' — re-entering via Edit' : ''}`);
        }
        throw new Error(`Error counts did not save as ${values.join('/')}`);
    }

    private commentBox(): Locator {
        return this.page.getByPlaceholder('Write your Comment');
    }

    // Confirmed live: the Send <button> itself has no box (Playwright reports
    // it "not visible"); the clickable thing is its arrow image.
    // Confirmed live (Draft 2, UAT): the comment POST answers 200 "Comments
    // posted Successfully", but the list GET for file_version "V 2.1"
    // returns [] — so a saved comment may never be listed. Asserts the save
    // and returns whether the comment is shown.
    async addComment(text: string): Promise<boolean> {
        const box = this.commentBox();
        await box.scrollIntoViewIfNeeded({ timeout: 15000 });
        await box.click({ timeout: 15000 });
        await box.fill(text, { timeout: 15000 });
        const posted = this.page.waitForResponse(
            r => /\/post\/q[ca]_article_files_comments/.test(r.url()), { timeout: 60000 });
        await this.page.getByRole('img', { name: 'Send' }).click({ timeout: 15000 });
        const response = await posted;
        const body = await response.text().catch(() => '');
        expect(response.ok() && !/"status":\s*[45]\d\d/.test(body), `comment save: HTTP ${response.status()} ${body}`).toBeTruthy();
        const shown = await this.page.getByText(text, { exact: false }).first()
            .waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
        if (!shown) console.warn(`   ⚠️  Comment saved (${body.slice(0, 100)}) but not listed — the comments GET returns [] for this file version`);
        return shown;
    }

    private comment(text: string): Locator {
        return this.page.locator('.badge_comment').filter({ hasText: text }).first();
    }

    // Confirmed live: each saved comment (.badge_comment) carries a
    // "more_horiz" mat-menu trigger holding its actions.
    async deleteComment(text: string) {
        const comment = this.comment(text);
        await comment.scrollIntoViewIfNeeded({ timeout: 15000 });
        await comment.locator('button.mat-mdc-menu-trigger').click({ timeout: 15000 });
        await this.page.getByRole('menuitem', { name: /delete/i }).click({ timeout: 15000 });
        await this.confirmIfAsked();
        await expect(comment).toHaveCount(0, { timeout: 30000 });
    }

    // Confirmed live: in QC, "Approve" (top right) is a dropdown — clicking
    // it only reveals "Ready For QA" / "Ready For Bundling", and choosing one
    // submits. In QA, Approve submits directly (straight to Ready for
    // bundling) and returns to the job page — no menu. Returns the options
    // offered (empty when Approve submitted directly).
    async approve(option: 'Ready For QA' | 'Ready For Bundling'): Promise<string[]> {
        const approve = this.page.getByRole('button', { name: 'Approve' });
        await approve.scrollIntoViewIfNeeded({ timeout: 15000 });
        await approve.click({ timeout: 15000 });

        const choice = approve.getByText(option, { exact: true });
        const outcome = await Promise.race([
            choice.waitFor({ state: 'visible', timeout: 10000 }).then(() => 'menu' as const),
            this.page.waitForURL(url => !QcReviewPage.VIEW_URL.test(url.href), { timeout: 10000 }).then(() => 'submitted' as const),
        ]).catch(() => 'none' as const);
        if (outcome === 'submitted') return [];
        expect(outcome, `Approve should show "${option}" or submit`).toBe('menu');

        const offered = (await approve.locator('.dropdown-content').allInnerTexts())
            .flatMap(t => t.split('\n')).map(t => t.trim()).filter(Boolean);
        await choice.click({ timeout: 15000 });
        await this.confirmIfAsked();
        await this.page.waitForLoadState('networkidle').catch(() => {});
        return offered;
    }

    // A confirmation dialog may follow delete/approve; accept it if shown.
    private async confirmIfAsked() {
        const confirm = this.page.getByRole('dialog').getByRole('button', { name: /^(yes|confirm|ok|delete|approve)$/i }).first();
        if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) {
            await confirm.click({ timeout: 15000 });
        }
    }
}
