# Taiwan ER cloud collector

Cloud collector for Taiwan NHI emergency-department waiting data.

- Contains collectors that reject malformed, duplicate, or unexpectedly incomplete hospital data.
- Includes a manual Playwright audit that follows the official NHI county/level search form in a real Chromium browser.
- Keeps scheduled collection disabled while the official source rejects public-cloud traffic.
- Contains no patient data, account credentials, or embedded access tokens.
- `service.py` is the production entry point for an always-on Taiwan-hosted runner.
- `expected_hospitals.json` is the reviewed 59-hospital identity, county, and level baseline.
- `apps-script/` is the authenticated Drive receiver and read-only latest/history relay.

The upstream NHI page currently refreshes its source data about every 15 minutes, so consecutive five-minute snapshots may contain the same official timestamp.

## Current audit result

Direct HTTP requests from Cloudflare, Google Apps Script, Netlify, and GitHub-hosted runners are reset or time out. The current browser audit tests whether GitHub-hosted Chromium can follow the same county/level search flow that a human visitor uses. Scheduled collection stays disabled until that browser path is proven reliable and all 59 hospitals pass validation.

The browser audit also fails with `ERR_CONNECTION_RESET`. Production therefore requires a Taiwan-hosted egress. The collector is fail-closed: it writes nothing unless all 59 reviewed hospital IDs occur exactly once, county/level classifications match, values are non-negative or officially blank, and the source timestamp is no more than 45 minutes old.

## Production flow

1. A Taiwan-hosted free Python service runs `python service.py` continuously. It requests the official NHI endpoint once per five-minute slot. The response already contains the county and hospital level, so issuing 66 redundant county/level requests is intentionally avoided.
2. After the 59-hospital audit passes, the service posts the unmodified official payload to the authenticated Apps Script receiver.
3. Apps Script appends a five-minute national summary to the master spreadsheet and 59 hospital rows to that day's Drive spreadsheet. When the day closes, it exports the complete daily sheet as a real `.xlsx` file in the same Drive folder.
4. The website reads `action=latest`, `action=trends`, and `action=history` from the Drive receiver. Stale data is labelled; invalid or incomplete snapshots are never published.

Required service secrets (set in the hosting dashboard, never commit them):

```text
APPS_SCRIPT_INGEST_URL=https://script.google.com/macros/s/.../exec
APPS_SCRIPT_INGEST_TOKEN=<value returned once by setupDriveReceiver>
```

Install command: `pip install -r requirements.txt`

Start command: `python service.py`

