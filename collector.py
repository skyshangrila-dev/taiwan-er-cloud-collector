import json
import os
import sys
import time

from curl_cffi import requests


SOURCE_RESULT_PAGE = "https://info.nhi.gov.tw/INAE4000/INAE4001S02"
SOURCE_API = "https://info.nhi.gov.tw/api/inae4000/inae4001s01/SQL0002"
MINIMUM_HOSPITALS = 50


def validate(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get("sysdate"), str):
        raise RuntimeError("NHI returned an invalid response shape")
    rows = payload.get("data")
    if not isinstance(rows, list) or len(rows) < MINIMUM_HOSPITALS:
        raise RuntimeError(f"NHI returned only {len(rows) if isinstance(rows, list) else 0} hospitals")

    identifiers = set()
    for index, hospital in enumerate(rows, start=1):
        hospital_id = str(hospital.get("hosP_ID", ""))
        hospital_name = str(hospital.get("hosP_NAME", "")).strip()
        if len(hospital_id) != 10 or not hospital_id.isdigit():
            raise RuntimeError(f"Invalid hospital id at row {index}")
        if not hospital_name:
            raise RuntimeError(f"Missing hospital name for {hospital_id}")
        if hospital_id in identifiers:
            raise RuntimeError(f"Duplicate hospital id {hospital_id}")
        identifiers.add(hospital_id)
    return identifiers


def fetch_official_payload():
    session = requests.Session(impersonate="chrome")
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-TW,zh;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Origin": "https://info.nhi.gov.tw",
        "Referer": SOURCE_RESULT_PAGE,
        "X-Requested-With": "XMLHttpRequest",
    }
    session.get(SOURCE_RESULT_PAGE, headers=headers, timeout=25)

    last_error = None
    for attempt in range(1, 4):
        try:
            response = session.post(
                SOURCE_API,
                headers={**headers, "Content-Type": "application/json"},
                json={"AREA_NO": "", "CONT_TYPE": ""},
                timeout=25,
            )
            response.raise_for_status()
            payload = response.json()
            validate(payload)
            return payload
        except Exception as error:
            last_error = error
            print(f"NHI attempt {attempt}/3 failed: {error}", file=sys.stderr)
            if attempt < 3:
                time.sleep(attempt)
    raise last_error or RuntimeError("NHI source unavailable")


def deliver_to_drive(payload):
    endpoint = os.environ.get("APPS_SCRIPT_INGEST_URL")
    token = os.environ.get("APPS_SCRIPT_INGEST_TOKEN")
    if not endpoint or not token:
        print("Drive delivery skipped: ingestion secrets are not configured yet.")
        return {"skipped": True}

    response = requests.post(
        endpoint,
        json={"token": token, "payload": payload},
        timeout=25,
        allow_redirects=True,
        impersonate="chrome",
    )
    response.raise_for_status()
    result = response.json()
    if result.get("ok") is not True:
        raise RuntimeError(f"Drive ingestion failed: {json.dumps(result, ensure_ascii=False)}")
    return result


payload = fetch_official_payload()
identifiers = validate(payload)
print(json.dumps({
    "sourceUpdatedAt": payload["sysdate"],
    "hospitalRows": len(payload["data"]),
    "uniqueHospitalIds": len(identifiers),
}, ensure_ascii=False))
print(json.dumps({"driveDelivery": deliver_to_drive(payload)}, ensure_ascii=False))

