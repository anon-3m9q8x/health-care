import re,json,html,glob,os,sys
SHOPS={"shinpachi-shokudo":"しんぱち食堂","yayoi-ken":"やよい軒","ootoya":"大戸屋","obondegohan":"おぼんdeごはん","shirokujichu":"四六時中","komeraku":"こめらく","negishi":"牛たんねぎし","machikadoya":"街かど屋","sendai-henmi":"牛たん焼き 仙台辺見","tsukiji-genchan":"築地食堂 源ちゃん","rikyu-gyutan":"牛たん炭焼 利久","miyamoto-munashi":"宮本むなし","manten-shokudo":"満天食堂","hirai":"おべんとうのヒライ","torafuku":"寅福","hyakusai":"定食屋百菜 旬","sendai-gyutan-aoba":"仙台 牛たん 青葉","dashichazuke-en":"だし茶漬け えん"}
src=sys.argv[1]; out=[]; totals={}
def num(x):
    x=x.replace(',','')
    return float(x) if x else None
for slug,name in SHOPS.items():
    files=sorted(glob.glob(f"{src}/{slug}_*.html"),key=lambda p:int(re.search(r'_(\d+)\.html',p).group(1)))
    seen={};order=[]
    for fn in files:
        s=open(fn).read()
        if not totals.get(slug):
            m=re.search(r'全(\d+)品',s); totals[slug]=int(m.group(1)) if m else None
        s=s.replace('<!-- -->','')
        for c in re.split(r'data-product-card(?:="true")?[\s>]',s)[1:]:
            m=re.search(r"data-product-id=\"(\d+)\"",c[:1500])
            if not m: continue
            pid=m.group(1)
            nm=re.search(r'data-product-name(?:="true")?[^>]*>(.*?)</p>',c,re.S)
            nm=html.unescape(re.sub(r'<[^>]+>','',nm.group(1))).strip() if nm else None
            mm=re.search(r'data-product-meta(?:="true")?[^>]*>(.*?)</div>',c,re.S)
            pr=re.search(r'¥\s*([\d,]+)',mm.group(1)) if mm else None
            pr=int(pr.group(1).replace(',','')) if pr else None
            nut=c[c.find('data-product-nutrition'):]
            t=re.sub(r'\s+','',re.sub(r'<[^>]+>',' ',nut[:4000]))
            k=re.search(r'([\d.,]+)kcal',t)
            P=re.search(r'P([\d.]+)g',t);F=re.search(r'F([\d.]+)g',t);C=re.search(r'C([\d.]+)g',t)
            est='AIによる推定値' in nut[:3000]
            item=({"slug":slug,"store":name,"pid":pid,"name":nm,"price":pr,"kcal":num(k.group(1)) if k else None,
                        "protein":float(P.group(1)) if P else None,"fat":float(F.group(1)) if F else None,"carbs":float(C.group(1)) if C else None,"ai":est})
            if pid in seen and (item['kcal'] is None or seen[pid]['kcal'] is not None): continue
            if pid not in seen: order.append(pid)
            seen[pid]=item
    out.extend(seen[p] for p in order)
    print(name,totals.get(slug),len(seen),file=sys.stderr)
json.dump({"shops":SHOPS,"totals":totals,"items":out},open(sys.argv[2],'w'),ensure_ascii=False,indent=0)
