import re,sys,time,json,html,os,urllib.request
OUT=sys.argv[1]; os.makedirs(OUT,exist_ok=True)
CAT=sys.argv[2] if len(sys.argv)>2 else "teishoku"
SH=list(json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"shops.json")))[CAT])
UA="NutriPath-personal-import/1.0 (personal nutrition app; 1 req/s)"
import subprocess
def get(u):
    for k in range(6):
        r=subprocess.run(["curl","-sS","--max-time","40","-A",UA,"-w","\n__CODE__%{http_code}",u],capture_output=True,text=True)
        body,_,code=r.stdout.rpartition("\n__CODE__")
        if code=="200": return body
        print("ERR",code,u,flush=True); time.sleep(30*(k+1))
    return ""
for sh in SH:
    p=1
    while True:
        fn=f"{OUT}/{sh}_{p}.html"
        if not os.path.exists(fn) or os.path.getsize(fn)<1000:
            u=f"https://kalori.jp/ja/shops/{sh}/products/"+("" if p==1 else f"page/{p}/")
            s=get(u); open(fn,"w").write(s); time.sleep(2)
        s=open(fn).read()
        mx=max([int(x) for x in re.findall(rf'/ja/shops/{sh}/products/page/(\d+)/',s)]+[1])
        print(sh,p,mx,s.count('data-product-card="true"'),flush=True)
        if p>=mx: break
        p+=1
