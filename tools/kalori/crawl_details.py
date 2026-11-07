import re,sys,time,json,os,subprocess,html
LIST=sys.argv[1]; OUT=sys.argv[2]; os.makedirs(OUT,exist_ok=True)
UA="NutriPath-personal-import/1.0 (personal nutrition app; 1 req/s)"
def get(u):
    for k in range(8):
        r=subprocess.run(["curl","-sS","--max-time","40","-A",UA,"-w","\n__CODE__%{http_code}",u],capture_output=True,text=True)
        body,_,code=r.stdout.rpartition("\n__CODE__")
        if code=="200": return body
        if code=="404": return None
        print("ERR",code,u,flush=True); time.sleep(min(600,45*(k+1)))
    return ""
def extract(s):
    d={}
    for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>',s,re.S):
        try: j=json.loads(m.group(1))
        except Exception: continue
        if j.get('@type')=='MenuItem':
            n=j.get('nutrition') or {}
            def g(k):
                v=n.get(k); 
                if v is None: return None
                m2=re.search(r'[\d.]+',str(v)); return float(m2.group()) if m2 else None
            d.update(kcal=g('calories'),protein=g('proteinContent'),fat=g('fatContent'),carbs=g('carbohydrateContent'),fiber=g('fiberContent'),sodium=g('sodiumContent'),name=j.get('name'))
        if j.get('@type')=='FAQPage':
            for q in j.get('mainEntity',[]):
                a=q.get('acceptedAnswer',{}).get('text','')
                m2=re.search(r'食塩相当量は([\d.]+)g',a)
                if m2: d['salt']=float(m2.group(1))
                if '公式の値' in q.get('name',''): d['source_text']=a
    t=d.get('source_text','')
    return d
items=json.load(open(LIST))['items']
items.sort(key=lambda it: it.get('kcal') is not None)
# 3番目の引数に tools/kalori_teishoku.json を渡すと、そこに商品ページの値がある商品は取り直さない
have=set()
if len(sys.argv)>3 and os.path.exists(sys.argv[3]):
    have={str(r['pid']) for r in json.load(open(sys.argv[3]))['items'] if r.get('detail')}
items=[it for it in items if str(it['pid']) not in have]
done=0
for it in items:
    fn=f"{OUT}/{it['pid']}.json"
    if os.path.exists(fn): continue
    s=get(f"https://kalori.jp/ja/shops/{it['slug']}/products/{it['pid']}/")
    if s is None: json.dump({"missing":True},open(fn,'w')); continue
    if not s: print("GIVEUP",it['pid'],flush=True); continue
    json.dump(extract(s),open(fn,'w'),ensure_ascii=False); done+=1
    print("OK",done,it['store'],it['name'],flush=True); time.sleep(2)
print("DONE",flush=True)
