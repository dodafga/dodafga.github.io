#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全站改動後檢查腳本（每次改完任何東西、結束前都要跑一遍）

用法：
    python3 tools/check_site.py                                  # 檢查正式站
    python3 tools/check_site.py --base http://localhost:8099      # 檢查本機
    python3 tools/check_site.py --json                            # 輸出 JSON

檢查項目：
  1. 每一頁 HTTP 200 + 完整渲染（非白屏）+ 無 JS 錯誤（pageerror / console.error）
  2. 所有 JS 檔案語法正確（node --check）
  3. 頁面引用的 asset 是否帶版本號（?v=）
  4. 水平溢出（scrollWidth > clientWidth）
  5. 殘留 camopen 造成的白屏（html.camopen 但相機沒開）

退出碼：0 = 全部通過，1 = 有失敗
"""
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request

PAGES = ['/', '/form/', '/photo/', '/log/', '/progress/', '/drive/', '/settings/', '/build/']
DEFAULT_BASE = 'https://dodafga.github.io'

# 這些 asset 必須帶版本號（改過就要更新，避免 iPhone 快取舊檔）
VERSIONED_ASSETS = ['core.js', 'daily-flow.js', 'cam.js', 'pile-fix.js', 'mat-side.js',
                    'legacy-merge.js', 'build-sep.js', 'build-cloud.js', 'drive-v2.js',
                    'drive-page.js', 'pile-measure.js', 'cloud-db.js']

results = []


def add(ok, kind, target, detail=''):
    results.append({'ok': ok, 'kind': kind, 'target': target, 'detail': detail})


def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers={'User-Agent': 'site-check/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


# ---------- 1. 頁面渲染 + JS 錯誤 + 溢出 ----------
def check_pages(base):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        add(False, 'page', '*', 'playwright 未安裝：pip install playwright && playwright install webkit')
        return
    with sync_playwright() as p:
        b = p.webkit.launch()
        ctx = b.new_context(
            viewport={'width': 390, 'height': 844},
            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) '
                       'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
        for path in PAGES:
            url = base.rstrip('/') + path
            pg = ctx.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
            pg.on('console', lambda m: errs.append('console.error: ' + m.text) if m.type == 'error' else None)
            try:
                resp = pg.goto(url, wait_until='load', timeout=45000)
                pg.wait_for_timeout(2500)
                status = resp.status if resp else 0
                add(status == 200, 'http', path, 'HTTP %s' % status)

                txt = pg.evaluate("document.body.innerText.trim().length")
                add(txt > 40, 'render', path, '可見文字 %d 字' % txt)

                stuck = pg.evaluate(
                    "(function(){try{var de=document.documentElement;"
                    "if(!de.classList.contains('camopen'))return false;"
                    "var m=document.getElementById('camModal');"
                    "return !m||!m.classList.contains('on');}catch(e){return false}})()")
                add(not stuck, 'camopen', path, '殘留 camopen 造成白屏' if stuck else 'ok')

                ov = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
                add(ov <= 2, 'overflow', path, '水平溢出 %dpx' % ov)

                add(not errs, 'js', path, '; '.join(errs[:3]) if errs else 'ok')
            except Exception as e:
                add(False, 'page', path, '例外：%s' % str(e)[:200])
            finally:
                pg.close()
        b.close()


# ---------- 2. JS 語法 ----------
def check_js_syntax(root):
    adir = os.path.join(root, 'assets')
    if not os.path.isdir(adir):
        add(False, 'syntax', 'assets/', '找不到 assets 目錄')
        return
    for fn in sorted(os.listdir(adir)):
        if not fn.endswith('.js'):
            continue
        fp = os.path.join(adir, fn)
        r = subprocess.run(['node', '--check', fp], capture_output=True, text=True)
        add(r.returncode == 0, 'syntax', 'assets/' + fn,
            (r.stderr or '').strip().split('\n')[0][:200] if r.returncode else 'ok')


# ---------- 3. asset 版本號 ----------
def check_versions(base):
    for path in PAGES:
        url = base.rstrip('/') + path
        try:
            st, body = fetch(url)
        except Exception as e:
            add(False, 'version', path, '無法取得頁面：%s' % str(e)[:120])
            continue
        html = body.decode('utf-8', 'ignore')
        for a in VERSIONED_ASSETS:
            for m in re.finditer(r'<script[^>]+src="([^"]*' + re.escape(a) + r'[^"]*)"', html):
                src = m.group(1)
                if '?v=' not in src:
                    add(False, 'version', path, '%s 沒有版本號：%s' % (a, src))
        add(True, 'version', path, 'ok')


# ---------- 4. 關鍵 asset 可取得 ----------
def check_assets_reachable(base):
    for a in VERSIONED_ASSETS:
        url = base.rstrip('/') + '/assets/' + a
        try:
            st, body = fetch(url)
            add(st == 200 and len(body) > 200, 'asset', 'assets/' + a,
                'HTTP %s, %d bytes' % (st, len(body)))
        except Exception as e:
            add(False, 'asset', 'assets/' + a, str(e)[:120])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default=DEFAULT_BASE)
    ap.add_argument('--root', default='.')
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()

    check_pages(args.base)
    check_js_syntax(args.root)
    check_versions(args.base)
    check_assets_reachable(args.base)

    fails = [r for r in results if not r['ok']]
    if args.json:
        print(json.dumps({'total': len(results), 'failed': len(fails), 'results': results},
                         ensure_ascii=False, indent=2))
    else:
        print('=' * 68)
        print('全站檢查結果  base=%s' % args.base)
        print('=' * 68)
        for r in results:
            print('%s [%-8s] %-22s %s' % ('PASS' if r['ok'] else 'FAIL',
                                          r['kind'], r['target'], r['detail']))
        print('-' * 68)
        print('總計 %d 項，通過 %d，失敗 %d' % (len(results), len(results) - len(fails), len(fails)))
        if fails:
            print('\n失敗清單：')
            for r in fails:
                print('  ✗ %s / %s → %s' % (r['kind'], r['target'], r['detail']))
        print('=' * 68)
    sys.exit(0 if not fails else 1)


if __name__ == '__main__':
    main()
