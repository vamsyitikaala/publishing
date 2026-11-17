import { Page, Locator, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Operator stage on a job's Issue Summary -> INVENTORY DRAFT table.
// Confirmed live, per spec row:
//   - "Assign" (person icon) self-assigns the spec to the logged-in user —
//     no picker; status "Get Started" -> "Operator Work In Progress" and
//     an "Upload" icon appears. This is the operator checkout.
//   - "Upload" opens a dialog: drop zone (hidden <input type=file>), an
//     optional "Enter Your Image Link" textbox + Add, and "Ready for QC",
//     disabled while nothing has been uploaded yet.
// Row action icons are labelled only by a hover tooltip span, so their
// accessible names are empty — match on the tooltip text instead.
export class InventoryOperatorPage {

    constructor(private page: Page) {}

    rows(): Locator {
        return this.page.getByRole('row').filter({ has: this.page.getByRole('cell') });
    }

    // Confirmed live: after client feedback (Draft 2) the name cell is
    // prefixed with a "New Feedback" badge (span.highlight_feedback).
    row(articleName: string): Locator {
        const escaped = articleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return this.rows().filter({
            has: this.page.locator('td:nth-child(2)', { hasText: new RegExp(`^\\s*(New Feedback\\s*)?${escaped}\\s*$`) }),
        }).first();
    }

    async articleNames(): Promise<string[]> {
        await this.page.getByRole('cell').first().waitFor({ state: 'visible', timeout: 30000 });
        return this.rows().locator('td:nth-child(2)').evaluateAll(cells => cells.map(cell => {
            const copy = cell.cloneNode(true) as HTMLElement;
            copy.querySelectorAll('.highlight_feedback').forEach(badge => badge.remove());
            return (copy.textContent ?? '').trim();
        }));
    }

    async status(row: Locator): Promise<string> {
        return ((await row.locator('.status-pill').first().textContent()) ?? '').trim();
    }

    private actionButton(row: Locator, tooltip: string): Locator {
        return row.locator('button', {
            has: this.page.locator('.viewtooltiptext', { hasText: new RegExp(`^\\s*${tooltip}\\s*$`) }),
        }).first();
    }

    // Any row action by its tooltip text (e.g. "Check Out", "View QC").
    async clickAction(row: Locator, tooltip: string) {
        await row.locator('.viewtooltip', {
            has: this.page.locator('.viewtooltiptext', { hasText: new RegExp(`^\\s*${tooltip}\\s*$`) }),
        }).first().click({ timeout: 15000 });
    }

    // "Time Log" (clock icon beside the checkout action) — confirmed live:
    //   - the icon opens a dropdown of the spec's assignees (empty until the
    //     spec has one); picking one opens the time-log dialog: Draft
    //     combobox, a "Start" timer button, manual Start/End entry and the
    //     spec's existing logs;
    //   - Start posts time-logger/save ("Timers created successfully"),
    //     closes the dialog and shows a running timer banner
    //     (fbportal-timer) with a stop icon; while it runs the row's
    //     checkout is disabled ("Please End the Time Log");
    //   - stop posts time-logger/update with total_hours and the row's Time
    //     Spent picks it up.
    // The banner only exists in the session that started the timer, so the
    // timer is always stopped here before moving on.
    // Returns 'no-assignee' when the spec has no assignee yet, and
    // 'unavailable' when the assignee list itself keeps failing — confirmed
    // live on UAT Draft 2: time-logger/get/assignee-list intermittently
    // answers HTTP 503 (no CORS header, so the dropdown just stays empty)
    // for some specs. Neither blocks the checkout; callers decide.
    async logTime(row: Locator, label: string, user: string, seconds = 12): Promise<'logged' | 'no-assignee' | 'unavailable'> {
        const assignees = row.locator('.dropdown-content-view');
        const entry = assignees.getByText(user, { exact: true });
        // Confirmed live: the list panel (.dropdown-content, with a Search
        // box) only opens once the assignee list has loaded, and then lays a
        // full-screen transparent backdrop (its first <span>) over the page
        // that swallows other clicks — click that backdrop to close it.
        const panel = row.locator('.dropdown-content');
        const closeDropdown = async () => {
            if (!await panel.isVisible()) return;
            await panel.locator('> span').first().click({ force: true });
            await expect(panel).toBeHidden({ timeout: 10000 });
        };
        let failure = '';
        for (let attempt = 1; ; attempt++) {
            const list = this.page.waitForResponse(r => /time-logger\/get\/assignee-list/.test(r.url()), { timeout: 30000 }).catch(() => null);
            await this.clickAction(row, 'Time Log');
            const response = await list;
            if (await entry.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)) break;
            await closeDropdown();
            if (response?.ok()) return 'no-assignee';
            failure = response ? `HTTP ${response.status()}` : 'no response';
            if (attempt === 3) {
                console.warn(`   ⚠️  ${label} | Time Log skipped — assignee list failed 3 times (${failure})`);
                return 'unavailable';
            }
            await this.page.waitForTimeout(5000);
        }
        await entry.click({ timeout: 15000 });

        const dialog = this.page.getByRole('dialog');
        await dialog.getByRole('button', { name: 'Start' }).waitFor({ state: 'visible', timeout: 30000 });
        await this.page.waitForLoadState('networkidle').catch(() => {});
        await this.closeDanglingTimeLog(dialog, label);
        const draft = await this.pickLatestDraft(dialog);

        const started = this.page.waitForResponse(r => /time-logger\/save/.test(r.url()), { timeout: 60000 });
        await dialog.getByRole('button', { name: 'Start' }).click({ timeout: 15000 });
        const startRes = await started;
        expect(startRes.ok(), `time-logger/save: ${await startRes.text().catch(() => '')}`).toBeTruthy();
        const stop = this.page.locator('fbportal-timer img[src*="stop"]');
        await stop.waitFor({ state: 'visible', timeout: 30000 });

        await this.page.waitForTimeout(seconds * 1000);

        const stopped = this.page.waitForResponse(r => /time-logger\/update/.test(r.url()), { timeout: 60000 });
        await stop.click({ timeout: 15000 });
        const stopRes = await stopped;
        const total = /"total_hours":"([^"]*)"/.exec(stopRes.request().postData() ?? '')?.[1];
        expect(stopRes.ok(), `time-logger/update: ${await stopRes.text().catch(() => '')}`).toBeTruthy();
        await expect(stop).toBeHidden({ timeout: 15000 });
        await expect(row).not.toContainText('Please End the Time Log', { timeout: 30000 });
        console.log(`   ${label} | Time Log: ${draft} timer ran ${total}`);
        return 'logged';
    }

    // Latest draft in the time-log dialog (Draft 2 after client feedback).
    private async pickLatestDraft(dialog: Locator): Promise<string> {
        await dialog.getByRole('combobox', { name: 'Draft' }).click({ timeout: 15000 });
        const drafts = this.page.getByRole('option');
        await drafts.first().waitFor({ state: 'visible', timeout: 15000 });
        const draft = (await drafts.last().innerText()).trim();
        await drafts.last().click();
        return draft;
    }

    // A timer started but never stopped (e.g. a run that died mid-timer)
    // stays open server-side, and the row's checkout stays disabled ("Please
    // End the Time Log"); its banner is gone with that session. Confirmed
    // live: the open log is listed in the dialog with no End Time — its edit
    // icon loads it into the form; an End Time + Draft + "Log time" closes
    // it ("Success! Your time has been logged.").
    private async closeDanglingTimeLog(dialog: Locator, label: string) {
        const open = dialog.locator('div.row.body')
            .filter({ has: this.page.locator('img[src*="logedit"]') })
            .filter({ has: this.page.locator('xpath=./div[3][normalize-space()=""]') });
        while (await open.count() > 0) {
            await open.first().locator('img[src*="logedit"]').click({ timeout: 15000 });
            const end = new Date(Date.now() + 60000);
            await dialog.getByRole('textbox', { name: 'End hour' }).fill(String(((end.getHours() + 11) % 12) + 1).padStart(2, '0'));
            await dialog.getByRole('textbox', { name: 'End minute' }).fill(String(end.getMinutes()).padStart(2, '0'));
            await dialog.getByRole('group', { name: 'End AM or PM' })
                .getByRole('button', { name: end.getHours() < 12 ? 'AM' : 'PM' }).click();
            await this.pickLatestDraft(dialog);
            const before = await open.count();
            await dialog.getByRole('button', { name: 'Log time' }).click({ timeout: 15000 });
            await expect(this.page.getByText('Your time has been logged', { exact: false }).first()).toBeVisible({ timeout: 30000 });
            await expect(open).toHaveCount(before - 1, { timeout: 30000 });
            console.warn(`   ⚠️  ${label} | Closed a time log left running by an earlier attempt`);
        }
    }

    // Operator checkout.
    async assignToMe(row: Locator, label: string) {
        const before = await this.status(row);
        await this.actionButton(row, 'Assign').click({ timeout: 15000 });
        await expect.poll(() => this.status(row), { timeout: 30000 }).toMatch(/Operator Work In Progress/i);
        console.log(`   ${label} | Checkout (Assign): "${before}" -> "${await this.status(row)}"`);
    }

    // Upload dialog -> click "Drag and Drop" -> pick the asset in the file
    // chooser popup -> "Ready for QC". From the dialog's source
    // (fbportal-upload-creative): selecting more than one file is rejected
    // with a "One File at a time" snackbar and nothing uploads; "Ready for
    // QC" enables only once the upload's body reports status 200 and the
    // follow-up GET article-files returns the file.
    //
    // Each spec uploads a uniquely named copy of the sample asset, so files
    // from different specs/jobs never collide by name.
    //
    // Confirmed live (and from the dialog's source): after a successful
    // upload the dialog immediately re-fetches GET article-files, which can
    // reach the server before the new file is registered and return [] —
    // leaving "Ready for QC" disabled. Reopening the dialog does NOT help:
    // the uploaded file's id (approve_file_id) lives only in the dialog
    // instance that uploaded it, and "Ready for QC" from a fresh dialog posts
    // the status update without it (HTTP 500). So, within the same dialog,
    // hold that post-upload GET until the server actually lists the file.
    async uploadAndReadyForQc(row: Locator, label: string, filePath: string, uniqueName: string) {
        const ext = path.extname(filePath);
        const uniquePath = path.join(os.tmpdir(), `${uniqueName}${ext}`);
        fs.copyFileSync(filePath, uniquePath);
        const before = await this.status(row);
        const dialog = this.page.getByRole('dialog');
        const readyForQc = dialog.getByRole('button', { name: 'Ready for QC' });

        const uploadStatuses: number[] = [];
        const onResponse = async (r: import('@playwright/test').Response) => {
            const url = r.url();
            if (/\/upload\/article-files/.test(url) && r.request().method() === 'POST') {
                uploadStatuses.push(r.status());
                console.log(`   ${label} | Upload HTTP ${r.status()}: ${(await r.text().catch(() => '')).slice(0, 300)}`);
            } else if (/\/update\/article-status/.test(url)) {
                console.log(`   ${label} | Status update HTTP ${r.status()}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
            }
        };
        this.page.on('response', onResponse);

        const articleFilesRoute = '**/api/production/get/*/article-files*';
        await this.page.route(articleFilesRoute, async route => {
            if (uploadStatuses.length === 0) return route.continue();
            for (let attempt = 1; attempt <= 10; attempt++) {
                // Confirmed live: route.fetch (sent from Node, not the
                // browser) intermittently hits connect ETIMEDOUT on UAT —
                // retry, and finally let the browser's own request through.
                let response: import('@playwright/test').APIResponse;
                try {
                    response = await route.fetch({ timeout: 30000 });
                } catch (e) {
                    console.log(`   ${label} | GET article-files refetch failed (try ${attempt}): ${(e as Error).message.split('\n')[0]}`);
                    if (attempt === 10) return route.continue();
                    await new Promise(r => setTimeout(r, 3000));
                    continue;
                }
                const body = (await response.text()).trim();
                if ((body && body !== '[]') || attempt === 10) {
                    console.log(`   ${label} | GET article-files after upload (try ${attempt}) -> ${body.slice(0, 120)}`);
                    return route.fulfill({ response, body });
                }
                await new Promise(r => setTimeout(r, 3000));
            }
        });

        try {
            await this.actionButton(row, 'Upload').click({ timeout: 15000 });
            await dialog.waitFor({ state: 'visible', timeout: 15000 });
            await this.page.waitForLoadState('networkidle').catch(() => {});

            // The "Drag and Drop" content element inside ngx-file-drop
            // (absolute XPath .../fbportal-upload-creative/div/div[2]/div[2]/
            // ngx-file-drop/div/div/div), scoped to this dialog.
            const dragAndDrop = dialog.locator('xpath=.//fbportal-upload-creative//ngx-file-drop/div/div/div').first();
            const chooserPromise = this.page.waitForEvent('filechooser', { timeout: 15000 });
            await dragAndDrop.click();
            const chooser = await chooserPromise;
            await chooser.setFiles([uniquePath]);
            console.log(`   ${label} | Asset added via Drag and Drop: ${path.basename(uniquePath)}`);

            await expect.poll(() => uploadStatuses.length, {
                message: `${label}: adding the asset should start an upload`,
                timeout: 120000,
            }).toBeGreaterThanOrEqual(1);
            expect(uploadStatuses[0], `${label}: upload of ${path.basename(uniquePath)}`).toBeLessThan(400);

            await expect(readyForQc, `${label}: "Ready for QC" should enable once the uploaded file is listed`)
                .toBeEnabled({ timeout: 60000 });
            await readyForQc.click();
            await expect(dialog).toBeHidden({ timeout: 60000 });
        } finally {
            this.page.off('response', onResponse);
            await this.page.unroute(articleFilesRoute);
            fs.rmSync(uniquePath, { force: true });
        }

        await expect.poll(() => this.status(row), { timeout: 60000 }).toMatch(/ready for qc/i);
        console.log(`   ${label} | Ready for QC: "${before}" -> "${await this.status(row)}"`);
    }
}
