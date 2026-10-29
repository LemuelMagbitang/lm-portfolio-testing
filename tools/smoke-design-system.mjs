#!/usr/bin/env node
/**
 * Focused browser smoke test for the CMS Design System editor.
 *
 * Uses a mocked GitHub repository so the test can exercise the real CMS
 * render/preview/guarded-save path without writing to a real repository or
 * changing the portfolio's actual design tokens.
 */
import { spawn } from 'node:child_process';
import process from 'node:process';
import { chromium } from 'playwright';

const PORT = 4174;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const tokenFixture = `/* CMS Design System smoke fixture */
:root {
  --lm-font-sans: "Inter", sans-serif;
  --lm-font-display: "Satoshi", "Inter", sans-serif;
  --lm-font-label: "DM Sans", "Inter", sans-serif;
  --lm-font-accent: "Outfit", "Inter", sans-serif;
  --lm-color-background: #121212;
  --lm-color-surface: #0d0d0d;
  --lm-color-text-primary: #ffffff;
  --lm-color-text-secondary: #cccccc;
  --lm-color-text-muted: #888888;
  --lm-color-accent: #a8bd88;
  --lm-color-focus: #b7c99b;
  --lm-color-danger: #e0584f;
  --lm-color-success: #2ecc71;
  --lm-color-warning: #e0b04f;
  --lm-type-size-base: 16px;
  --lm-shape-card-radius: 24px;
  --lm-page-gutter: 24px;
  --lm-glass-blur: 10px;
  --lm-motion-standard: 0.3s;
}
`;

let tokenText = tokenFixture;
let tokenSha = 'smoke-tokens-sha-0';
let branchHead = 'smoke-head-0';
let treeSha = 'smoke-tree-0';
let blobSequence = 0;
let treeSequence = 0;
let commitSequence = 0;
const blobs = new Map();
const pendingTrees = new Map();
const commitParents = new Map([[branchHead, null]]);
const commitTrees = new Map([[branchHead, treeSha]]);
const browserErrors = [];

function startServer() {
  return spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    stdio: ['ignore', 'ignore', 'pipe']
  });
}

async function waitForServer(url, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Local site server did not become ready: ${url}`);
}

function jsonResponse(status, body) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

async function main() {
  let browser;
  try {
    await waitForServer(`${BASE_URL}/admin/`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', error => browserErrors.push(error.message));

    await page.addInitScript(() => {
      sessionStorage.setItem('lm_cms_session_v1', JSON.stringify({
        owner: 'Smoke',
        repo: 'TestRepo',
        branch: 'main',
        token: 'github_pat_smoke_test_token'
      }));
    });

    await page.route('https://api.github.com/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();

      if (path === '/repos/Smoke/TestRepo' && method === 'GET') {
        await route.fulfill(jsonResponse(200, { full_name: 'Smoke/TestRepo', default_branch: 'main' }));
        return;
      }

      if (path === '/repos/Smoke/TestRepo/contents/css/tokens.css' && method === 'GET') {
        await route.fulfill(jsonResponse(200, {
          name: 'tokens.css',
          path: 'css/tokens.css',
          sha: tokenSha,
          encoding: 'base64',
          content: Buffer.from(tokenText, 'utf8').toString('base64')
        }));
        return;
      }

      if (path === '/repos/Smoke/TestRepo/contents/data/hero.json' && method === 'GET') {
        await route.fulfill(jsonResponse(200, {
          name: 'hero.json',
          path: 'data/hero.json',
          sha: 'smoke-hero-sha',
          encoding: 'base64',
          content: Buffer.from('[]\\n', 'utf8').toString('base64')
        }));
        return;
      }

      if (path === '/repos/Smoke/TestRepo/git/ref/heads/main' && method === 'GET') {
        await route.fulfill(jsonResponse(200, {
          ref: 'refs/heads/main',
          object: { sha: branchHead }
        }));
        return;
      }

      if (path.startsWith('/repos/Smoke/TestRepo/git/commits/') && method === 'GET') {
        const sha = path.split('/').pop();
        await route.fulfill(jsonResponse(200, {
          sha,
          tree: { sha: commitTrees.get(sha) || treeSha }
        }));
        return;
      }

      if (path === '/repos/Smoke/TestRepo/git/blobs' && method === 'POST') {
        const payload = request.postDataJSON();
        const value = String(payload.content ?? '');
        const sha = `smoke-blob-${++blobSequence}`;
        blobs.set(sha, value);
        await route.fulfill(jsonResponse(201, {
          sha,
          size: Buffer.byteLength(value, payload.encoding === 'base64' ? 'base64' : 'utf8')
        }));
        return;
      }

      if (path === '/repos/Smoke/TestRepo/git/trees' && method === 'POST') {
        const payload = request.postDataJSON();
        const sha = `smoke-tree-${++treeSequence}`;
        pendingTrees.set(sha, { baseTree: payload.base_tree, entries: payload.tree || [] });
        await route.fulfill(jsonResponse(201, { sha, tree: [] }));
        return;
      }

      if (path === '/repos/Smoke/TestRepo/git/commits' && method === 'POST') {
        const payload = request.postDataJSON();
        const sha = `smoke-commit-${++commitSequence}`;
        commitParents.set(sha, (payload.parents || [])[0] || null);
        commitTrees.set(sha, payload.tree);
        await route.fulfill(jsonResponse(201, {
          sha,
          tree: { sha: payload.tree },
          parents: payload.parents || []
        }));
        return;
      }

      if (path === '/repos/Smoke/TestRepo/git/refs/heads/main' && method === 'PATCH') {
        const payload = request.postDataJSON();
        const nextCommit = payload.sha;
        const parent = commitParents.get(nextCommit);
        const nextTree = commitTrees.get(nextCommit);
        const pending = pendingTrees.get(nextTree);
        if (parent !== branchHead || !pending || pending.baseTree !== commitTrees.get(parent)) {
          await route.fulfill(jsonResponse(409, { message: 'Mock branch update conflict.' }));
          return;
        }
        const tokenEntry = pending.entries.find(entry => entry.path === 'css/tokens.css');
        if (!tokenEntry || !blobs.has(tokenEntry.sha)) {
          await route.fulfill(jsonResponse(422, { message: 'Expected a css/tokens.css blob in the guarded commit.' }));
          return;
        }
        tokenText = blobs.get(tokenEntry.sha);
        tokenSha = tokenEntry.sha;
        branchHead = nextCommit;
        treeSha = nextTree;
        await route.fulfill(jsonResponse(200, {
          ref: 'refs/heads/main',
          object: { sha: branchHead }
        }));
        return;
      }

      if (/^\/repos\/Smoke\/TestRepo\/commits\/[^/]+\/check-runs$/.test(path) && method === 'GET') {
        await route.fulfill(jsonResponse(200, {
          check_runs: [
            { name: 'build', status: 'completed', conclusion: 'success', details_url: 'https://github.com/Smoke/TestRepo/actions' },
            { name: 'deploy', status: 'completed', conclusion: 'success', details_url: 'https://github.com/Smoke/TestRepo/actions' },
            { name: 'report-build-status', status: 'completed', conclusion: 'success', details_url: 'https://github.com/Smoke/TestRepo/actions' },
            { name: 'validate', status: 'completed', conclusion: 'success', details_url: 'https://github.com/Smoke/TestRepo/actions' }
          ]
        }));
        return;
      }

      if (path.startsWith('/repos/Smoke/TestRepo/contents/') && method === 'GET') {
        const filePath = decodeURIComponent(path.split('/contents/')[1] || '');
        await route.fulfill(jsonResponse(200, {
          name: filePath.split('/').pop() || 'fixture.json',
          path: filePath,
          sha: `smoke-file-${filePath.replace(/[^A-Za-z0-9]+/g, '-')}`,
          encoding: 'base64',
          content: Buffer.from('[]\\n', 'utf8').toString('base64')
        }));
        return;
      }

      await route.fulfill(jsonResponse(404, { message: `Unmocked smoke API route: ${method} ${path}` }));
    });

    await page.goto(`${BASE_URL}/admin/`, { waitUntil: 'domcontentloaded' });
    await page.locator('#app.active').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('.nav-item[data-section="hero"].active').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#content #heroList, #content #addHero').first().waitFor({ state: 'visible', timeout: 10000 });

    const navigationItem = page.locator('.nav-item[data-section="designSystem"]');
    if (await navigationItem.count() !== 1) {
      throw new Error('CMS sidebar does not expose exactly one Design System navigation item.');
    }
    await navigationItem.click();
    await page.locator('#designSystemPanel').waitFor({ state: 'visible', timeout: 10000 });

    const accentInput = page.locator('[data-ds-token="--lm-color-accent"]');
    if (await accentInput.inputValue() !== '#a8bd88') {
      throw new Error('CMS Design System editor did not hydrate its color control from the shared token source.');
    }
    const initialPreview = await page.locator('#dsPreview').evaluate(el => el.style.getPropertyValue('--ds-accent'));
    if (initialPreview !== '#a8bd88') {
      throw new Error(`CMS Design System preview did not reflect the saved accent token: ${initialPreview}`);
    }

    await accentInput.evaluate(input => {
      input.value = '#b7c99b';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() =>
      document.querySelector('#dsPreview')?.style.getPropertyValue('--ds-accent') === '#b7c99b'
    );
    if (!(await page.locator('#dsPreviewStatus').textContent()).includes('Unsaved token edits')) {
      throw new Error('CMS Design System did not identify a local token edit as unsaved.');
    }
    if (await page.locator('#dirty-designSystem').evaluate(el => getComputedStyle(el).display) === 'none') {
      throw new Error('CMS Design System edit did not activate the section dirty indicator.');
    }

    await page.locator('#btnSaveTop').click();
    await page.waitForFunction(() => {
      const button = document.querySelector('#btnSaveTop');
      return !!button && !button.disabled && !/Saving/.test(button.textContent || '');
    }, null, { timeout: 10000 });
    await page.waitForFunction(() =>
      document.querySelector('#dsPreviewStatus')?.textContent?.includes('Preview matches the last saved token source.')
    , null, { timeout: 10000 });

    if (!tokenText.includes('--lm-color-accent: #b7c99b;')) {
      throw new Error('CMS Design System save did not persist the edited token in the mocked repository.');
    }
    if (tokenSha === 'smoke-tokens-sha-0' || branchHead === 'smoke-head-0') {
      throw new Error('CMS Design System save did not advance the mocked file and branch revisions.');
    }
    if (await page.locator('#dirty-designSystem').evaluate(el => getComputedStyle(el).display) !== 'none') {
      throw new Error('CMS Design System dirty indicator remained active after a successful save.');
    }
    if (browserErrors.length) {
      throw new Error('CMS Design System browser runtime errors: ' + JSON.stringify(browserErrors));
    }

    console.log('CMS Design System browser smoke passed: tab render, token hydration, live preview, guarded save, and saved state.');
  } finally {
    await browser?.close();
  }
}

const server = startServer();
process.on('exit', () => {
  if (!server.killed) server.kill('SIGTERM');
});

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
