import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    let body: Record<string, unknown> = {}
    if (url.pathname.endsWith('/api/available-dates')) body = { dates: [] }
    else if (url.pathname.endsWith('/api/chart/options/expiries')) body = { expiries: [], hasUnknown: false }
    else if (url.pathname.endsWith('/api/chart/options/strikes')) body = { strikes: [] }
    else if (url.pathname.endsWith('/api/chart/options/history')) body = { points: [], quality: {}, sampling: {} }
    else if (url.pathname.endsWith('/api/scanner/candles')) body = { candles: [] }
    else if (url.pathname.endsWith('/api/chart/crypto/candles')) body = { candles: [] }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
})

test('loads the chart workstation and its default index controls', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/TradeThesis Charts/)
  await expect(page.getByRole('heading', { name: /NIFTY/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'SENSEX' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'BTC' })).toBeVisible()
  await expect(page.getByLabel('Interactive market chart')).toBeVisible()
})

test('switches between BTC spot venues without mixing the selector state', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'BTC' }).click()
  await expect(page.getByRole('heading', { name: /BTC\/USDT/ })).toBeVisible()
  const exchange = page.locator('select').filter({ has: page.locator('option[value="OKX"]') })
  await expect(exchange).toHaveValue('BINANCE')
  await exchange.selectOption('OKX')
  await expect(exchange).toHaveValue('OKX')
  await expect(page.locator('.chart-heading h1 small')).toHaveText('OKX')
})

test('switches chart theme and index without losing the application shell', async ({ page }) => {
  await page.goto('/')
  await page.locator('button.theme-toggle').click()
  await expect(page.locator('main.app-shell')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'SENSEX' }).click()
  await expect(page.getByRole('heading', { name: /SENSEX/ })).toBeVisible()
})
