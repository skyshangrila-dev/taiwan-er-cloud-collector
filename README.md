# Taiwan ER cloud collector

Free GitHub Actions audit project for Taiwan NHI emergency-department waiting data.

- Contains collectors that reject malformed, duplicate, or unexpectedly incomplete hospital data.
- Includes a manual audit for the official NHI endpoint and the hospital pages listed by MOHW.
- Keeps scheduled collection disabled while the official source rejects public-cloud traffic.
- Contains no patient data, account credentials, or embedded access tokens.

The upstream NHI page currently refreshes its source data about every 15 minutes, so consecutive five-minute snapshots may contain the same official timestamp.

## Current audit result

Direct requests from Cloudflare, Google Apps Script, Netlify, and GitHub-hosted runners are reset or time out. A GitHub-hosted audit could reach only 27 of 57 unique hospital-page links listed by MOHW. The project therefore does not publish partial data or claim to be a reliable live feed.

