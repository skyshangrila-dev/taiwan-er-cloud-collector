import concurrent.futures
import json
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

from curl_cffi import requests


INDEX_URL = "https://dep.mohw.gov.tw/DOMA/cp-979-4112-106.html"


class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.current_href = None
        self.current_text = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "a":
            self.current_href = dict(attrs).get("href")
            self.current_text = []

    def handle_data(self, data):
        if self.current_href is not None:
            self.current_text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self.current_href is not None:
            self.links.append(("".join(self.current_text).strip(), self.current_href))
            self.current_href = None
            self.current_text = []


def hospital_links():
    response = requests.get(INDEX_URL, impersonate="chrome", timeout=25)
    response.raise_for_status()
    parser = LinkParser()
    parser.feed(response.text)

    ignored_hosts = {
        "dep.mohw.gov.tw", "www.mohw.gov.tw", "info.nhi.gov.tw",
        "www.facebook.com", "line.me", "twitter.com", "x.com",
    }
    links = {}
    for label, href in parser.links:
        absolute = urljoin(INDEX_URL, href)
        parsed = urlparse(absolute)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            continue
        if parsed.hostname.lower() in ignored_hosts:
            continue
        if label and ("醫院" in label or "附醫" in label or "醫療" in label or "榮總" in label or "醫大" in label):
            links.setdefault(absolute, label)
    return links


def probe(item):
    url, label = item
    try:
        response = requests.get(url, impersonate="chrome", timeout=20, allow_redirects=True)
        return {
            "label": label,
            "url": url,
            "finalUrl": response.url,
            "status": response.status_code,
            "ok": 200 <= response.status_code < 400,
            "bytes": len(response.content),
        }
    except Exception as error:
        return {"label": label, "url": url, "ok": False, "error": str(error)}


links = hospital_links()
if len(links) < 40:
    raise RuntimeError(f"Only {len(links)} hospital links were discovered")

with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
    results = list(pool.map(probe, links.items()))

summary = {
    "officialIndex": INDEX_URL,
    "uniqueLinks": len(results),
    "reachable": sum(1 for result in results if result["ok"]),
    "unreachable": sum(1 for result in results if not result["ok"]),
    "results": results,
}
print(json.dumps(summary, ensure_ascii=False))
if summary["reachable"] < 40:
    raise RuntimeError("Too few official hospital pages are reachable from GitHub cloud")

