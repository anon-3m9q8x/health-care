"""ローソン公式「オリジナル商品」の一覧→商品ページを 1req/s で取得（取得済みは飛ばす）"""
import re, subprocess, time, os, sys, json, hashlib
BASE='https://www.lawson.co.jp'; UA='NutriPath-personal-import/1.0 (personal nutrition app; 1 req/s)'
OUT=sys.argv[1]; os.makedirs(f'{OUT}/list',exist_ok=True); os.makedirs(f'{OUT}/detail',exist_ok=True)
def get(path,fn):
    if os.path.exists(fn) and os.path.getsize(fn)>2000: return open(fn,encoding='utf-8',errors='replace').read()
    for a in range(4):
        r=subprocess.run(['curl','-s','-A',UA,'-w','%{http_code}','-o',fn,BASE+path],capture_output=True,text=True); time.sleep(1.2)
        if r.stdout=='200': return open(fn,encoding='utf-8',errors='replace').read()
        if r.stdout=='404': print('404',path,flush=True); return ''
        print('ERR',r.stdout,path,flush=True); time.sleep(10*(a+1))
    return ''
seeds=['/recommend/original/select/index.html']
queue=list(seeds); seen=set(); details={}
while queue:
    p=queue.pop(0)
    if p in seen: continue
    seen.add(p)
    s=get(p,f"{OUT}/list/{hashlib.md5(p.encode()).hexdigest()}.html")
    for h in re.findall(r'href="(/recommend/original/[^"#?]*)"',s):
        if '/detail/' in h:
            m=re.search(r'detail/(\d+_\d+)\.html',h)
            if m: details.setdefault(m.group(1),p)
        elif '/daily/' not in h and (h.endswith('/') or h.endswith('.html')):
            if h.endswith('/'): h+='index.html'
            if h not in seen: queue.append(h)
    print('LIST',len(seen),len(queue),len(details),p,flush=True)
json.dump({'pages':sorted(seen),'details':details},open(f'{OUT}/index.json','w'),ensure_ascii=False)
for i,(d,src) in enumerate(details.items()):
    get(f'/recommend/original/detail/{d}.html',f'{OUT}/detail/{d}.html')
    if i%50==0: print('DETAIL',i,len(details),flush=True)
print('DONE',len(details),flush=True)
