import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Which environment to run against. Defaults to 'uat' so existing behavior
// is unchanged unless TEST_ENV is set explicitly (env var, or npm script).
const ENV_NAME = (process.env.TEST_ENV || 'uat').toLowerCase();

// Load `.env.<name>` first (per-environment defaults), then `.env.local`
// (untracked personal overrides) on top of it. Real shell/CI env vars that
// are already set before this file runs are never overwritten by either
// file - dotenv only fills in variables that are still undefined.
const envFile = path.resolve(__dirname, '..', `.env.${ENV_NAME}`);
if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
} else {
    console.warn(`⚠️  No env file found at ${envFile} — relying on process env vars only.`);
}

const localOverrides = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(localOverrides)) {
    dotenv.config({ path: localOverrides });
}

function get(name: string, fallback?: string): string {
    const value = process.env[name] ?? fallback;
    if (value === undefined) {
        throw new Error(
            `Missing required environment variable "${name}" for TEST_ENV="${ENV_NAME}". ` +
            `Set it in .env.${ENV_NAME}, .env.local, or the shell environment.`
        );
    }
    return value;
}

function stripTrailingSlash(url: string): string {
    return url.endsWith('/') ? url.slice(0, -1) : url;
}

export const env = {
    name: ENV_NAME,

    // Client portal (login -> dashboard -> magazine creation). Backs
    // LoginPage / CreateMagazinePage. Other roles (admin/operator/QC/QA)
    // will get their own block here the same way Image Retouching's
    // `production` block does, once those flows are built.
    client: {
        baseUrl: stripTrailingSlash(get('CLIENT_BASE_URL')),
        get loginUrl() { return `${this.baseUrl}/login`; },
        username: get('CLIENT_USERNAME'),
        password: get('CLIENT_PASSWORD'),
    },

    // Production / backend (operator-facing) portal. No fixed
    // username/password here — multiple candidate accounts are tried via
    // BackendLoginPage.loginWithFallback(), same reasoning as the client
    // side (one of the given accounts can be invalid/stale on a given day).
    production: {
        baseUrl: stripTrailingSlash(get('PRODUCTION_BASE_URL')),
        get loginUrl() { return `${this.baseUrl}/login`; },
    },
};
