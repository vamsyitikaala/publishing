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

    row(articleName: string): Locator {
        return this.rows().filter({
            has: this.page.getByRole('cell', { name: articleName, exact: true }),
        }).first();
    }

    async articleNames(): Promise<string[]> {
        await this.page.getByRole('cell').first().waitFor({ state: 'visible', timeout: 30000 });
        return (await this.rows().locator('td:nth-child(2)').allTextContents()).map(t => t.trim());
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
                const response = await route.fetch();
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
