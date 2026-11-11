// Records the demo flows for the video. Run from repo root after `npm run build`:
//   npx tsx video/record.ts
// One continuous app session (so the cache/state flow is real) with a marker per step, plus the two real
// testnet explorer pages. The app session uses a SIMULATED Nimiq Pay host (labelled in the video).
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { chromium, type Page } from 'playwright'

const PORT = 4183
const BASE = `http://localhost:${PORT}/`
const CLIPS = 'video/clips'
const W = 'NQ45 57M8 9VMC 16NL 31D0 99M1 YX9Y HC1D NVKU'
const VAULT_HINT = 'NQ45 57M8 9VMC 16NL 31D0 99M1 YX9Y HC1D NVKU'
// Real confirmed mainnet staking tx: lets the app's real getTransactionByHash path reach "Saved".
const TX = '40a52fd5e18ecd1183de80f19eaf5d02e08a7193412f0cd02795de1b679b94ee'

// String, not a function: tsx would inject __name() into a function body.
const mockHost = `
  window.nimiqPay = { language: 'en', userFiat: 'USD', network: 'mainnet' };
  window.nimiq = {
    listAccounts: () => new Promise((r) => setTimeout(() => r(['${W}', '${VAULT_HINT}']), 1400)),
    getBalance: async () => 2000000000,
    sendNewStakerTransaction: () => new Promise((r) => setTimeout(() => r('${TX}'), 1800)),
    sendStakeTransaction: () => new Promise((r) => setTimeout(() => r('${TX}'), 1800)),
    on() { return this },
    once() { return this },
  };`

const markers: Record<string, number> = {}
let t0 = 0
const mark = (name: string) => {
  markers[name] = (Date.now() - t0) / 1000
  console.log(name.padEnd(22), markers[name].toFixed(2))
}
const pause = (p: Page, ms: number) => p.waitForTimeout(ms)
/** Element centre in CSS px, for highlight rings in the video. */
const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {}
async function boxOf(p: Page, name: string, loc: ReturnType<Page['locator']>) {
  const b = await loc.boundingBox()
  if (b) boxes[name] = { x: b.x, y: b.y, w: b.width, h: b.height }
}

mkdirSync(CLIPS, { recursive: true })
for (const f of readdirSync(CLIPS)) rmSync(`${CLIPS}/${f}`)
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { shell: true, stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 4000))
const browser = await chromium.launch()

try {
  // ---- app session ----
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
    locale: 'en-US',
    recordVideo: { dir: CLIPS, size: { width: 780, height: 1688 } },
  })
  await ctx.addInitScript({ content: mockHost })
  const page = await ctx.newPage()
  t0 = Date.now()
  await page.goto(BASE)
  await page.getByRole('button', { name: 'Connect Nimiq Pay' }).waitFor()
  mark('welcome')
  await pause(page, 1500)
  await boxOf(page, 'connect', page.getByRole('button', { name: 'Connect Nimiq Pay' }))
  mark('connect_tap')
  await page.getByRole('button', { name: 'Connect Nimiq Pay' }).click()
  await page.locator('.hero').waitFor()
  mark('home_loading')
  await page.locator('.hero .big').waitFor({ timeout: 90_000 })
  await page.getByRole('button', { name: /Save into your stake · [A-Z]/ }).waitFor({ timeout: 90_000 })
  mark('home_ready')
  await pause(page, 3500)

  await page.getByRole('button', { name: 'Activity' }).click()
  await page.locator('.row').first().waitFor()
  mark('activity')
  await pause(page, 1500)
  await page.mouse.wheel(0, 900)
  await pause(page, 1800)
  await page.mouse.wheel(0, -900)
  await pause(page, 1200)
  const lightningRow = page.locator('.row', { hasText: 'Lightning / swap' }).first()
  await boxOf(page, 'notPurchase', lightningRow.getByRole('button', { name: 'Not a purchase' }))
  mark('not_purchase_tap')
  await lightningRow.getByRole('button', { name: 'Not a purchase' }).click()
  await pause(page, 2200)

  await page.getByRole('button', { name: 'Home' }).click()
  await page.getByRole('button', { name: /Save into your stake/ }).waitFor()
  mark('home_again')
  await pause(page, 1800)
  // Wait until the button is actually enabled (pool loaded), so the marker is the real tap time.
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('Save into your stake'))
    return !!b && !(b as HTMLButtonElement).disabled
  }, undefined, { timeout: 90_000 })
  await pause(page, 600)
  await boxOf(page, 'sweep', page.getByRole('button', { name: /Save into your stake/ }))
  mark('sweep_tap')
  await page.getByRole('button', { name: /Save into your stake/ }).click()
  await page.getByText('Approve the staking transaction').waitFor()
  mark('approval')
  await page.getByText('Confirming on the chain').waitFor({ timeout: 30_000 }).catch(() => {})
  mark('confirming')
  await page.getByRole('heading', { name: 'Saved' }).waitFor({ timeout: 90_000 })
  mark('success')
  await pause(page, 3500)
  await page.getByRole('button', { name: 'Done' }).click()
  await pause(page, 800)

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('heading', { name: 'Round up to at most' }).waitFor()
  mark('settings')
  await pause(page, 1000)
  await boxOf(page, 'x2', page.getByRole('button', { name: '×2' }))
  await page.getByRole('button', { name: '×2' }).click()
  mark('mult_x2')
  await pause(page, 900)
  await boxOf(page, 'x3', page.getByRole('button', { name: '×3' }))
  await page.getByRole('button', { name: '×3' }).click()
  mark('mult_x3')
  await pause(page, 1200)
  await page.getByRole('button', { name: 'Home' }).click()
  mark('home_x3')
  await pause(page, 2500)
  await page.getByRole('button', { name: 'How Spare works' }).click()
  await page.getByRole('heading', { name: 'How Spare works' }).waitFor()
  mark('how')
  await pause(page, 1500)
  await page.mouse.wheel(0, 700)
  await pause(page, 3000)
  mark('end')
  const vid = page.video()
  await ctx.close()
  renameSync(await vid!.path(), `${CLIPS}/app.webm`)

  // ---- real explorer pages (testnet) ----
  const proofs = [
    ['proof1', 'https://test.nimiq.watch/#68ae412aac302de10468fb6bbbfd489de7261b8c02a7653cb879f8d8fb44ae22'],
    ['proof2', 'https://test.nimiq.watch/#24eadf8d4b271d94ab02d44480d796f766cf7e6e5bf7dfa7c0faf09dc9ac5461'],
  ] as const
  for (const [name, url] of proofs) {
    const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: CLIPS, size: { width: 1280, height: 800 } } })
    const p = await c.newPage()
    await p.goto(url, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {})
    await p.waitForTimeout(9000)
    await p.screenshot({ path: `${CLIPS}/${name}.png` })
    const v = p.video()
    await c.close()
    renameSync(await v!.path(), `${CLIPS}/${name}.webm`)
    console.log('recorded', name)
  }
  writeFileSync(`${CLIPS}/markers.json`, JSON.stringify({ markers, boxes }, null, 2))
} finally {
  await browser.close()
  server.kill()
  if (server.pid) spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true, stdio: 'ignore' })
}
