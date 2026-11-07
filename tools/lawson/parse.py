"""取得した商品ページ → tools/lawson.json（名前・価格・栄養・単位・カテゴリ）"""
import re, json, html, sys, os, unicodedata
D=sys.argv[1]; idx=json.load(open(f'{D}/index.json'))
CAT={'rice':'おにぎり','sushi':'お寿司','bento':'お弁当','chilledbento':'チルド弁当','sandwich':'サンドイッチ','bakery':'ベーカリー','pasta':'パスタ','noodle':'麺','icecreem':'アイス','salad':'サラダ','osozai':'お惣菜','soup':'スープ','gratin':'グラタン・ドリア','konamono':'粉もの','fry':'揚げ物','chukaman':'中華まん','oden':'おでん','machikadochubo':'まちかど厨房','coffee':'コーヒー','dessert':'デザート','chilled':'チルド飲料','gateau':'焼菓子','kenkosnack':'菓子','liquor':'お酒','cutvegetable':'カット野菜・果物','meat':'加工肉','egg':'たまご','dairy':'乳製品','paste':'水産・練物','liquid':'豆腐・水物','pickles':'漬物','frozen':'冷凍食品','cupnoodle':'カップ麺','instant':'即席食品','drink':'飲料','snack':'菓子','jam':'嗜好食品','dry':'乾物','spice':'調味料','gentei':'注目商品'}
def cat_of(p):
    parts=p.split('/')[3:]
    for x in reversed(parts):
        if x in CAT: return CAT[x]
    return 'その他'
def txt(x): return re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>','',x))).strip()
def g(s,label):
    m=re.search(r'<dt>'+label+r'</dt>\s*<dd>([^<]*)</dd>',s)
    if not m: return None
    v=m.group(1).replace(',','')
    n=re.search(r'([\d.]+)',v); return float(n.group(1)) if n else None
import hashlib
best={}
for pg in idx['pages']:
    fn=f"{D}/list/{hashlib.md5(pg.encode()).hexdigest()}.html"
    if not os.path.exists(fn): continue
    c=cat_of(pg)
    if c in ('その他','注目商品'): continue
    for d in re.findall(r'detail/(\d+_\d+)\.html',open(fn,encoding='utf-8-sig',errors='replace').read()):
        best.setdefault(d,pg)
out=[]
for d,src in idx['details'].items():
    src=best.get(d,src)
    fn=f'{D}/detail/{d}.html'
    if not os.path.exists(fn): continue
    s=open(fn,encoding='utf-8-sig',errors='replace').read()
    m=re.search(r'<h2 class="ttl">(.*?)</h2>',s,re.S)
    if not m: continue
    name=unicodedata.normalize('NFKC',txt(m.group(1))).replace('　',' ')
    kcal=g(s,'熱量')
    if kcal is None: continue
    pr=re.search(r'<dl class="price">.*?<span>([\d,]+)</span>',s,re.S)
    unit=re.search(r'栄養成分<span>【(.*?)】',s)
    vol=re.search(r'<dt>規格（内容量）</dt><dd>(.*?)</dd>',s)
    out.append({'pid':d,'name':name,'cat':cat_of(src),'kcal':kcal,'protein':g(s,'たんぱく質'),'fat':g(s,'脂質'),'carbs':g(s,'炭水化物'),
      'sugar':g(s,'糖質'),'fiber':g(s,'食物繊維'),'salt':g(s,'食塩相当量'),'price':int(pr.group(1).replace(',','')) if pr else None,
      'unit':txt(unit.group(1)) if unit else None,'volume':txt(vol.group(1)) if vol else None})
json.dump(out,open(sys.argv[2],'w'),ensure_ascii=False,indent=0)
from collections import Counter
print(len(out),Counter(o['cat'] for o in out).most_common(),file=sys.stderr)
print('units',Counter((o['unit'] or '').split('当')[0][:6] for o in out).most_common(15),file=sys.stderr)
