// End-to-end test config. Uses the machine's pre-installed Chromium when one
// exists (cloud sessions), otherwise Playwright's own download.
import { defineConfig } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';

function chromiumPath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try {
    const dir = readdirSync(root)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort()
      .pop();
    if (dir) {
      const p = `${root}/${dir}/chrome-linux/chrome`;
      if (existsSync(p)) return p;
    }
  } catch {
    /* fall through to Playwright's default */
  }
  return undefined;
}

const exe = chromiumPath();

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.mjs',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 900 },
    ...(exe ? { launchOptions: { executablePath: exe } } : {}),
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173/',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
