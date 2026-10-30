import { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Records API (XHR/fetch) call timings and full page-load timings across
// one or more pages in a test run, tagged by which logical page/step of the
// flow they happened in (via setPage()) — used to answer "how fast were the
// pages/APIs we drove through this flow, broken down page by page?"
// separately from whether the flow itself passed or failed.
export interface ApiCallRecord {
    page: string;
    tab: string;
    method: string;
    url: string;
    status: number;
    durationMs: number;
    timestamp: string;
}

export interface PageLoadRecord {
    page: string;
    tab: string;
    url: string;
    domContentLoadedMs: number;
    loadEventMs: number;
    timestamp: string;
}

// Any API call at or above this duration is flagged "slow" in the
// dedicated slow-calls report.
const SLOW_THRESHOLD_MS = 2000;

export class PerformanceTracker {
    private apiCalls: ApiCallRecord[] = [];
    private pageLoads: PageLoadRecord[] = [];
    private currentPage = 'unlabeled';
    private pageOrder: string[] = [];

    // Call before each logical step of the flow so every API call/page
    // load captured until the next call is tagged with this page/step
    // name in the report (e.g. "Login", "Create Magazine").
    setPage(name: string) {
        this.currentPage = name;
        if (!this.pageOrder.includes(name)) {
            this.pageOrder.push(name);
        }
    }

    // Attach to a page/tab (tab label identifies which browser tab in the
    // report, e.g. "main-tab"). Only XHR/fetch calls are recorded — static
    // assets (images, fonts, css) aren't "API" performance.
    attach(page: Page, tab: string) {
        // 'response' fires as soon as headers arrive — the body may still
        // be streaming, so request.timing().responseEnd is reliably -1
        // there (confirmed live: every single call reported -1ms).
        // 'requestfinished' fires once the response body has fully
        // downloaded, by which point timing() is populated.
        page.on('requestfinished', async (request) => {
            try {
                const resourceType = request.resourceType();
                if (resourceType !== 'xhr' && resourceType !== 'fetch') return;

                const response = await request.response();
                if (!response) return;

                const timing = request.timing();
                const durationMs = timing.responseEnd >= 0
                    ? Math.round(timing.responseEnd - timing.requestStart)
                    : -1;

                this.apiCalls.push({
                    page: this.currentPage,
                    tab,
                    method: request.method(),
                    url: request.url(),
                    status: response.status(),
                    durationMs,
                    timestamp: new Date().toISOString(),
                });
            } catch {
                // Best-effort — never let performance capture break the test.
            }
        });

        page.on('load', () => {
            const pageAtLoadTime = this.currentPage;
            page.evaluate(() => {
                const entries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
                if (!entries.length) return null;
                const e = entries[0];
                return {
                    domContentLoadedMs: e.domContentLoadedEventEnd,
                    loadEventMs: e.loadEventEnd,
                };
            }).then((nav) => {
                if (!nav) return;
                this.pageLoads.push({
                    page: pageAtLoadTime,
                    tab,
                    url: page.url(),
                    domContentLoadedMs: Math.round(nav.domContentLoadedMs),
                    loadEventMs: Math.round(nav.loadEventMs),
                    timestamp: new Date().toISOString(),
                });
            }).catch(() => {});
        });
    }

    // ==========================================
    // CSV HELPERS
    // ==========================================
    private static csvEscape(value: string | number): string {
        const s = String(value);
        if (/[",\n]/.test(s)) {
            return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
    }

    private static toCsv(headers: string[], rows: (string | number)[][]): string {
        const lines = [headers.map(PerformanceTracker.csvEscape).join(',')];
        for (const row of rows) {
            lines.push(row.map(PerformanceTracker.csvEscape).join(','));
        }
        return lines.join('\r\n');
    }

    // ==========================================
    // REPORT GENERATION (CSV, page-wise)
    // ==========================================
    // Writes two CSV files into outputDir:
    //   1. api-calls-<ts>.csv   — every API call, grouped by page, in
    //      the order each page was first visited, chronological within
    //      a page.
    //   2. slow-api-calls-<ts>.csv — only calls >= 2000ms, grouped by
    //      page, slowest first within each page. If a page had no call
    //      over the threshold, its 3 slowest calls are listed anyway
    //      (marked "below threshold") so every page still has visibility.
    writeCsvReports(outputDir: string, runId: string | number = Date.now()) {
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const headers = ['Page', 'Tab', 'Method', 'Endpoint', 'Status', 'Duration (ms)', 'Timestamp', 'Flag'];

        // --- All calls, page-wise, chronological within page ---
        const allRows: (string | number)[][] = [];
        for (const pageName of this.pageOrder) {
            const calls = this.apiCalls
                .filter((c) => c.page === pageName)
                .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

            for (const c of calls) {
                allRows.push([
                    c.page, c.tab, c.method, c.url, c.status, c.durationMs, c.timestamp,
                    c.status >= 400 ? 'ERROR' : (c.durationMs >= SLOW_THRESHOLD_MS ? 'SLOW' : ''),
                ]);
            }
        }

        const allCsvPath = path.join(outputDir, `api-calls-${runId}.csv`);
        fs.writeFileSync(allCsvPath, PerformanceTracker.toCsv(headers, allRows));

        // --- Slow calls only, page-wise, slowest first within page ---
        const slowRows: (string | number)[][] = [];
        for (const pageName of this.pageOrder) {
            const calls = this.apiCalls
                .filter((c) => c.page === pageName && c.durationMs >= 0)
                .sort((a, b) => b.durationMs - a.durationMs);

            const overThreshold = calls.filter((c) => c.durationMs >= SLOW_THRESHOLD_MS);
            const toList = overThreshold.length > 0 ? overThreshold : calls.slice(0, 3);

            for (const c of toList) {
                slowRows.push([
                    c.page, c.tab, c.method, c.url, c.status, c.durationMs, c.timestamp,
                    c.durationMs >= SLOW_THRESHOLD_MS ? 'SLOW' : 'below threshold — slowest on this page',
                ]);
            }
        }

        const slowCsvPath = path.join(outputDir, `slow-api-calls-${runId}.csv`);
        fs.writeFileSync(slowCsvPath, PerformanceTracker.toCsv(headers, slowRows));

        // --- Page loads CSV ---
        const pageLoadHeaders = ['Page', 'Tab', 'URL', 'DOM Content Loaded (ms)', 'Full Load (ms)', 'Timestamp'];
        const pageLoadRows = this.pageLoads.map((p) => [
            p.page, p.tab, p.url, p.domContentLoadedMs, p.loadEventMs, p.timestamp,
        ]);
        const pageLoadsCsvPath = path.join(outputDir, `page-loads-${runId}.csv`);
        fs.writeFileSync(pageLoadsCsvPath, PerformanceTracker.toCsv(pageLoadHeaders, pageLoadRows));

        // --- Per-page summary: count / errors / min / avg / max / total ---
        const summaryHeaders = ['Page', 'Call Count', 'Error Count', 'Min (ms)', 'Avg (ms)', 'Max (ms)', 'Total (ms)'];
        const summaryRows: (string | number)[][] = [];
        for (const pageName of this.pageOrder) {
            const calls = this.apiCalls.filter((c) => c.page === pageName);
            const durations = calls.map((c) => c.durationMs).filter((d) => d >= 0);
            const errorCount = calls.filter((c) => c.status >= 400).length;

            summaryRows.push([
                pageName,
                calls.length,
                errorCount,
                durations.length ? Math.min(...durations) : -1,
                durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : -1,
                durations.length ? Math.max(...durations) : -1,
                durations.length ? durations.reduce((a, b) => a + b, 0) : -1,
            ]);
        }

        const summaryCsvPath = path.join(outputDir, `page-summary-${runId}.csv`);
        fs.writeFileSync(summaryCsvPath, PerformanceTracker.toCsv(summaryHeaders, summaryRows));

        console.log(`\n=== PERFORMANCE CSV REPORTS ===`);
        console.log(`All API calls (${allRows.length} rows, ${this.pageOrder.length} pages): ${allCsvPath}`);
        console.log(`Slow API calls (>= ${SLOW_THRESHOLD_MS}ms) (${slowRows.length} rows): ${slowCsvPath}`);
        console.log(`Page loads (${pageLoadRows.length} rows): ${pageLoadsCsvPath}`);
        console.log(`Per-page summary (${summaryRows.length} pages): ${summaryCsvPath}`);

        return { allCsvPath, slowCsvPath, pageLoadsCsvPath, summaryCsvPath };
    }
}
