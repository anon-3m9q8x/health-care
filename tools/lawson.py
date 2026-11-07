#!/usr/bin/env python3
"""ローソン公式「オリジナル商品」（https://www.lawson.co.jp/recommend/original/select/index.html ほか各カテゴリ）の
商品ページの栄養成分表示・ローソン標準価格（税込）から、NutriPath 用の data_lawson.js を作る。

  python3 tools/lawson.py              # tools/lawson.json → data_lawson.js

tools/lawson.json は取得スクリプト（tools/lawson/crawl.py → parse.py）の出力。
アプリに既にある商品（data.js の公式値）と同名のものは除外する。100g・100ml 当たり表示の商品は、
内容量が分かる場合は1個（1本・1パック）当たりに換算し、分からない場合は表示単位を商品名に付ける。
"""
import json, re, sys, unicodedata, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'tools' / 'lawson.json'
OUT = ROOT / 'data_lawson.js'

KIND = {'おにぎり': 'rice', 'お寿司': 'meal', 'お弁当': 'meal', 'チルド弁当': 'meal', 'サンドイッチ': 'main', 'ベーカリー': 'main',
        'パスタ': 'meal', '麺': 'meal', 'グラタン・ドリア': 'meal', '粉もの': 'meal', '冷凍食品': 'meal', 'カップ麺': 'meal',
        'アイス': 'sweet', 'デザート': 'sweet', '焼菓子': 'sweet', '菓子': 'snack',
        'サラダ': 'vegetable', 'カット野菜・果物': 'vegetable', '漬物': 'side',
        'お惣菜': 'protein', '揚げ物': 'protein', '加工肉': 'protein', '水産・練物': 'protein', 'おでん': 'side', 'たまご': 'protein',
        '豆腐・水物': 'protein', '中華まん': 'main', 'スープ': 'soup', '即席食品': 'soup',
        'コーヒー': 'drink', '飲料': 'drink', 'チルド飲料': 'drink', 'お酒': 'drink', '乳製品': 'snack',
        '調味料': 'side', '乾物': 'side', '嗜好食品': 'snack'}
DRINK = re.compile(r'ラテ|コーヒー|珈琲|茶|ジュース|ドリンク|ミルク|ソーダ|水$|ウォーター|フラッペ|スムージー|ビール|サワー|ハイボール|酒')
SWEET = re.compile(r'プリン|ケーキ|シュー|ロール$|パフェ|アイス|大福|どら焼|ゼリー|ワッフル|クレープ|タルト|ドーナツ|もち|団子|だんご')


def kind_of(r):
    n, c = r['name'], r['cat']
    if c == '乳製品' and re.search(r'ml|ミルク|牛乳|ドリンク|ヨーグルト飲', n + (r.get('volume') or '')): return 'drink'
    if c in KIND: return KIND[c]
    if DRINK.search(n): return 'drink'
    if SWEET.search(n): return 'sweet'
    if re.search(r'おにぎり|むすび', n): return 'rice'
    if re.search(r'弁当|丼|カレー|パスタ|そば|うどん|ラーメン|焼そば|炒飯|チャーハン', n): return 'meal'
    if re.search(r'サンド|パン|バーガー|ドッグ|まん$', n): return 'main'
    if re.search(r'サラダ|野菜', n): return 'vegetable'
    return 'protein'


def norm(s):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', s)).lower()


def existing_names():
    js = "global.window={};for(const f of ['data.js'])require(process.argv[1]+'/'+f);" \
         "console.log(JSON.stringify(window.SEED_FOODS.filter(x=>x.store==='ローソン'&&x.quality==='official').map(x=>x.name)))"
    return {norm(n) for n in json.loads(subprocess.check_output(['node', '-e', js, str(ROOT)]))}


def per_pack(r):
    """100g/100ml 当たり表示 → 内容量で1パック当たりに換算。換算できなければ (倍率1, 表示単位)"""
    u = r.get('unit') or ''
    m = re.search(r'(\d+(?:\.\d+)?)\s*(g|ml|mL)当', u)
    if not m: return 1.0, None
    base = float(m.group(1))
    v = unicodedata.normalize('NFKC', r.get('volume') or '')
    vols = re.findall(r'(\d+(?:\.\d+)?)\s*(g|ml|mL|ｇ)(?![a-z])', v)
    if len(vols) == 1 and not re.search(r'[×x]|個|本|袋|枚', v.replace(vols[0][0], '', 1)):
        total = float(vols[0][0])
        if 0 < total <= 2000: return total / base, None
    return 1.0, u.replace('当たり', '').replace('当り', '')


def build():
    rows = json.load(open(RAW, encoding='utf-8'))
    have = existing_names()
    out, seen, skipped = [], set(), 0
    for r in rows:
        if r.get('protein') is None or r.get('fat') is None or r.get('carbs') is None: continue
        name = re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', r['name'])).strip()
        if norm(name) in have: skipped += 1; continue
        k, unitlabel = per_pack(r)
        price, ptype = r.get('price'), 'exact' if r.get('price') else 'approx'
        um = re.match(r'1(枚|個|本|切|袋|食)当', r.get('unit') or '')
        nm = re.search(r'(\d+)\s*(枚|個|本|切|袋|食)', unicodedata.normalize('NFKC', (r.get('volume') or '') + ' ' + name))
        if um and nm and nm.group(2) == um.group(1) and int(nm.group(1)) > 1 and not unitlabel:
            unitlabel = '1' + um.group(1)
            if price: price, ptype = round(price / int(nm.group(1))), 'approx'
        disp = name + (f'（{unitlabel}）' if unitlabel else '')
        key = norm(disp)
        if key in seen: continue
        seen.add(key)
        est = []
        salt = r.get('salt')
        if salt is None: salt = 0.0; est.append('salt')
        f = {'id': 'l' + r['pid'].split('_')[0], 'store': 'ローソン', 'name': disp, 'kcal': round(r['kcal'] * k),
             'protein': round(r['protein'] * k, 1), 'fat': round(r['fat'] * k, 1), 'carbs': round(r['carbs'] * k, 1),
             'salt': round(salt * k, 1), 'fiber': None if r.get('fiber') is None else round(r['fiber'] * k, 1),
             'price': price, 'source': f"https://www.lawson.co.jp/recommend/original/detail/{r['pid']}.html",
             'quality': 'official',
             'note': 'ローソン公式の栄養成分表示' + (f'（{r["unit"]}）を内容量{r["volume"]}で換算' if k != 1 else f'（{r["unit"]}）' if r.get('unit') else '')
                     + '・ローソン標準価格（税込、2026-11-08取得）。地域・改定により異なる場合があります。',
             'time': 'any', 'kind': kind_of(r), 'price_type': ptype, 'lawson_cat': r['cat']}
        if est: f['est'] = est
        out.append(f)
    header = ('/* NutriPath ローソン商品データ。tools/lawson.py で生成。出典: ローソン公式「オリジナル商品」各商品ページ'
              '（栄養成分表示・ローソン標準価格）。 */\n')
    OUT.write_text(header + 'window.SEED_FOODS=(window.SEED_FOODS||[]).concat(' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ');\n', encoding='utf-8')
    from collections import Counter
    print(len(out), 'items;', skipped, 'already in app;', dict(Counter(f['lawson_cat'] for f in out)), file=sys.stderr)


if __name__ == '__main__':
    build()
