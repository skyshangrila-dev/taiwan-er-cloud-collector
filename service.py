"""Always-on five-minute Taiwan ER collector for a Taiwan-hosted free server."""

import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from curl_cffi import requests


SOURCE_PAGE = "https://info.nhi.gov.tw/INAE4000/INAE4001S01"
SOURCE_RESULT_PAGE = "https://info.nhi.gov.tw/INAE4000/INAE4001S02"
SOURCE_API = "https://info.nhi.gov.tw/api/inae4000/inae4001s01/SQL0002"
TAIPEI = timezone(timedelta(hours=8))
FIVE_MINUTES = 300

CITY_NAMES = {
    "01": "臺北市", "03": "臺中市", "05": "臺南市", "07": "高雄市",
    "11": "基隆市", "12": "新竹市", "22": "嘉義市", "31": "新北市",
    "32": "桃園市", "33": "新竹縣", "34": "宜蘭縣", "35": "苗栗縣",
    "37": "彰化縣", "38": "南投縣", "39": "雲林縣", "40": "嘉義縣",
    "43": "屏東縣", "44": "澎湖縣", "45": "花蓮縣", "46": "臺東縣",
    "90": "金門縣", "91": "連江縣",
}
LEVEL_NAMES = {"1": "醫學中心", "2": "區域醫院", "3": "地區醫院"}
WAIT_FIELDS = ("waiT_SEE_CNT", "waiT_BED_CNT", "waiT_GENERAL_CNT", "waiT_ICU_CNT")


def load_expected():
    path = Path(__file__).with_name("expected_hospitals.json")
    rows = json.loads(path.read_text(encoding="utf-8"))
    return {row["id"]: row for row in rows}


EXPECTED = load_expected()


def parse_source_time(value):
    for pattern in ("%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(value, pattern).replace(tzinfo=TAIPEI)
        except ValueError:
            continue
    raise RuntimeError(f"Invalid official timestamp: {value!r}")


def validate(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get("sysdate"), str):
        raise RuntimeError("NHI returned an invalid response shape")
    rows = payload.get("data")
    if not isinstance(rows, list) or len(rows) != len(EXPECTED):
        raise RuntimeError(f"Expected {len(EXPECTED)} hospitals; received {len(rows) if isinstance(rows, list) else 0}")

    seen = set()
    for index, hospital in enumerate(rows, start=1):
        hospital_id = str(hospital.get("hosP_ID", ""))
        if hospital_id in seen:
            raise RuntimeError(f"Duplicate hospital id {hospital_id}")
        expected = EXPECTED.get(hospital_id)
        if not expected:
            raise RuntimeError(f"Unexpected hospital id {hospital_id} at row {index}")
        city = CITY_NAMES.get(str(hospital.get("areA_NO_N", "")))
        level = LEVEL_NAMES.get(str(hospital.get("conT_TYPE", "")))
        if city != expected["city"] or level != expected["level"]:
            raise RuntimeError(f"Hospital classification mismatch for {hospital_id}: {city}/{level}")
        if not str(hospital.get("hosP_NAME", "")).strip():
            raise RuntimeError(f"Missing hospital name for {hospital_id}")
        if hospital.get("inform") not in ("Y", "N"):
            raise RuntimeError(f"Invalid 119 status for {hospital_id}")
        for field in WAIT_FIELDS:
            value = hospital.get(field)
            if value not in (None, ""):
                try:
                    if int(value) < 0:
                        raise ValueError
                except (TypeError, ValueError):
                    raise RuntimeError(f"Invalid {field} for {hospital_id}") from None
        seen.add(hospital_id)

    missing = sorted(set(EXPECTED) - seen)
    if missing:
        raise RuntimeError("Missing hospital ids: " + ",".join(missing))
    source_time = parse_source_time(payload["sysdate"])
    age = datetime.now(TAIPEI) - source_time
    if age > timedelta(minutes=45) or age < timedelta(minutes=-5):
        raise RuntimeError(f"Official data timestamp is stale or in the future: {payload['sysdate']}")
    return {"hospitalCount": len(rows), "sourceTime": source_time.isoformat()}


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
    session.get(SOURCE_PAGE, headers=headers, timeout=25)
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
            print(f"NHI attempt {attempt}/3 failed: {error}", file=sys.stderr, flush=True)
            if attempt < 3:
                time.sleep(attempt)
    raise last_error or RuntimeError("NHI source unavailable")


def deliver_to_drive(payload):
    endpoint = os.environ.get("APPS_SCRIPT_INGEST_URL", "").strip()
    token = os.environ.get("APPS_SCRIPT_INGEST_TOKEN", "").strip()
    if not endpoint or not token:
        raise RuntimeError("APPS_SCRIPT_INGEST_URL and APPS_SCRIPT_INGEST_TOKEN are required")
    response = requests.post(
        endpoint,
        json={"token": token, "payload": payload},
        timeout=45,
        allow_redirects=True,
        impersonate="chrome",
    )
    response.raise_for_status()
    result = response.json()
    if result.get("ok") is not True:
        raise RuntimeError(f"Drive ingestion failed: {json.dumps(result, ensure_ascii=False)}")
    return result


def run_once():
    payload = fetch_official_payload()
    audit = validate(payload)
    delivery = deliver_to_drive(payload)
    print(json.dumps({
        "ok": True,
        "collectedAt": datetime.now(TAIPEI).isoformat(),
        "sourceUpdatedAt": payload["sysdate"],
        "audit": audit,
        "drive": delivery,
    }, ensure_ascii=False), flush=True)


def main():
    once = "--once" in sys.argv
    while True:
        started = time.time()
        try:
            run_once()
        except Exception as error:
            print(json.dumps({
                "ok": False,
                "failedAt": datetime.now(TAIPEI).isoformat(),
                "error": str(error),
            }, ensure_ascii=False), file=sys.stderr, flush=True)
        if once:
            return
        next_slot = (int(started) // FIVE_MINUTES + 1) * FIVE_MINUTES + 8
        time.sleep(max(1, next_slot - time.time()))


if __name__ == "__main__":
    main()

