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

    async createInventory(entries: InventoryEntry[]) {
        for (const entry of entries) {
            await this.addEntry(entry);
        }
        console.log(`✅ ${entries.length} inventory entries added`);
        await this.submit();
    }
}
