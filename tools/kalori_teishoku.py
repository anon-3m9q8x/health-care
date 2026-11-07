#!/usr/bin/env python3
"""定食チェーン（kalori.jp「定食」カテゴリの全店舗）の商品データを NutriPath 用に変換する。

  python3 tools/kalori_teishoku.py [--cat fastfood] --merge LIST.json DETAILS_DIR   # 取得結果を tools/kalori_<cat>.json にまとめる
  python3 tools/kalori_teishoku.py [--cat fastfood]                                  # tools/kalori_<cat>.json → data_<cat>.js

--cat は teishoku（定食・既定）または fastfood（ファストフード：マクドナルド以外の10店舗。マクドナルドは公式表から作成済み）。

出典: https://kalori.jp/ja/shops/#shop-cat-teishoku （各商品ページ）。kalori は公式発表値と AI 推定値を区別して
掲載しており、その区別をそのまま quality（official / estimate）に引き継ぐ。食塩相当量が掲載されていない商品は、
同じ店舗の掲載値（kcal あたりの食塩）から算出し「想定」として表示する。食物繊維が未掲載の商品は不明（空欄）のまま。
"""
import json, re, sys, os, statistics, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CAT = 'teishoku'
if '--cat' in sys.argv:
    i = sys.argv.index('--cat'); CAT = sys.argv[i + 1]; del sys.argv[i:i + 2]
RAW = ROOT / 'tools' / f'kalori_{CAT}.json'
OUT = ROOT / f'data_{CAT}.js'

SHOPS = {  # kalori の掲載順ではなく、系統（定食チェーン → 海鮮 → 牛たん → お茶漬け → 弁当）の順
    'yayoi-ken': 'やよい軒', 'ootoya': '大戸屋', 'shinpachi-shokudo': 'しんぱち食堂', 'miyamoto-munashi': '宮本むなし',
    'machikadoya': '街かど屋', 'hyakusai': '定食屋百菜 旬', 'manten-shokudo': '満天食堂', 'shirokujichu': '四六時中',
    'obondegohan': 'おぼんdeごはん', 'torafuku': '寅福', 'tsukiji-genchan': '築地食堂 源ちゃん', 'negishi': '牛たんねぎし',
    'sendai-henmi': '牛たん焼き 仙台辺見', 'rikyu-gyutan': '牛たん炭焼 利久', 'sendai-gyutan-aoba': '仙台 牛たん 青葉',
    'komeraku': 'こめらく', 'dashichazuke-en': 'だし茶漬け えん', 'hirai': 'おべんとうのヒライ',
}
FF_SHOPS = {  # ハンバーガー → チキン → サンドイッチ → タコライス
    'mosburger': 'モスバーガー', 'freshness': 'フレッシュネスバーガー', 'burgerking': 'バーガーキング',
    'wendys-first-kitchen': 'ウェンディーズ・ファーストキッチン', 'zetteria': 'ゼッテリア', 'kuaaina': 'クア・アイナ', 'aw-okinawa': 'A&W',
    'kfc': 'ケンタッキーフライドチキン', 'subway': 'サブウェイ', 'tacorice-house': 'THE TACORICE HOUSE',
}
LABEL = {'teishoku': ('定食チェーン', '定食カテゴリ全18店舗', 'teishoku'), 'fastfood': ('ファストフード', 'ファストフードカテゴリのマクドナルド以外10店舗', 'fastfood')}[CAT]
if CAT == 'fastfood': SHOPS = FF_SHOPS

DRINK = re.compile(r'ドリンク|ジュース|ビール|酒|ハイボール|サワー|コーヒー|珈琲|紅茶|ウーロン茶|烏龍茶|ソーダ|ラムネ|カルピス|コーラ|ジンジャーエール')
SWEET = re.compile(r'デザート|アイス|パフェ|プリン|ケーキ|わらび餅|ぜんざい|あんみつ|ソフトクリーム|ジェラート|団子|だんご|大福|杏仁')
MEAL = re.compile(r'定食|膳|セット|朝食|朝定|モーニング|ランチ|プレート|弁当|べんとう|御重|お重|丼|重$|カレー|そば|蕎麦|うどん|麺|ラーメン|茶漬|雑炊|おじや|釜飯|釜めし|ビビンバ|チャーハン|炒飯|ちらし|焼きそば|にゅうめん')
SOUP = re.compile(r'味噌汁|みそ汁|豚汁|汁|スープ')
RICE = re.compile(r'ご飯|ごはん|ライス|おにぎり|おむすび|麦めし|麦飯')
SIDE = re.compile(r'小鉢|サラダ|漬物|お新香|香の物|納豆|玉子|卵|冷奴|とろろ|追加|トッピング|ドレッシング|ソース|のり|海苔|大盛|小盛|中盛|おかわり|替え|変更|単品|一品')


def kind_of(name, kcal):
    if CAT == 'fastfood':
        if DRINK.search(name) or re.search(r'シェイク|スムージー|ラテ|ティー|ルートビア|レモネード|ミルク', name): return 'drink'
        if SWEET.search(name) or re.search(r'パイ|サンデー|フロート|クッキー|ビスケット|チュロス|ドーナツ', name): return 'sweet'
        if re.search(r'セット|ボックス|BOX|パック|バーレル|ランチ|コンボ|タコライス|プレート|ボウル|ライス', name): return 'meal'
        if re.search(r'バーガー|サンド|ドッグ|ラップ|ブリトー|タコス|ロール|マフィン|ホットサンド|ツイスター|ピタ', name): return 'main'
        if re.search(r'ポテト|ナゲット|コールスロー|サラダ|スープ|オニオン|フライ|ビスケット|コーン|トッピング|追加|ソース', name) or kcal < 150: return 'side'
        return 'protein'
    if DRINK.search(name): return 'drink'
    if SWEET.search(name): return 'sweet'
    if (MEAL.search(name) or re.search(r'[（(][^）)]*(ご飯|ごはん|麦めし|ライス)[^）)]*[）)]', name)) and not re.search(r'単品|追加', name): return 'meal'
    if SOUP.search(name): return 'soup'
    if RICE.search(name) and kcal < 450: return 'rice'
    if re.search(r'サラダ|野菜|おひたし|和え', name): return 'vegetable'
    if SIDE.search(name) or kcal < 150: return 'side'
    return 'protein'


def classify(t):
    """kalori の「この栄養成分は公式の値ですか？」の回答文から、公式／一部補完／AI推定を判定する。"""
    if not t: return None
    if '公式に公開' in t: return 'partial' if re.search(r'推定|補完', t) else 'official'
    if re.search(r'推定|AI', t): return 'estimated'
    return None


def merge(list_path, details_dir):
    data = json.load(open(list_path, encoding='utf-8'))
    prev = {str(r['pid']): r for r in json.load(open(RAW, encoding='utf-8'))['items'] if r.get('detail')} if RAW.exists() else {}
    rows, missing = [], 0
    for it in data['items']:
        fn = Path(details_dir) / f"{it['pid']}.json"
        d = json.load(open(fn, encoding='utf-8')) if fn.exists() else {}
        if d.get('missing'):
            continue  # 掲載終了
        if not d and str(it['pid']) in prev:
            rows.append(prev[str(it['pid'])]); continue
        row = {k: it.get(k) for k in ('slug', 'pid', 'name', 'price', 'kcal', 'protein', 'fat', 'carbs', 'ai')}
        row['name'] = d.get('name') or row['name']
        if d:
            for k in ('kcal', 'protein', 'fat', 'carbs', 'fiber', 'salt', 'sodium'):
                if d.get(k) is not None: row[k] = d[k]
            row['src'] = classify(d.get('source_text', '')) or ('estimated' if it.get('ai') else None)
            row['detail'] = True
        if row.get('kcal') is None or row.get('protein') is None:
            missing += 1
            continue
        rows.append(row)
    totals = data.get('totals', {})
    rows = [r for r in rows if r['slug'] in SHOPS]
    totals = {k: v for k, v in data.get('totals', {}).items() if k in SHOPS}
    RAW.write_text(json.dumps({'fetched': '2026-11-08', 'source': f'https://kalori.jp/ja/shops/#shop-cat-{LABEL[2]}',
                               'site_totals': totals, 'items': rows}, ensure_ascii=False, indent=0) + '\n', encoding='utf-8')
    print(f'{len(rows)} items written, {missing} without nutrition yet', file=sys.stderr)


def build():
    raw = json.load(open(RAW, encoding='utf-8'))
    rows = raw['items']
    # 店舗ごとの kcal あたり食塩（掲載値がある商品から）→ 食塩未掲載商品の想定に使う
    ratio_all, ratio = [], {}
    for r in rows:
        salt = r.get('salt') if r.get('salt') is not None else (r['sodium'] * 2.54 / 1000 if r.get('sodium') is not None else None)
        r['_salt'] = salt
        if salt is not None and r['kcal'] and r['kcal'] >= 80:
            ratio.setdefault(r['slug'], []).append(salt / r['kcal']); ratio_all.append(salt / r['kcal'])
    base = statistics.median(ratio_all) if ratio_all else 0.0055
    out, seen = [], set()
    order = {slug: i for i, slug in enumerate(SHOPS)}
    rows.sort(key=lambda r: order.get(r['slug'], 99))
    for r in rows:
        store = SHOPS.get(r['slug'])
        if not store: continue
        name = re.sub(r'\s+', ' ', unicodedata.normalize('NFC', str(r['name']))).strip()
        kcal = round(float(r['kcal']))
        key = (store, name, kcal, r.get('protein'))
        if key in seen: continue
        seen.add(key)
        est = []
        src = r.get('src') or ('estimated' if r.get('ai') else 'official')
        salt = r['_salt']
        if salt is None and (re.fullmatch(r'(五穀|麦|白|十穀|雑穀)?(ご飯|ごはん|ライス|麦めし|麦飯)\s*[^、]*', name) or DRINK.search(name)) and not re.search(r'丼|定食|茶漬|カレー|ふりかけ|のり|海苔', name):
            salt = 0.0; est.append('salt')
        if salt is None:
            q = ratio.get(r['slug'])
            salt = kcal * (statistics.median(q) if q and len(q) >= 5 else base)
            est.append('salt')
        fiber = r.get('fiber')
        official = src in ('official', 'partial')
        label = '公式発表値' if src == 'official' else '公式値をAIが一部補完' if src == 'partial' else 'AI推定値'
        note = f'kalori.jp 掲載の{label}（2026-11-08取得）。' + ('食塩相当量は同店舗の掲載値からの想定。' if 'salt' in est else '') + ('価格は掲載時点の税込価格。' if r.get('price') is not None else '')
        f = {'id': 'k' + str(r['pid']), 'store': store, 'name': name, 'kcal': kcal,
             'protein': round(float(r['protein']), 1), 'fat': round(float(r.get('fat') or 0), 1), 'carbs': round(float(r.get('carbs') or 0), 1),
             'salt': round(salt, 1), 'price': r.get('price'), 'fiber': None if fiber is None else round(float(fiber), 1),
             'source': f"https://kalori.jp/ja/shops/{r['slug']}/products/{r['pid']}/", 'quality': 'official' if official else 'estimate',
             'note': note, 'time': 'any', 'kind': kind_of(name, kcal), 'price_type': 'exact'}
        if est: f['est'] = est
        out.append(f)
    header = (f'/* NutriPath {LABEL[0]}商品データ。tools/kalori_teishoku.py --cat {CAT} で生成。出典: kalori.jp（{LABEL[1]}）。\n'
              '   quality "official" は公式発表値、"estimate" は kalori の AI 推定値。est に含む項目は想定値。 */\n')
    OUT.write_text(header + 'window.SEED_FOODS=(window.SEED_FOODS||[]).concat(' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ');\n', encoding='utf-8')
    from collections import Counter
    print(len(out), dict(Counter(f['store'] for f in out)), file=sys.stderr)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--merge':
        merge(sys.argv[2], sys.argv[3])
    build()
