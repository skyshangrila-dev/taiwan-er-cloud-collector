const SOURCE_PAGE = "https://info.nhi.gov.tw/INAE4000/INAE4001S01";
const SOURCE_RESULT_PAGE = "https://info.nhi.gov.tw/INAE4000/INAE4001S02";
const SOURCE_API = "https://info.nhi.gov.tw/api/inae4000/inae4001s01/SQL0002";
const MINIMUM_HOSPITALS = 50;
const TIMEOUT_MS = 20_000;
const ATTEMPTS = 3;

const commonHeaders = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-TW,zh;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  Origin: "https://info.nhi.gov.tw",
  Referer: SOURCE_RESULT_PAGE,
  "User-Agent": "Mozilla/5.0 (compatible; TaiwanERCloudCollector/1.0; +https://github.com/skyshangrila-dev/taiwan-er-cloud-collector)",
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => String(value).split(";", 1)[0]).join("; ");
}

async function fetchOfficialPayload() {
  let cookie = "";
  try {
    const warmup = await fetchWithTimeout(SOURCE_PAGE, {
      headers: commonHeaders,
      redirect: "follow",
    });
    cookie = cookieHeader(warmup);
  } catch (error) {
    console.warn(`NHI warm-up failed: ${error.message}`);
  }

  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const headers = {
        ...commonHeaders,
        "Content-Type": "application/json",
      };
      if (cookie) headers.Cookie = cookie;

      const response = await fetchWithTimeout(SOURCE_API, {
        method: "POST",
        headers,
        body: JSON.stringify({ AREA_NO: "", CONT_TYPE: "" }),
        redirect: "follow",
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`NHI returned HTTP ${response.status}: ${body.slice(0, 180)}`);
      }
      const payload = JSON.parse(body);
      validateOfficialPayload(payload);
      return payload;
    } catch (error) {
      lastError = error;
      console.warn(`NHI attempt ${attempt}/${ATTEMPTS} failed: ${error.message}`);
      if (attempt < ATTEMPTS) await delay(750 * attempt);
    }
  }
  throw lastError ?? new Error("NHI source unavailable");
}

function validateOfficialPayload(payload) {
  if (!payload || typeof payload.sysdate !== "string" || !Array.isArray(payload.data)) {
    throw new Error("NHI returned an invalid response shape");
  }
  if (payload.data.length < MINIMUM_HOSPITALS) {
    throw new Error(`NHI returned only ${payload.data.length} hospitals`);
  }

  const ids = new Set();
  for (const [index, hospital] of payload.data.entries()) {
    const id = String(hospital?.hosP_ID ?? "");
    const name = String(hospital?.hosP_NAME ?? "").trim();
    if (!/^\d{10}$/.test(id)) throw new Error(`Invalid hospital id at row ${index + 1}`);
    if (!name) throw new Error(`Missing hospital name for ${id}`);
    if (ids.has(id)) throw new Error(`Duplicate hospital id ${id}`);
    ids.add(id);
  }
}

async function deliverToDrive(payload) {
  const endpoint = process.env.APPS_SCRIPT_INGEST_URL;
  const token = process.env.APPS_SCRIPT_INGEST_TOKEN;
  if (!endpoint || !token) {
    console.log("Drive delivery skipped: ingestion secrets are not configured yet.");
    return { skipped: true };
  }

  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, payload }),
    redirect: "follow",
  });
  const body = await response.text();
  let result;
  try {
    result = JSON.parse(body);
  } catch {
    throw new Error(`Apps Script returned non-JSON: ${body.slice(0, 180)}`);
  }
  if (!response.ok || result?.ok !== true) {
    throw new Error(`Drive ingestion failed: ${body.slice(0, 300)}`);
  }
  return result;
}

const payload = await fetchOfficialPayload();
console.log(JSON.stringify({
  sourceUpdatedAt: payload.sysdate,
  hospitalRows: payload.data.length,
  uniqueHospitalIds: new Set(payload.data.map((row) => String(row.hosP_ID))).size,
}));
const delivery = await deliverToDrive(payload);
console.log(JSON.stringify({ driveDelivery: delivery }));

