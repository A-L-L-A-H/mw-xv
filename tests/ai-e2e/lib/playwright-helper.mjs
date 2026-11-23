import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

export const DEFAULT_BOARD_AI_ROUTES = [
  '/board/ai/hq',
  '/board/ai/mission-control',
  '/board/ai/operations',
  '/board/ai/continuity',
  '/board/ai/governance',
  '/board/ai/providers',
  '/board/ai/eval-lab',
];

export const BUILTIN_SECRET_PATTERNS = [
  /\bsk-live-[a-z0-9_-]{4,}\b/iu,
  /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._-]{8,}\b/iu,
  /\bMW_AI_[A-Z0-9_]+\s*=\s*[^\s"'<>]{6,}/u,
];

export function resolveScenarioConfig(opts = {}) {
  const scenario = typeof opts.scenario === 'string' && opts.scenario.trim() ? opts.scenario : null;

  let base = {
    scenario,
    routes: DEFAULT_BOARD_AI_ROUTES,
    checkBadges: true,
    requiredBadges: ['persisted', 'derived', 'ephemeral'],
    checkColorSchemes: true,
    checkMobileOverflow: false,
    verifyDrillDownLinks: false,
    verifyFilters: false,
    verifyA11yReducedMotion: false,
    nonOptimisticCheck: null,
  };

  if (scenario === 'drill-down') {
    base = {
      ...base,
      routes: [
        '/board/ai/hq',
        '/board/ai/mission-control',
        '/board/ai/operations',
        '/board/ai/continuity',
      ],
      checkBadges: true,
      requiredBadges: ['persisted', 'derived', 'ephemeral'],
      verifyDrillDownLinks: true,
    };
  } else if (scenario === 'badges-and-filters') {
    base = {
      ...base,
      routes: ['/board/ai/mission-control', '/board/ai/operations'],
      checkBadges: true,
      requiredBadges: ['persisted', 'derived', 'ephemeral'],
      verifyFilters: true,
    };
  } else if (scenario === 'emergency-controls') {
    base = {
      ...base,
      routes: ['/board/ai/governance', '/board/ai/operations'],
      checkBadges: false,
      nonOptimisticCheck: {
        route: '/board/ai/governance',
        status: 403,
        apiPattern: '**/api/ai/**',
        triggerLabel: /emergency stop|halt|revoke/iu,
        confirmLabel: /confirm|proceed|stop|revoke/iu,
        optimisticSuccessText: /stopped|halted|revoked successfully/iu,
      },
    };
  } else if (scenario === 'a11y-reduced-motion') {
    base = {
      ...base,
      routes: ['/board/ai/hq', '/board/ai/operations', '/board/ai/continuity'],
      checkBadges: false,
      checkColorSchemes: true,
      checkMobileOverflow: true,
      verifyA11yReducedMotion: true,
    };
  }

  return {
    ...base,
    routes: Array.isArray(opts.routes) && opts.routes.length > 0 ? opts.routes : base.routes,
    checkBadges: opts.checkBadges !== undefined ? opts.checkBadges !== false : base.checkBadges,
    requiredBadges: Array.isArray(opts.requiredBadges) ? opts.requiredBadges : base.requiredBadges,
    checkColorSchemes:
      opts.checkColorSchemes !== undefined
        ? opts.checkColorSchemes !== false
        : base.checkColorSchemes,
    checkMobileOverflow:
      opts.checkMobileOverflow !== undefined
        ? Boolean(opts.checkMobileOverflow)
        : base.checkMobileOverflow,
    nonOptimisticCheck: opts.nonOptimisticCheck ?? base.nonOptimisticCheck,
  };
}

function resolveRootDir(rootDir) {
  if (rootDir) return path.resolve(rootDir);
  return path.resolve(import.meta.dirname, '../../..');
}

async function loadPlaywright() {
  const root = resolveRootDir();
  const rootRequire = createRequire(path.join(root, 'package.json'));
  try {
    rootRequire.resolve('@playwright/test');
  } catch {
    return null;
  }
  try {
    return await import('@playwright/test');
  } catch {
    return null;
  }
}

export async function isPlaywrightAvailable() {
  const pw = await loadPlaywright();
  if (!pw?.chromium) return false;
  try {
    const executable = pw.chromium.executablePath();
    return Boolean(executable) && existsSync(executable);
  } catch {
    return false;
  }
}

async function findPageFiles(dir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await findPageFiles(fullPath)));
    } else if (/^page\.(tsx|ts|jsx|js|mjs)$/u.test(entry.name)) {
      found.push(fullPath);
    }
  }
  return found;
}

export async function hasBoardAiRoutes(rootDir) {
  const root = resolveRootDir(rootDir);
  const aiAppDir = path.join(root, 'apps/board/src/app/board/ai');
  if (!existsSync(aiAppDir)) return false;
  const pages = await findPageFiles(aiAppDir);
  return pages.length > 0;
}

async function seedBrowserSession(page, baseUrl, session) {
  if (!session) return;
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((sessionData) => {
    globalThis.localStorage.setItem('mw-board-session', JSON.stringify(sessionData));
  }, session);
}

async function loginViaForm(page, baseUrl, credentials) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email or Username').fill(credentials.login);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: /enter the shadow|sign in/iu }).click();
  await page.waitForURL(/\/board/u, { timeout: 15_000 });
}

function matchesSecretRule(rule, text) {
  if (!rule || typeof text !== 'string') return false;
  if (rule instanceof RegExp) {
    if (rule.global || rule.sticky) rule.lastIndex = 0;
    return rule.test(text);
  }
  if (typeof rule === 'string' && rule.length > 0) {
    return text.includes(rule);
  }
  return false;
}

export async function runBoardAiPlaywrightCheck(opts = {}) {
  const rawBaseUrl = opts.baseUrl || process.env.MW_E2E_BOARD_URL;
  if (!rawBaseUrl || !String(rawBaseUrl).trim()) {
    return { ok: false, details: 'Missing board baseUrl or MW_E2E_BOARD_URL' };
  }

  const pw = await loadPlaywright();
  if (!pw?.chromium) {
    return { ok: false, details: 'Playwright (@playwright/test) is not installed.' };
  }
  const executable = pw.chromium.executablePath();
  if (!executable || !existsSync(executable)) {
    return {
      ok: false,
      details: `Playwright Chromium binary not found at ${executable || '(empty)'}.`,
    };
  }

  const baseUrl = String(rawBaseUrl).trim().replace(/\/$/u, '');
  const config = resolveScenarioConfig(opts);
  const { routes, checkBadges, requiredBadges, checkColorSchemes, checkMobileOverflow } = config;
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 15_000;
  const forbiddenSecrets = Array.isArray(opts.forbiddenSecrets) ? opts.forbiddenSecrets : [];

  const consoleErrors = [];
  const pageErrors = [];
  const visitedRoutes = [];
  const badgeCounts = { persisted: 0, derived: 0, ephemeral: 0 };
  const failures = [];
  let drillDownLinkCount = 0;
  let filterControlCount = 0;
  let semanticStructureCount = 0;

  let browser;
  try {
    browser = await pw.chromium.launch({ headless: true });

    const schemes = checkColorSchemes
      ? [
          { colorScheme: 'light', reducedMotion: 'no-preference' },
          { colorScheme: 'dark', reducedMotion: 'reduce' },
        ]
      : [{ colorScheme: 'light', reducedMotion: 'no-preference' }];

    for (const scheme of schemes) {
      const context = await browser.newContext({
        viewport: opts.viewport || { width: 1440, height: 1000 },
        colorScheme: scheme.colorScheme,
        reducedMotion: scheme.reducedMotion,
      });
      if (opts.companyId !== undefined) {
        await context.setExtraHTTPHeaders({ 'x-company-id': String(opts.companyId) });
      }

      const page = await context.newPage();
      page.setDefaultTimeout(timeoutMs);
      let expectingHttpErrorStatus = null;
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          if (
            expectingHttpErrorStatus !== null &&
            text.includes(`status of ${expectingHttpErrorStatus}`)
          ) {
            return;
          }
          consoleErrors.push(`[${scheme.colorScheme}] ${text}`);
        }
      });
      page.on('pageerror', (err) => {
        pageErrors.push(`[${scheme.colorScheme}] ${err.message}`);
      });

      if (opts.session) {
        await seedBrowserSession(page, baseUrl, opts.session);
      } else if (opts.credentials?.login && opts.credentials?.password) {
        await loginViaForm(page, baseUrl, opts.credentials);
      }

      const routesForScheme =
        scheme.colorScheme === 'light' || config.verifyA11yReducedMotion ? routes : [routes[0]];

      for (const route of routesForScheme) {
        const targetUrl = `${baseUrl}${route.startsWith('/') ? route : `/${route}`}`;
        const response = await page.goto(targetUrl, { waitUntil: 'networkidle' });
        if (!response || response.status() >= 400) {
          failures.push(
            `Route ${route} (${scheme.colorScheme}) returned HTTP ${response?.status() ?? 'no-response'}`
          );
          continue;
        }
        visitedRoutes.push(`${scheme.colorScheme}:${route}`);

        const bodyText = await page.evaluate(() => globalThis.document.body.innerText || '');
        const htmlContent = await page.content();

        if (bodyText.trim().length === 0) {
          failures.push(`Route ${route} (${scheme.colorScheme}) rendered empty body`);
        }

        if (checkBadges && scheme.colorScheme === 'light') {
          const domBadges = await page.evaluate(() => {
            const counts = { persisted: 0, derived: 0, ephemeral: 0 };
            const seen = new Set();
            const candidates = globalThis.document.querySelectorAll(
              '[data-badge], [class*="badge"], span, div, p, td, li'
            );
            for (const el of candidates) {
              if (seen.has(el)) continue;
              const attr = (el.getAttribute('data-badge') || '').trim().toLowerCase();
              if (attr in counts) {
                counts[attr] += 1;
                seen.add(el);
                continue;
              }
              if (el.children.length === 0) {
                const txt = (el.textContent || '').trim().toLowerCase();
                if (txt in counts) {
                  counts[txt] += 1;
                  seen.add(el);
                }
              }
            }
            return counts;
          });
          for (const badge of ['persisted', 'derived', 'ephemeral']) {
            const regexMatches = bodyText.match(new RegExp(`\\b${badge}\\b`, 'giu'));
            badgeCounts[badge] += Math.max(
              domBadges[badge],
              regexMatches ? regexMatches.length : 0
            );
          }
        }

        for (const pattern of BUILTIN_SECRET_PATTERNS) {
          if (matchesSecretRule(pattern, bodyText) || matchesSecretRule(pattern, htmlContent)) {
            failures.push(`Route ${route} matched built-in secret pattern ${pattern}`);
          }
        }

        for (const secret of forbiddenSecrets) {
          if (matchesSecretRule(secret, bodyText) || matchesSecretRule(secret, htmlContent)) {
            failures.push(`Route ${route} leaked forbidden secret value in DOM/HTML`);
          }
        }

        if (scheme.colorScheme === 'light' && config.verifyDrillDownLinks) {
          const navLinks = page.locator('a[href*="/board/ai/"]');
          const linkCount = await navLinks.count();
          drillDownLinkCount += linkCount;
          if (linkCount > 0) {
            const firstVisibleLink = navLinks.first();
            const href = await firstVisibleLink.getAttribute('href');
            if (href && (await firstVisibleLink.isVisible())) {
              await firstVisibleLink.click();
              await page.waitForLoadState('networkidle');
              if (!page.url().includes('/board/ai/')) {
                failures.push(
                  `Drill-down link click from ${route} did not stay inside /board/ai/* (got ${page.url()})`
                );
              }
            }
          }
        }

        if (scheme.colorScheme === 'light' && config.verifyFilters) {
          const filterLoc = page.locator(
            'select, [role="combobox"], input[type="search"], [role="searchbox"], [data-filter]'
          );
          const count = await filterLoc.count();
          filterControlCount += count;
          if (count > 0) {
            const firstFilter = filterLoc.first();
            if (await firstFilter.isVisible()) {
              const tagName = await firstFilter.evaluate((el) => el.tagName.toLowerCase());
              if (tagName === 'input') {
                await firstFilter.fill('agent');
                await firstFilter.fill('');
              } else if (tagName === 'select') {
                const optionCount = await firstFilter.locator('option').count();
                if (optionCount > 1) {
                  await firstFilter.selectOption({ index: 1 });
                  await firstFilter.selectOption({ index: 0 });
                }
              } else {
                await firstFilter.focus();
              }
            }
          }
        }

        if (scheme.colorScheme === 'dark' && config.verifyA11yReducedMotion) {
          const reducedMotionOk = await page.evaluate(
            () => globalThis.window.matchMedia('(prefers-reduced-motion: reduce)').matches
          );
          if (!reducedMotionOk) {
            failures.push(
              `Expected prefers-reduced-motion: reduce media query to match on ${route}`
            );
          }

          await page.keyboard.press('Tab');
          const focusMoved = await page.evaluate(
            () =>
              Boolean(globalThis.document.activeElement) &&
              globalThis.document.activeElement !== globalThis.document.body
          );
          if (!focusMoved) {
            failures.push(`Keyboard Tab navigation failed to focus an element on ${route}`);
          }

          const structureCount = await page
            .locator('table, [role="table"], [role="grid"], dl, ul')
            .count();
          semanticStructureCount += structureCount;
        }

        if (checkMobileOverflow) {
          await page.setViewportSize({ width: 390, height: 844 });
          const hasOverflow = await page.evaluate(
            () =>
              globalThis.document.documentElement.scrollWidth >
              globalThis.document.documentElement.clientWidth
          );
          if (hasOverflow) {
            failures.push(`Route ${route} (${scheme.colorScheme}) has mobile horizontal overflow`);
          }
          await page.setViewportSize(opts.viewport || { width: 1440, height: 1000 });
        }
      }

      if (scheme.colorScheme === 'light' && config.nonOptimisticCheck) {
        const check = config.nonOptimisticCheck;
        const targetRoute = check.route || '/board/ai/governance';
        const errorStatus = check.status ?? 403;
        expectingHttpErrorStatus = errorStatus;
        try {
          await page.route(check.apiPattern || '**/api/**', async (routeHandler) => {
            const method = routeHandler.request().method();
            if (
              method === 'POST' ||
              method === 'PUT' ||
              method === 'PATCH' ||
              method === 'DELETE'
            ) {
              await routeHandler.fulfill({
                status: errorStatus,
                contentType: 'application/json',
                body: JSON.stringify({
                  success: false,
                  error: check.serverErrorMessage || `Simulated HTTP ${errorStatus} denial`,
                }),
              });
              return;
            }
            await routeHandler.continue();
          });

          await page.goto(`${baseUrl}${targetRoute}`, { waitUntil: 'networkidle' });

          let triggered = false;
          if (check.triggerSelector) {
            const trigger = page.locator(check.triggerSelector).first();
            try {
              await trigger.waitFor({ state: 'visible', timeout: 5000 });
              await trigger.click();
              triggered = true;
            } catch {
              failures.push(
                `Control trigger (${check.triggerSelector}) did not appear on ${targetRoute}`
              );
            }
          } else if (check.triggerLabel) {
            const trigger = page.getByRole('button', { name: check.triggerLabel }).first();
            try {
              await trigger.waitFor({ state: 'visible', timeout: 5000 });
              await trigger.click();
              triggered = true;
            } catch {
              failures.push(
                `Control trigger button (${String(check.triggerLabel)}) did not appear on ${targetRoute}`
              );
            }
          }

          if (triggered && check.confirmLabel) {
            const confirmBtn = page.getByRole('button', { name: check.confirmLabel }).first();
            try {
              await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
              await confirmBtn.click();
            } catch {
              failures.push(
                `Confirmation modal button (${String(check.confirmLabel)}) did not appear on ${targetRoute}`
              );
            }
          }

          const alertLocator = page.getByRole('alert').first();
          try {
            await alertLocator.waitFor({ state: 'visible', timeout: 5000 });
          } catch {
            failures.push(
              `Non-optimistic error check on ${targetRoute} (HTTP ${errorStatus}) did not render an alert`
            );
          }

          if (check.optimisticSuccessText) {
            const postText = await page.evaluate(() => globalThis.document.body.innerText || '');
            const pattern =
              check.optimisticSuccessText instanceof RegExp
                ? check.optimisticSuccessText
                : new RegExp(check.optimisticSuccessText, 'iu');
            if (pattern.test(postText)) {
              failures.push(
                `Non-optimistic error check on ${targetRoute} displayed optimistic success despite HTTP ${errorStatus}`
              );
            }
          }
        } finally {
          await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
          expectingHttpErrorStatus = null;
        }
      }

      await context.close();
    }

    if (checkBadges) {
      for (const badge of requiredBadges) {
        if ((badgeCounts[badge] ?? 0) === 0) {
          failures.push(`Missing required "${badge}" provenance badge across /board/ai/* pages`);
        }
      }
    }
    if (config.verifyDrillDownLinks && drillDownLinkCount === 0) {
      failures.push('Expected /board/ai/* drill-down navigation links across HQ/Mission Control');
    }
    if (config.verifyFilters && filterControlCount === 0) {
      failures.push('Expected multi-facet filter controls on Mission Control/Operations routes');
    }
    if (config.verifyA11yReducedMotion && semanticStructureCount === 0) {
      failures.push('Expected semantic table/list data structures across accessible AI routes');
    }
    if (consoleErrors.length > 0) {
      failures.push(`Console errors detected: ${consoleErrors.join('; ')}`);
    }
    if (pageErrors.length > 0) {
      failures.push(`Uncaught page errors detected: ${pageErrors.join('; ')}`);
    }

    return {
      ok: failures.length === 0,
      details:
        failures.length === 0
          ? `Verified ${visitedRoutes.length} Board AI route checks cleanly.`
          : failures.join(' | '),
      visitedRoutes,
      badgeCounts,
      consoleErrors,
      pageErrors,
    };
  } catch (error) {
    return {
      ok: false,
      details: `Playwright execution failed: ${error instanceof Error ? error.message : String(error)}`,
      visitedRoutes,
      badgeCounts,
      consoleErrors,
      pageErrors,
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}
