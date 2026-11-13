// Submission screenshots at 390×844 (light + dark), a 1200×630 thumbnail, and the 512px icon.
// Usage: npm run build && npx tsx scripts/screenshots.ts
// The "connected" shots inject a mock Nimiq Pay provider; its sweep returns a real confirmed mainnet
// staking tx hash (40a52fd5…), so the success sheet is reached through the real getTransactionByHash path.
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium, type Browser, type Page } from 'playwright'

const PORT = 4179
const BASE = `http://localhost:${PORT}/`
const OUT = 'screenshots'
const VIEWPORT = { width: 390, height: 844 }
const REAL_STAKING_TX = '40a52fd5e18ecd1183de80f19eaf5d02e08a7193412f0cd02795de1b679b94ee'

// A plain string: tsx would wrap a function with esbuild's __name() helper, which doesn't exist in the page.
const mockHost = (tx: string) => `
  window.nimiqPay = { language: 'en', userFiat: 'USD', network: 'mainnet' };
  window.nimiq = {
    listAccounts: async () => ['NQ51 DE7S FX74 A8BL L7GK EYGB YVPF UK6C 8DXT', 'NQ72 G627 XVT2 MGTC B587 6X1R NECJ VGFD BNQX'],
    getBalance: async () => 2000000000,
    sendNewStakerTransaction: () => new Promise((r) => setTimeout(() => r('${tx}'), 1200)),
    sendStakeTransaction: () => new Promise((r) => setTimeout(() => r('${tx}'), 1200)),
    on() { return this },
    once() { return this },
  };`

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('saved', `${OUT}/${name}.png`)
}

async function run(browser: Browser, scheme: 'light' | 'dark') {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: scheme, locale: 'en-US' })
  const page = await ctx.newPage()

  await page.goto(BASE)
  await page.getByRole('heading', { name: 'Save the spare change' }).waitFor()
  await shot(page, `welcome-${scheme}`)

  await page.getByRole('button', { name: 'How Spare works' }).click()
  await page.getByRole('heading', { name: 'How Spare works' }).waitFor()
  await shot(page, `how-it-works-${scheme}`)
  await page.getByRole('button', { name: /Back/ }).click()

  await page.getByRole('button', { name: 'Preview with a sample wallet' }).click()
  await page.locator('.hero .big').waitFor({ timeout: 90_000 })
  await page.getByText('Checking for new payments…').waitFor({ state: 'detached', timeout: 90_000 }).catch(() => {})
  await shot(page, `home-sample-${scheme}`)

  await page.getByRole('button', { name: 'Activity' }).click()
  await page.locator('.row').first().waitFor()
  await shot(page, `activity-${scheme}`)
  // v1.1: the Received section sits below the payments list.
  await page.getByRole('heading', { name: 'Received' }).scrollIntoViewIfNeeded()
  await page.getByRole('heading', { name: 'Received' }).evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await shot(page, `activity-received-${scheme}`)

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.evaluate(() => window.scrollTo(0, 0))
  // The pool picker, or (if the sample wallet stakes by now) the line naming its pool.
  await page.locator('select.input option').or(page.getByText(/Your stake is with/)).first().waitFor({ state: 'attached', timeout: 30_000 })
  await shot(page, `settings-${scheme}`)
  await ctx.close()

  // Connected (mocked host) → sweep → success sheet.
  const live = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: scheme, locale: 'en-US' })
  await live.addInitScript({ content: mockHost(REAL_STAKING_TX) })
  const p2 = await live.newPage()
  await p2.goto(BASE)
  await p2.getByRole('button', { name: 'Connect Nimiq Pay' }).click()
  const sweepBtn = p2.getByRole('button', { name: /Save into your stake/ })
  await sweepBtn.waitFor({ timeout: 90_000 })
  // The pool list can take a few seconds (the validators API is slow at times); the button waits for it.
  await p2.locator('button.btn:enabled', { hasText: 'Save into your stake' }).waitFor({ timeout: 120_000 })
  await shot(p2, `home-connected-${scheme}`)
  await sweepBtn.click()
  await p2.getByRole('heading', { name: 'Saved' }).waitFor({ timeout: 90_000 })
  await shot(p2, `sweep-success-${scheme}`)
  await live.close()
}

async function icon(browser: Browser) {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } })
  const svg = readFileSync('public/icon.svg', 'utf8')
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', '<svg width="512" height="512" ')}</body></html>`)
  await page.screenshot({ path: 'public/icon-512.png', omitBackground: true })
  console.log('saved public/icon-512.png')
  await page.close()
}

async function thumbnail(browser: Browser) {
  const img = (f: string) => `data:image/png;base64,${readFileSync(`${OUT}/${f}`).toString('base64')}`
  const svg = readFileSync('public/icon.svg', 'utf8').replace('<svg ', '<svg width="88" height="88" ')
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
  await page.setContent(`<!doctype html><html><body style="margin:0;width:1200px;height:630px;background:#f5f2ea;font-family:system-ui,'Segoe UI',sans-serif;display:flex;align-items:center;overflow:hidden">
    <div style="padding:0 0 0 72px;width:560px">
      ${svg}
      <h1 style="font-size:58px;line-height:1.05;margin:28px 0 16px;color:#17221e;letter-spacing:-0.02em">Save the spare change from what you already spend.</h1>
      <p style="font-size:24px;color:#55625c;margin:0">Spare rounds up your Nimiq Pay payments and stakes the change in your own NIM stake.</p>
    </div>
    <div style="display:flex;gap:24px;margin-left:24px;transform:rotate(-4deg)">
      <img src="${img('home-connected-light.png')}" style="width:260px;border-radius:28px;box-shadow:0 20px 50px rgb(0 0 0 / 22%)">
      <img src="${img('sweep-success-dark.png')}" style="width:260px;border-radius:28px;box-shadow:0 20px 50px rgb(0 0 0 / 30%);margin-top:60px">
    </div></body></html>`)
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/thumbnail.png` })
  console.log('saved', `${OUT}/thumbnail.png`)
  await page.close()
}

mkdirSync(OUT, { recursive: true })
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { shell: true, stdio: 'ignore' })
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE)).ok) break
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  const browser = await chromium.launch()
  await icon(browser)
  for (const scheme of ['light', 'dark'] as const) await run(browser, scheme)
  await thumbnail(browser)
  await browser.close()
  writeFileSync(`${OUT}/README.md`, '390×844 @2x screenshots (light + dark) and a 1200×630 thumbnail. Regenerate: `npm run build && npx tsx scripts/screenshots.ts`.\n')
} finally {
  server.kill()
  if (process.platform === 'win32' && server.pid) spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true, stdio: 'ignore' })
}
