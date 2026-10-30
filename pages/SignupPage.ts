import { Page, expect } from '@playwright/test';
import { env } from '../config/env';

// Client portal signup flow: Login page -> "Register here" -> fill form ->
// Sign Up -> redirected back to /login. Same shared VMG Premedia app as
// Image Retouching's signup flow (confirmed live: identical form, same
// formcontrolnames) — the only difference is the Business dropdown
// selection, which is "Publishing" here instead of "Image Retouching".
export class SignupPage {

    constructor(private page: Page) {}

    async navigate() {
        await this.page.goto(env.client.loginUrl);
    }

    async openRegisterForm() {
        await this.page.getByText('Register here').click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForSelector('[formcontrolname="clientName"]');
    }

    async fillForm(params: {
        clientName: string;
        firstName: string;
        lastName: string;
        email: string;
        mobileNumber: string;
        password: string;
        publisherName: string;
    }) {
        const { clientName, firstName, lastName, email, mobileNumber, password, publisherName } = params;

        await this.page.locator('[formcontrolname="clientName"]').fill(clientName);
        await this.page.locator('[formcontrolname="firstName"]').fill(firstName);
        await this.page.locator('[formcontrolname="lastName"]').fill(lastName);
        await this.page.locator('[formcontrolname="emailId"]').fill(email);

        // Country = India
        await this.page.locator('mat-select').nth(0).click();
        await this.page.getByText('India', { exact: true }).click();
        await this.page.waitForTimeout(2000);

        // Area Code = +91. Role-based option locator (not the legacy
        // ".mat-option-text" class — confirmed live it matches zero
        // elements on this MDC-based Material build), same as the Business
        // dropdown below, with an explicit timeout so a mismatch fails
        // fast instead of hanging.
        const areaCodeSelect = this.page.locator('mat-select').nth(1);
        await areaCodeSelect.click();

        await this.page.getByRole('option', { name: '+91', exact: true }).click({ timeout: 10000 });
        await expect(areaCodeSelect).toContainText('+91', { timeout: 10000 });
        await this.page.waitForTimeout(2000);

        const mobileField = this.page.locator('[formcontrolname="phoneNumber"]');
        await mobileField.scrollIntoViewIfNeeded();
        await mobileField.click();
        await mobileField.fill(mobileNumber);

        const passwordField = this.page.locator('[formcontrolname="password"]');
        await passwordField.scrollIntoViewIfNeeded();
        await passwordField.click();
        await passwordField.fill(password);

        const confirmPasswordField = this.page.locator('[formcontrolname="confirmPassword"]');
        await confirmPasswordField.scrollIntoViewIfNeeded();
        await confirmPasswordField.click();
        await confirmPasswordField.fill(password);

        // Business = Publishing. Confirmed live: this dropdown's own
        // formcontrolname is "userRole" (not e.g. "businessType") despite
        // showing business-channel options (Publishing, Image Retouching,
        // Video Editing, Creative Services, Ad Ops) — interact via the
        // mat-select position, same as the working Image Retouching flow.
        const businessType = this.page.locator('mat-select').nth(2);
        await businessType.scrollIntoViewIfNeeded();
        await businessType.click();
        await this.page.getByRole('option', { name: 'Publishing', exact: true }).click();
        await expect(businessType).toContainText('Publishing');

        // Selecting "Publishing" reveals a second required field — confirmed
        // live, not present for the other Business options — a plain text
        // input (formcontrolname="publisher", placeholder "Publisher").
        // Without it the Sign Up button stays disabled.
        const publisherField = this.page.locator('[formcontrolname="publisher"]');
        await publisherField.scrollIntoViewIfNeeded();
        await publisherField.fill(publisherName);

        // Terms & Conditions. Same MDC-migration issue as the area-code
        // dropdown above — ".mat-checkbox-layout" is a legacy (pre-MDC)
        // Material checkbox class and no longer matches anything live, so
        // use the checkbox's ARIA role instead, which is stable across both
        // Material versions.
        const termsCheckbox = this.page.getByRole('checkbox');
        await termsCheckbox.scrollIntoViewIfNeeded();

        // The real <input> is cdk-visually-hidden; force-clicking it does
        // NOT reliably toggle an MDC checkbox (confirmed live — the click
        // "succeeds" but the box stays unchecked). Click a visible target
        // instead — its <label for=…>, else the MDC background box, else a
        // forced input click as last resort — and re-check the state on
        // every attempt until it actually takes.
        await expect(async () => {
            if (await termsCheckbox.isChecked()) return;

            const id = await termsCheckbox.getAttribute('id');
            const label = id ? this.page.locator(`label[for="${id}"]`) : null;

            if (label && (await label.count())) {
                await label.first().click({ timeout: 5000 });
            } else {
                const box = this.page.locator('mat-checkbox .mdc-checkbox__background').first();
                await box.click({ timeout: 5000 })
                    .catch(() => termsCheckbox.click({ force: true, timeout: 5000 }));
            }

            await this.page.waitForTimeout(400);
            expect(await termsCheckbox.isChecked()).toBe(true);
        }).toPass({ timeout: 30000, intervals: [1500] });

        await expect(termsCheckbox).toBeChecked({ timeout: 5000 });
    }

    async submit() {
        const signUpButton = this.page.getByRole('button', { name: 'Sign Up' });
        await expect(signUpButton).toBeEnabled();

        const loader = this.page.locator('.customLoader_2');
        if (await loader.isVisible().catch(() => false)) {
            await loader.waitFor({ state: 'hidden' });
        }

        await Promise.all([
            this.page.waitForURL(/\/login(?:\?|$)/, { timeout: 120000 }),
            signUpButton.click()
        ]);

        console.log('✅ Signup submitted — redirected to /login');
    }

    // ==========================================
    // FULL FLOW: CREATE A FRESH CLIENT ACCOUNT
    // ==========================================
    // Returns the generated credentials so the caller can log in as this
    // brand-new user for the rest of the journey.
    async signupNewClient(): Promise<{ clientName: string; email: string; password: string }> {
        const timestamp = Date.now();

        const clientName = `${timestamp}PublishingAutomationClient`;
        const email = `${timestamp}publishingautomation@test.com`;
        const password = 'Test@1234';
        const publisherName = `Automation Publisher ${timestamp}`;

        await this.navigate();
        await this.openRegisterForm();

        await this.fillForm({
            clientName,
            firstName: 'Automation',
            lastName: 'User',
            email,
            mobileNumber: '9876543210',
            password,
            publisherName
        });

        await this.page.screenshot({
            path: `screenshots/signup-form-${timestamp}.png`,
            fullPage: true
        });

        await this.submit();

        await this.page.screenshot({
            path: `screenshots/signup-success-${timestamp}.png`,
            fullPage: true
        });

        console.log(`✅ New client created — Client Name: ${clientName} | Email: ${email}`);

        return { clientName, email, password };
    }
}
