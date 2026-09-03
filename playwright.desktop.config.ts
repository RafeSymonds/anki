// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// End-to-end tests for the desktop shell (desktop/ + ts/lib/desktop), run
// against `anki-desktop --serve`, which exposes the same routes as the
// anki:// scheme over loopback HTTP with a fresh, seeded collection.

import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.ANKI_DESKTOP_PORT ?? "40100";

export default defineConfig({
    testDir: "./ts/tests/desktop",
    outputDir: "./out/e2e-desktop-report/",
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: 0,
    reporter: process.env.CI
        ? [["github"], ["html", { open: "never", outputFolder: "out/e2e-desktop-report" }]]
        : "list",
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    projects: [
        { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    ],
    webServer: {
        command: `bin/anki serve ${PORT} --fresh`,
        url: `http://127.0.0.1:${PORT}/_anki/readyz`,
        timeout: 300_000,
        reuseExistingServer: process.env.ANKI_E2E_REUSE_SERVER === "1",
        stdout: "pipe",
        stderr: "pipe",
    },
});
