# Taiwan ER cloud collector

Free GitHub Actions collector for Taiwan NHI emergency-department waiting data.

- Reads the official NHI endpoint every five minutes.
- Rejects malformed, duplicate, or unexpectedly incomplete hospital data.
- Sends validated snapshots to a Google Apps Script endpoint when repository secrets are configured.
- Contains no patient data, account credentials, or embedded access tokens.

The upstream NHI page currently refreshes its source data about every 15 minutes, so consecutive five-minute snapshots may contain the same official timestamp.

