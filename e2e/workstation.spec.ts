import { expect, test } from '@playwright/test'

const scannerRequestDates: string[] = []
const cryptoHistoryRequests: string[] = []

test.beforeEach(async ({ page }) => {
  scannerRequestDates.length = 0
  cryptoHistoryRequests.length = 0
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/api/scanner/candles')) {
      scannerRequestDates.push(url.searchParams.get('date') ?? '')
    }
    if (url.pathname.endsWith('/api/chart/crypto/candles')) {
      cryptoHistoryRequests.push(
        `${url.searchParams.get('exchange') ?? ''}:${url.searchParams.get('date') ?? ''}`,
      )
    }
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


test('restores the saved BTC exchange, session date and theme', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('tradethesis-charts-context-v1', JSON.stringify({
      market: 'BTC',
      mode: 'underlying',
      cryptoExchange: 'OKX',
      date: '2026-11-26',
      interval: '1h',
      theme: 'dark',
    }))
  })

  await page.goto('/')
  await expect(page.locator('main.app-shell')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('select').filter({ has: page.locator('option[value="OKX"]') })).toHaveValue('OKX')
  await expect(page.locator('input[type="date"]')).toHaveValue('2026-11-26')
  await expect(page.getByRole('heading', { name: /BTC\/USDT/ })).toBeVisible()
  await expect.poll(() => cryptoHistoryRequests.includes('OKX:2026-11-26')).toBe(true)
})

test('requests the selected session date after changing the NIFTY date', async ({ page }) => {
  await page.goto('/')
  const dateInput = page.locator('input[type="date"]')
  await dateInput.fill('2026-11-26')
  await expect(dateInput).toHaveValue('2026-11-26')
  await expect.poll(() => scannerRequestDates.includes('2026-11-26')).toBe(true)
})
