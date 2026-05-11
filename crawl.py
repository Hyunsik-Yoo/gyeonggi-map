import argparse
import csv
import os
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE = "https://www.lllcard.kr"
LIST_URL = f"{BASE}/guide/useVcOrganListAjax.do"
DETAIL_URL = f"{BASE}/guide/useVcOrganView.do"
REFERER = f"{BASE}/reg/gyeonggi/guide/useVcOrgan.do"

GEOCODE_URLS = [
    "https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode",
    "https://maps.apigw.ntruss.com/map-geocode/v2/geocode",
]

FIELDNAMES = [
    "organCd",
    "사용기관명", "지역", "주소", "홈페이지 주소",
    "전화번호", "검색 키워드", "대표 강좌 이름",
    "위도", "경도",
]

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Referer": REFERER,
    "X-Requested-With": "XMLHttpRequest",
})


def fetch_list(page_index: int, page_size: int = 10) -> str:
    data = {
        "pageIndex": str(page_index),
        "pageSize": str(page_size),
        "searchSidoCd": "",
        "searchLocalCd": "",
        "searchOrganNm": "",
        "searchKeyword": "",
        "searchChkCates": "",
    }
    r = session.post(LIST_URL, data=data, timeout=30)
    r.raise_for_status()
    r.encoding = r.apparent_encoding or "utf-8"
    return r.text


def parse_total_count(html: str) -> int:
    m = re.search(r"var\s+tottalCnt\s*=\s*(\d+)", html)
    return int(m.group(1)) if m else 0


def parse_list(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    rows = soup.select("div.list_items.mobile div.item_row")
    out = []
    for row in rows:
        onclick = row.get("onclick", "")
        m = re.search(r"fnEduEetail\('([^']+)'\)", onclick)
        organ_cd = m.group(1) if m else ""

        items = {}
        for item in row.select(".item"):
            tit = item.select_one(".tit")
            cnt = item.select_one(".cnt")
            if tit and cnt:
                items[tit.get_text(strip=True)] = cnt.get_text(" ", strip=True)

        addr = ""
        homepage = ""
        for a in row.select(".devides a"):
            href = a.get("href", "")
            m_addr = re.search(r"fnOpenModalMapPopup\('([^']*)',\s*'([^']*)',\s*'([^']*)'\)", href)
            if m_addr:
                addr_main = m_addr.group(2).strip()
                addr_detail = m_addr.group(3).strip()
                addr = (addr_main + " " + addr_detail).strip()
            m_url = re.search(r"checkUrl\('([^']+)'\)", href)
            if m_url:
                homepage = m_url.group(1).strip()

        out.append({
            "organCd": organ_cd,
            "기관명_list": items.get("사용기관명", ""),
            "지역": items.get("지역", "").replace("\xa0", " "),
            "주소_list": addr,
            "홈페이지_list": homepage,
        })
    return out


def fetch_detail(organ_cd: str) -> str:
    data = {"organCd": organ_cd, "pageIndex": "1", "pageSize": "10"}
    r = session.post(DETAIL_URL, data=data, timeout=30)
    r.raise_for_status()
    r.encoding = r.apparent_encoding or "utf-8"
    return r.text


def parse_detail(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    info: dict[str, str] = {}
    for tr in soup.select("table tr"):
        ths = tr.find_all("th")
        tds = tr.find_all("td")
        for th, td in zip(ths, tds):
            key = th.get_text(strip=True)
            val_div = td.select_one(".td_content") or td
            val = val_div.get_text(" ", strip=True)
            val = re.sub(r"\s+", " ", val).strip()
            info[key] = val

    courses: list[str] = []
    course_table = None
    for h3 in soup.select("h3.circle_title"):
        if "대표강좌" in h3.get_text():
            sec = h3.find_parent("div")
            if sec:
                course_table = sec.select_one("table")
            break
    if course_table:
        for tr in course_table.select("tbody tr"):
            tds = tr.find_all("td")
            if tds:
                first = tds[0].get_text(" ", strip=True)
                if first and "대표강좌가 없습니다" not in first:
                    courses.append(first)

    frm_pop_addr = ""
    frm_pop_detail = ""
    frm = soup.find("form", attrs={"name": "frmPop"})
    if frm:
        a = frm.find("input", {"id": "addr"})
        d = frm.find("input", {"id": "detailAddr"})
        if a:
            frm_pop_addr = a.get("value", "")
        if d:
            frm_pop_detail = d.get("value", "")

    homepage = ""
    for th in soup.find_all("th"):
        if th.get_text(strip=True) == "홈페이지 주소":
            td = th.find_next("td")
            if td:
                a = td.find("a")
                if a:
                    href = a.get("href", "")
                    m = re.search(r"checkUrl\('([^']+)'\)", href)
                    if m:
                        homepage = m.group(1)
                    else:
                        homepage = a.get_text(strip=True)
                else:
                    homepage = td.get_text(" ", strip=True)
            break

    return {
        "기관명": info.get("기관명", ""),
        "주소_detail": info.get("주소", "") or f"{frm_pop_addr} {frm_pop_detail}".strip(),
        "전화번호": info.get("전화번호", ""),
        "홈페이지_detail": homepage,
        "검색키워드": info.get("검색 키워드", ""),
        "대표강좌": " | ".join(courses),
    }


_active_geo_url: str | None = None


def clean_address(addr: str) -> str:
    s = addr or ""
    s = re.sub(r"^\(\d{5}\)\s*", "", s)
    s = re.sub(r"\s*지도보기\s*$", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def address_fallbacks(addr: str) -> list[str]:
    s = clean_address(addr)
    cands = [s]
    m = re.match(r"^(.*?\d+(?:-\d+)?)\b", s)
    if m and m.group(1) != s:
        cands.append(m.group(1).strip())
    parts = s.split()
    if len(parts) >= 4:
        cands.append(" ".join(parts[:4]))
    if len(parts) >= 3:
        cands.append(" ".join(parts[:3]))
    seen, out = set(), []
    for c in cands:
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    return out


def geocode_once(query: str, headers: dict) -> tuple[str, str] | None:
    global _active_geo_url
    urls = [_active_geo_url] if _active_geo_url else GEOCODE_URLS
    for url in urls:
        try:
            r = requests.get(url, params={"query": query}, headers=headers, timeout=15)
        except requests.RequestException as e:
            print(f"  geo error: {e}", file=sys.stderr)
            continue
        if r.status_code == 200:
            _active_geo_url = url
            data = r.json()
            if data.get("status") != "OK":
                return None
            addrs = data.get("addresses") or []
            if not addrs:
                return None
            a = addrs[0]
            return a.get("y", ""), a.get("x", "")
    return None


def geocode(addr: str, headers: dict) -> tuple[str, str]:
    for q in address_fallbacks(addr):
        res = geocode_once(q, headers)
        time.sleep(0.05)
        if res:
            return res[0], res[1]
    return "", ""


def load_existing(out_path: str) -> dict[str, dict]:
    rows: dict[str, dict] = {}
    p = Path(out_path)
    if p.exists():
        with open(out_path, "r", encoding="utf-8-sig", newline="") as f:
            r = csv.DictReader(f)
            for row in r:
                for fn in FIELDNAMES:
                    row.setdefault(fn, "")
                rows[row.get("organCd", "")] = row
    return rows


def save(rows: dict[str, dict], out_path: str) -> None:
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES)
        w.writeheader()
        for v in rows.values():
            w.writerow({k: v.get(k, "") for k in FIELDNAMES})
    os.replace(tmp, out_path)


def run(out_path: str, page_size: int, skip_geocode: bool,
        sleep_list: float, sleep_detail: float, save_every: int) -> None:
    headers = None
    if not skip_geocode:
        ncp_id = os.environ.get("NCP_API_KEY_ID")
        ncp_key = os.environ.get("NCP_API_KEY")
        if ncp_id and ncp_key:
            headers = {
                "X-NCP-APIGW-API-KEY-ID": ncp_id,
                "X-NCP-APIGW-API-KEY": ncp_key,
                "Accept": "application/json",
                "Referer": "http://localhost",
            }
        else:
            print("경고: NCP 키 없음 — 위경도 빈 값으로 처리", file=sys.stderr)

    existing = load_existing(out_path)
    print(f"기존 데이터: {len(existing)}건", file=sys.stderr, flush=True)

    first_html = fetch_list(1, page_size)
    total = parse_total_count(first_html)
    if total == 0:
        print("총 건수 파싱 실패", file=sys.stderr)
        return
    total_pages = (total + page_size - 1) // page_size
    print(f"총 {total}건 / {total_pages}페이지", file=sys.stderr, flush=True)

    new_count = 0
    geo_ok = 0
    geo_fail = 0
    start = time.time()
    for page in range(1, total_pages + 1):
        if page == 1:
            html = first_html
        else:
            html = fetch_list(page, page_size)
            time.sleep(sleep_list)

        items = parse_list(html)
        for it in items:
            cd = it["organCd"]
            if not cd:
                continue
            row = existing.get(cd, {})
            need_detail = not row or not row.get("사용기관명") or not row.get("주소")
            if need_detail:
                try:
                    d = parse_detail(fetch_detail(cd))
                except Exception as e:
                    print(f"  상세 오류 ({cd[:12]}): {e}", file=sys.stderr)
                    continue
                row = {
                    "organCd": cd,
                    "사용기관명": d["기관명"] or it["기관명_list"],
                    "지역": it["지역"],
                    "주소": d["주소_detail"] or it["주소_list"],
                    "홈페이지 주소": d["홈페이지_detail"] or it["홈페이지_list"],
                    "전화번호": d["전화번호"],
                    "검색 키워드": d["검색키워드"],
                    "대표 강좌 이름": d["대표강좌"],
                    "위도": row.get("위도", ""),
                    "경도": row.get("경도", ""),
                }
                new_count += 1
                time.sleep(sleep_detail)

            if headers and not row.get("위도"):
                lat, lng = geocode(row.get("주소", ""), headers)
                row["위도"] = lat
                row["경도"] = lng
                if lat:
                    geo_ok += 1
                else:
                    geo_fail += 1

            existing[cd] = row

        if page % save_every == 0 or page == total_pages:
            save(existing, out_path)
            elapsed = time.time() - start
            rate = page / elapsed if elapsed > 0 else 0
            eta = (total_pages - page) / rate if rate > 0 else 0
            print(f"[{page}/{total_pages}] saved={len(existing)} new+={new_count} "
                  f"geo_ok+={geo_ok} geo_fail+={geo_fail} elapsed={elapsed:.0f}s eta={eta:.0f}s",
                  file=sys.stderr, flush=True)

    print(f"완료. 총 {len(existing)}건. 신규 {new_count}, 지오 성공 {geo_ok}, 실패 {geo_fail}",
          file=sys.stderr, flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data.csv")
    ap.add_argument("--page-size", type=int, default=10)
    ap.add_argument("--skip-geocode", action="store_true")
    ap.add_argument("--sleep-list", type=float, default=0.3)
    ap.add_argument("--sleep-detail", type=float, default=0.2)
    ap.add_argument("--save-every", type=int, default=5)
    args = ap.parse_args()
    run(args.out, args.page_size, args.skip_geocode,
        args.sleep_list, args.sleep_detail, args.save_every)
