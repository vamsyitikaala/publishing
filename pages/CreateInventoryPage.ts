import { Page, Locator, expect } from '@playwright/test';

export type InventorySection = 'Cover page Count' | 'TOC' | 'Ads' | 'Articles' | 'Web Content';

export interface InventoryEntry {
    section: InventorySection;
    articleName: string;
    pageCount: number;
    pageRange: string; // e.g. "3-4"
}

// Backend "Inventory Log" form (/dashboard/createinventory), reached via
// Issue Summary -> Create Inventory -> Manual. Confirmed live: one row per
// section, each with a read-only Article Count (incremented by Add), an
// Article Name textbox, a Page Count spinbutton, a Page Range textbox
// (placeholder "0-0") and an Add button that stays disabled until the row
// is filled. A final Submit at the bottom saves the inventory.
export class CreateInventoryPage {

    constructor(private page: Page) {}

    private sectionRow(section: InventorySection): Locator {
        return this.page.getByText(section, { exact: true })
            .locator('xpath=ancestor::*[.//button[normalize-space()="Add"]][1]');
    }

    async addEntry(entry: InventoryEntry) {
        const row = this.sectionRow(entry.section);
        const articleCount = row.getByRole('spinbutton').first();
        const before = Number(await articleCount.inputValue()) || 0;

        await row.getByRole('textbox').first().fill(entry.articleName);
        await row.getByRole('spinbutton').nth(1).fill(String(entry.pageCount));
        await row.getByPlaceholder('0-0').fill(entry.pageRange);

        const add = row.getByRole('button', { name: 'Add' });
        await expect(add).toBeEnabled({ timeout: 10000 });
        await add.click();

        await expect(articleCount).toHaveValue(String(before + 1), { timeout: 10000 });
        console.log(`   ${entry.section} | "${entry.articleName}" | ${entry.pageCount} page(s) | ${entry.pageRange}`);
    }

    async submit() {
        const submit = this.page.getByRole('button', { name: 'Submit' }).last();
        await submit.scrollIntoViewIfNeeded();
        await expect(submit).toBeEnabled({ timeout: 10000 });
        await submit.click();
        // The button turns into "Loading..." while the inventory saves.
        await expect(this.page.getByText('Loading...', { exact: false })).toHaveCount(0, { timeout: 60000 });
        await this.page.waitForLoadState('networkidle').catch(() => {});
    }

    // Automatic variant of the same /dashboard/createinventory page: once the
    // conversion is "Completed" the form opens pre-filled with one card per
    // detected article (Page Range / Page Count / Article Name / Content
    // Type, an "x" to drop the card) — 41 cards for the test PDF. Confirmed
    // live: "x" removes a card immediately, no confirm, and nothing is saved
    // until Submit — but a trimmed submit never becomes an inventory, so
    // `keep` (drop all cards after the first `keep`) is for investigation only.
    async submitAutomaticInventory(keep: number): Promise<{ articleName: string; pageCount: string; pageRange: string }[]> {
        const names = this.page.getByRole('textbox', { name: 'Article Name' });
        await names.first().waitFor({ state: 'visible', timeout: 60000 });
        await this.page.waitForLoadState('networkidle').catch(() => {});
        const card = (i: number) => names.nth(i).locator('xpath=ancestor::*[.//p[normalize-space()="x"]][1]');

        const total = await names.count();
        console.log(`   Automatic inventory: ${total} card(s) generated` + (keep < total ? `, keeping the first ${keep}` : ''));
        for (let n = total; n > keep; n--) {
            await card(n - 1).getByText('x', { exact: true }).click();
            await expect(names).toHaveCount(n - 1, { timeout: 10000 });
        }

        const kept: { articleName: string; pageCount: string; pageRange: string }[] = [];
        for (let i = 0; i < await names.count(); i++) {
            const entry = {
                articleName: (await names.nth(i).inputValue()).trim(),
                pageCount: await card(i).getByRole('spinbutton').first().inputValue(),
                pageRange: await card(i).getByRole('textbox').first().inputValue(),
            };
            const type = (await card(i).getByRole('combobox').first().textContent())?.trim();
            console.log(`   ${type} | "${entry.articleName}" | ${entry.pageCount} page(s) | ${entry.pageRange}`);
            kept.push(entry);
        }
        // Confirmed live: Submit here posts the cards to
        // save/inventory_autocreation (creation_status "inv_created").
        const saved = this.page.waitForResponse(r => /save\/inventory_autocreation/.test(r.url()), { timeout: 60000 });
        await this.submit();
        const response = await saved;
        console.log(`   inventory_autocreation -> HTTP ${response.status()}: ${(await response.text().catch(() => '')).slice(0, 200)}`);
        expect(response.ok(), `inventory_autocreation returned HTTP ${response.status()}`).toBeTruthy();
        return kept;
    }

    async createInventory(entries: InventoryEntry[]) {
        for (const entry of entries) {
            await this.addEntry(entry);
        }
        console.log(`✅ ${entries.length} inventory entries added`);
        await this.submit();
    }
}
