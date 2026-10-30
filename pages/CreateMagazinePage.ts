import { Page, expect } from '@playwright/test';
import * as path from 'path';

// "+Create Magazine" -> "Where will your content be used?" (/shareMedia) ->
// "Magazine Details" (/magazineDetail). Confirmed live: each destination
// card's clickable text is exact ("Apple News", "Apple News +", "PWA") —
// a plain substring match on "Apple News" also matches "Apple News +", so
// selection must use an exact-text lookup.
export class CreateMagazinePage {

    constructor(private page: Page) {}

    async selectContentDestination(destination: 'Apple News' | 'Apple News +' | 'PWA') {
        await this.page.waitForURL('**/shareMedia**', { timeout: 30000 });

        await this.page.getByText(destination, { exact: true }).click({ timeout: 15000 });

        await this.page.getByRole('button', { name: 'Next' }).click({ timeout: 15000 });

        await this.page.waitForURL('**/magazineDetail**', { timeout: 30000 });
        await this.page.waitForLoadState('networkidle');
    }

    // Magazine Details form (/magazineDetail). Confirmed live: Cover and
    // Logo are each a hidden <input type="file">, visually triggered by a
    // clickable "clip/pin" icon (<img alt="Upload Icon" src="*/arrow_pin.svg">
    // — two on the page, Cover first then Logo). Both file inputs' ids are
    // duplicated onto their adjacent readonly text-display input
    // ("fileInput"/"logoInput" each appear twice), so id selectors are
    // ambiguous — positional lookup is used instead.
    //
    // Confirmed live via network trace: calling setInputFiles() directly on
    // the hidden <input> was unreliable for Logo — intermittently never
    // triggered the real backend chain at all (file-field-path /
    // s3fs_cors_key / S3 PUT / file-check), producing "Technical Error
    // Uploading the Logo. Code S3." even with a correctly-sized file.
    // Clicking the actual pin icon and feeding the file through a real
    // filechooser event (page.waitForEvent('filechooser') + setFiles) —
    // i.e. driving the same code path a real user's click does — fixed
    // this: reproduced clean file-field-path(200) -> s3fs_cors_key(200) ->
    // S3 PUT(200) -> file-check(200) with zero errors. Use the real click
    // path for both fields, not setInputFiles() on the hidden input.
    async fillMagazineDetails(params: {
        magazineName: string;
        coverPath: string;
        logoPath: string;
        candance: 'daily' | 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
        description: string;
        websiteUrl: string;
        ftp?: string;
    }) {
        const { magazineName, coverPath, logoPath, candance, description, websiteUrl, ftp } = params;

        await this.page.locator('[formcontrolname="magazineName"]').fill(magazineName);

        const pinIcons = this.page.locator('img[alt="Upload Icon"][src*="arrow_pin"]');
        const displayInputs = this.page.locator('input[type="text"][readonly]');

        const coverChooserPromise = this.page.waitForEvent('filechooser');
        await pinIcons.nth(0).click();
        const coverChooser = await coverChooserPromise;
        await coverChooser.setFiles(coverPath);
        await expect(displayInputs.nth(0)).toHaveValue(path.basename(coverPath), { timeout: 15000 });

        // Clicking the pin + real filechooser (above) fixed most failures,
        // but the S3 PUT / file-check chain is still intermittently flaky
        // server-side on UAT. Confirmed live: simply re-clicking the pin
        // icon after a failed attempt does NOT recover — the field is left
        // in a stuck state and the retry gets zero network activity at all
        // (no file-field-path call even fires). The actual fix: each file
        // row has a "3 dots" icon (<img src="*/3dots_del.svg">) that opens
        // a confirm modal ("Are you sure you want to delete?" / button
        // #assetDelete) — deleting the stuck file first, THEN re-clicking
        // the pin icon to re-select the same file, reliably clears it.
        // Reproduced live: attempt 1 fails with the S3 error, delete ->
        // re-upload succeeds cleanly (file-field-path/s3fs_cors_key/S3
        // PUT/file-check all 200, no error). This mirrors what manually
        // works in the real UI.
        const dotIcons = this.page.locator('img[alt="Upload Icon"][src*="3dots_del"]');
        const s3Error = this.page.getByText('Technical Error Uploading the Logo', { exact: false });
        // Confirmed live: a brand-new signup account can need more than the
        // 2 attempts an established account typically resolves within
        // (likely backend-side account/S3 provisioning lag right after
        // signup) — extra headroom here is cheap (~12s/dead attempt) and
        // only spent when actually needed.
        const maxAttempts = 5;
        let logoUploaded = false;
        for (let attempt = 1; attempt <= maxAttempts && !logoUploaded; attempt++) {
            try {
                // Confirmed live: a dead attempt (the one the delete/retry
                // recovers from) never fires a single network request, so
                // waiting the full 30s for file-check on it is pure wasted
                // time — a real upload's chain (file-field-path ->
                // s3fs_cors_key -> S3 PUT -> file-check) completes in a few
                // seconds once engaged. 12s is generous headroom for a real
                // completion while cutting a dead attempt's wait by 2.5x.
                const logoFileCheck = this.page.waitForResponse(
                    resp => /\/api\/get\/file-check\?/.test(resp.url()),
                    { timeout: 12000 }
                );
                const logoChooserPromise = this.page.waitForEvent('filechooser');
                await pinIcons.nth(1).click();
                const logoChooser = await logoChooserPromise;
                await logoChooser.setFiles(logoPath);
                await expect(displayInputs.nth(1)).toHaveValue(path.basename(logoPath), { timeout: 15000 });
                await logoFileCheck;

                if (await s3Error.isVisible().catch(() => false)) {
                    console.log(`⚠️  Logo upload attempt ${attempt}/${maxAttempts}: backend returned "Technical Error Uploading the Logo. Code S3."`);
                } else {
                    console.log(`✅ Logo upload attempt ${attempt}/${maxAttempts}: real S3 upload + file-check completed.`);
                    logoUploaded = true;
                }
            } catch (err) {
                console.log(`⚠️  Logo upload attempt ${attempt}/${maxAttempts}: real upload never completed (${(err as Error).message}).`);
            }

            if (!logoUploaded && attempt < maxAttempts) {
                console.log('   Deleting stuck logo via 3-dots menu before retrying...');
                await dotIcons.nth(1).click({ force: true });
                await this.page.locator('#assetDelete').click({ timeout: 10000 });
                await expect(displayInputs.nth(1)).toHaveValue('', { timeout: 10000 });
                await this.page.waitForTimeout(500);
            }
        }

        if (!logoUploaded) {
            console.log(`⚠️  Logo upload: all ${maxAttempts} attempts failed — continuing anyway, display shows "${path.basename(logoPath)}" client-side only.`);
        }

        // Confirmed live option values on the Candance <select>: daily,
        // weekly, biweekly, semimonthly, monthly (plus a non-selectable
        // "--Select--" placeholder).
        await this.page.locator('[formcontrolname="candance"]').selectOption(candance);

        await this.page.locator('[formcontrolname="magazineDescription"]').fill(description);
        await this.page.locator('[formcontrolname="websiteUrl"]').fill(websiteUrl);

        // FTP is the only field on this form without a red "*" — optional.
        if (ftp) {
            await this.page.locator('[formcontrolname="ftp"]').fill(ftp);
        }
    }

    // Best-effort: clicks Save regardless of enabled state (the Logo upload
    // above may not have actually completed), and reports what the app
    // actually does rather than asserting a specific outcome up front.
    //
    // Confirmed live: a successful save navigates straight back to the
    // Magazines dashboard (**/dashboard**) with the new magazine's card
    // visible — but that dashboard's network never goes fully idle (some
    // background polling keeps requests flowing indefinitely), so
    // page.waitForLoadState('networkidle') after Save hangs forever even on
    // a clean success. Wait for the URL change instead; only fall back to
    // looking for an inline error message when no navigation happens.
    async saveMagazine(): Promise<{ clicked: boolean; errorText: string | null }> {
        const saveButton = this.page.getByRole('button', { name: 'Save Magazine' });

        const enabled = await saveButton.isEnabled().catch(() => false);
        console.log(`Save Magazine button enabled: ${enabled}`);
        if (!enabled) {
            return { clicked: false, errorText: null };
        }

        await saveButton.click();

        const navigated = await this.page.waitForURL('**/dashboard**', { timeout: 20000 })
            .then(() => true)
            .catch(() => false);

        if (navigated) {
            return { clicked: true, errorText: null };
        }

        await this.page.waitForTimeout(2000);
        const errorLocator = this.page.locator('.text-danger, [class*="error"]').filter({ hasText: /./ });
        const errorText = (await errorLocator.first().textContent().catch(() => null))?.trim() ?? null;

        return { clicked: true, errorText };
    }

}
