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

  await page.goto('http://localhost:3000/auth/login')
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')

  await page.waitForURL('**/dashboard', { timeout: 15000 })
  await page.waitForTimeout(3000)

  // Full dashboard view
  await page.screenshot({
    path: 'public/screenshots/dashboard.png',
    fullPage: false,
  })
  console.log('Dashboard saved')

  await browser.close()
}

main().catch(err => { console.error(err); process.exit(1) })
