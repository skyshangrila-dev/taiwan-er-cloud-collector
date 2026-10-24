# Taiwan ER cloud collector

Free GitHub Actions audit project for Taiwan NHI emergency-department waiting data.

- Contains collectors that reject malformed, duplicate, or unexpectedly incomplete hospital data.
- Includes a manual Playwright audit that follows the official NHI county/level search form in a real Chromium browser.
- Keeps scheduled collection disabled while the official source rejects public-cloud traffic.
- Contains no patient data, account credentials, or embedded access tokens.

The upstream NHI page currently refreshes its source data about every 15 minutes, so consecutive five-minute snapshots may contain the same official timestamp.

## Current audit result

Direct HTTP requests from Cloudflare, Google Apps Script, Netlify, and GitHub-hosted runners are reset or time out. The current browser audit tests whether GitHub-hosted Chromium can follow the same county/level search flow that a human visitor uses. Scheduled collection stays disabled until that browser path is proven reliable and all 59 hospitals pass validation.
