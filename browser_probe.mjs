import { chromium } from "playwright";

const SOURCE_PAGE = "https://info.nhi.gov.tw/INAE4000/INAE4001S01";
const TIMEOUT_MS = 45_000;

const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/141.0.0.0 Safari/537.36",
    viewport: { width: 1365, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT_MS);

  const response = await page.goto(SOURCE_PAGE, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT_MS,
  });
  if (!response?.ok()) {
    throw new Error(`NHI search page returned HTTP ${response?.status() ?? "unknown"}`);
  }

  await page.getByRole("combobox", { name: "縣市別" }).selectOption({ label: "臺北市" });
  await page
    .getByRole("combobox", { name: "院所層級/特約類別" })
    .selectOption({ label: "醫學中心" });
  await page.getByRole("button", { name: "查詢" }).click();
  await page.waitForURL(/INAE4001S02/, { timeout: TIMEOUT_MS });

  const updateText = await page.getByText(/^資料更新時間：/).innerText();
  const rows = await page.locator("table tbody tr").allInnerTexts();
  const hospitalRows = rows.filter((row) => row.trim() && !row.includes("簡稱"));
  if (hospitalRows.length < 5) {
    throw new Error(`Expected Taipei medical centers; found ${hospitalRows.length} rows`);
  }

  console.log(
    JSON.stringify({
      ok: true,
      source: SOURCE_PAGE,
      query: { county: "臺北市", level: "醫學中心" },
      updateText,
      hospitalRows: hospitalRows.length,
      sample: hospitalRows.slice(0, 3),
    }),
  );
} finally {
  await browser.close();
}
