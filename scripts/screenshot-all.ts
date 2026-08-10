import { chromium } from '@playwright/test'
import { loadEnv } from 'vite'
import path from 'path'

const env = loadEnv('test', path.resolve(process.cwd()), '')
const EMAIL = env.TEST_USER_EMAIL
const PASSWORD = env.TEST_USER_PASSWORD

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  // Log in
  await page.goto('http://localhost:3000/auth/login')
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard', { timeout: 15000 })
  // Dismiss tutorial via localStorage before the page renders it
  await page.evaluate(() => localStorage.setItem('bd-tutorial-dismissed', '1'))
  await page.reload()
  await page.waitForTimeout(3500)

  // 1. Default dashboard (capture zone)
  await page.screenshot({ path: 'public/screenshots/dashboard.png' })
  console.log('1. dashboard.png')

  // 2. Tasks view — click "Tasks" sidebar nav item (rendered as [role="button"])
  await page.getByRole('button', { name: /^Tasks/ }).first().click()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: 'public/screenshots/dashboard-tasks.png' })
  console.log('2. dashboard-tasks.png')

  // 3. Open task detail panel via the "Open task detail" button on the first task
  const openDetailBtn = page.locator('button[aria-label="Open task detail"]').first()
  if (await openDetailBtn.isVisible()) {
    await openDetailBtn.click()
    await page.waitForTimeout(1000)
    await page.screenshot({ path: 'public/screenshots/task-detail.png' })
    console.log('3. task-detail.png')
    // Close via Escape key (handled by the panel's keydown listener)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
  }

  // 4. Notes view
  await page.getByRole('button', { name: /Recent notes/ }).first().click({ force: true })
  await page.waitForTimeout(1000)
  await page.screenshot({ path: 'public/screenshots/dashboard-notes.png' })
  console.log('4. dashboard-notes.png')

  await browser.close()
  console.log('All screenshots done.')
}

main().catch(err => { console.error(err); process.exit(1) })
