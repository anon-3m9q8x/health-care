/* NutriPath — product label reading and content-based (想定) nutrition estimates. */
(()=>{'use strict';
const z2h=s=>String(s||'').replace(/[０-９．，％]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/[ｇＧ]/g,'g').replace(/ｍ/g,'m').replace(/ｋ/g,'k').replace(/ｃ/g,'c').replace(/ａ/g,'a').replace(/ｌ/g,'l').replace(/ｍｌ|ｍＬ/g,'ml').replace(/[　\t]+/g,' ');
const num=s=>{const n=Number(String(s).replace(/,/g,''));return Number.isFinite(n)?n:null};
// value right after a label, allowing OCR noise such as ":", "…", spaces and line breaks
function after(t,labels,unit){for(const l of labels){const re=new RegExp(l+'[^0-9\\n]{0,12}?([0-9]+(?:\\.[0-9]+)?)\\s*'+(unit||''),'i');const m=t.match(re);if(m)return num(m[1])}return null}
/** Parse OCR text of a package/receipt/menu photo. Values are per package when the label is per 100 g and the weight is known. */
function parseLabel(raw){
 const t=z2h(raw).replace(/\r/g,'');const v={};let matched=0;const notes=[];
 const kcal=after(t,['エネルギー','熱量','エネル[ギキ]ー?','kcal'],'k?cal')??after(t,['エネルギー','熱量'],'');
 if(kcal!=null){v.kcal=kcal;matched++}
 const map=[['protein',['たんぱく質','たん白質','蛋白質','タンパク質','たんぱく']],['fat',['脂質','脂 質']],['carbs',['炭水化物','炭水化']],['fiber',['食物繊維','食物纖維']],['salt',['食塩相当量','食塩相当','食塩']]];
 for(const [k,labels] of map){const x=after(t,labels,'g');if(x!=null){v[k]=x;matched++}}
 if(v.carbs==null){const sugar=after(t,['糖質'],'g');if(sugar!=null){v.carbs=+(sugar+(v.fiber||0)).toFixed(1);matched++;notes.push('炭水化物は糖質＋食物繊維から算出')}}
 if(v.salt==null){const na=after(t,['ナトリウム'],'mg');if(na!=null){v.salt=+(na*2.54/1000).toFixed(2);matched++;notes.push('食塩相当量はナトリウムから換算')}}
 const w=t.match(/内容量[^0-9\n]{0,6}([0-9]+(?:\.[0-9]+)?)\s*(g|ml|mL)/i)||t.match(/([0-9]{2,4})\s*(g|ml)\b(?![^\n]*当)/i);if(w){v.weight=num(w[1])}
 const per100=/100\s*(g|ml)\s*(当|あた|あたり|当た)/i.test(t);
 if(per100&&v.weight){for(const k of ['kcal','protein','fat','carbs','fiber','salt'])if(v[k]!=null)v[k]=+(v[k]*v.weight/100).toFixed(k==='kcal'?0:1);notes.push(`表示は100g当たり。内容量${v.weight}gで換算`)}
 else if(per100)notes.push('表示は100g当たりです。内容量を入力すると1個分に換算できます');
 v.per100=per100&&!v.weight;
 const price=t.match(/(?:税込|税込み|本体価格)?\s*[¥￥]\s*([0-9,]{2,6})/)||t.match(/([0-9,]{2,6})\s*円/);if(price){v.price=num(price[1]);matched++}
 const ing=t.match(/原材料名?[\s:：]*([\s\S]{4,400}?)(?:\n\s*\n|内容量|賞味期限|消費期限|保存方法|製造者|販売者|栄養成分|$)/);if(ing)v.ingredients=ing[1].replace(/\s+/g,'').slice(0,300);
 const nm=t.match(/(?:商品名|品名)[\s:：]*([^\n]{2,40})/),generic=t.match(/名称[\s:：]*([^\n]{2,40})/);if(nm)v.name=nm[1].trim();
 else{const line=t.split('\n').map(s=>s.trim()).find(s=>s.length>=2&&s.length<=30&&!/[0-9]/.test(s)&&!/栄養|成分|原材料|表示|当たり/.test(s)&&/[ぁ-んァ-ヶ一-龠]/.test(s));if(line)v.name=line;else if(generic)v.name=generic[1].trim()}
 return {values:v,matched,notes};
}
// per 100 g: kcal, protein, fat, carbs, salt, fiber; [keywords], cap = max share for seasonings
const ING=[
 [['ご飯','米飯','精白米','うるち米','米（','国産米','米'],[156,2.5,0.3,37.1,0,1.5]],[['もち米'],[186,3.5,0.5,41,0,0.4]],
 [['小麦粉'],[349,8.3,1.5,75.8,0,2.5]],[['パン','パン粉'],[260,9,4.5,47,1.2,3]],[['うどん'],[95,2.6,0.4,21.6,0.3,1.3]],
 [['そば'],[130,4.8,1,26,0,2.9]],[['中華麺','めん','麺'],[133,4.9,0.6,27.9,0.2,2.8]],[['スパゲッティ','パスタ','マカロニ'],[150,5.8,0.9,32.2,0,3]],
 [['唐揚げ','からあげ','から揚げ','フライドチキン'],[260,18,16,11,1.2,0.4]],[['鶏肉','鶏むね','鶏もも','チキン','若鶏'],[150,20,7,0.1,0.2,0]],[['豚肉','豚ロース','豚ばら','ポーク'],[250,17,20,0.2,0.1,0]],
 [['牛肉','ビーフ'],[300,15,26,0.3,0.1,0]],[['ハム'],[211,18.6,14.5,2,2.3,0]],[['ベーコン'],[400,12.9,39.1,0.3,2,0]],
 [['ソーセージ','ウインナー'],[319,11.5,30.6,3.3,1.9,0]],[['鮭','さけ','サーモン'],[180,22,10,0.1,1,0]],
 [['まぐろ','ツナ'],[120,24,2,0.1,0.4,0]],[['さば','サバ'],[230,20,16,0.3,0.5,0]],[['えび'],[91,20.9,0.3,0.2,0.4,0]],
 [['いか'],[76,17.9,0.8,0.1,0.5,0]],[['たらこ','明太子'],[121,21,3.3,3,5.6,0]],[['魚肉','すり身','かまぼこ','ちくわ'],[100,12,1,11,2.2,0]],
 [['卵','鶏卵','たまご'],[142,12.2,10.2,0.4,0.4,0]],[['豆腐'],[70,6.5,4.5,1.6,0,1]],[['納豆'],[190,16.5,10,12.1,0,6.7]],
 [['大豆'],[180,15,9,8,0,8]],[['チーズ'],[313,22.7,26,1.3,2.8,0]],[['牛乳','乳'],[61,3.3,3.8,4.8,0.1,0]],
 [['ヨーグルト'],[60,3.6,3,6,0.1,0]],[['クリーム','バター'],[600,1.5,62,4,0.5,0]],
 [['キャベツ'],[21,1.3,0.2,5.2,0,1.8]],[['レタス'],[11,0.6,0.1,2.8,0,1.1]],[['トマト'],[20,0.7,0.1,4.7,0,1]],
 [['玉ねぎ','たまねぎ','オニオン'],[33,1,0.1,8.4,0,1.5]],[['にんじん','人参'],[35,0.7,0.2,8.7,0.1,2.4]],
 [['じゃがいも','ばれいしょ','ポテト'],[76,1.6,0.1,17.6,0,1.3]],[['ブロッコリー'],[37,5.4,0.6,6.6,0.1,5.1]],
 [['ほうれん草','ほうれんそう'],[20,2.2,0.4,3.1,0,2.8]],[['きのこ','しめじ','しいたけ','えのき'],[22,2.7,0.3,4.5,0,3]],
 [['ごぼう'],[58,1.8,0.1,15.4,0,5.7]],[['ねぎ'],[35,1.4,0.1,8.3,0,2.5]],[['大根'],[15,0.4,0.1,4.1,0,1.4]],
 [['野菜'],[25,1.2,0.2,5.5,0,1.8]],[['海藻','わかめ','ひじき','昆布'],[20,1.5,0.3,6,1,5],0.12],[['のり','海苔'],[188,41,3.7,44,1.3,36],0.03],
 [['バナナ'],[93,1.1,0.2,22.5,0,1.1]],[['りんご'],[53,0.1,0.2,15.5,0,1.4]],[['果汁','果物','フルーツ'],[50,0.5,0.1,12,0,0.8]],
 [['あん','小豆'],[244,5.6,0.6,54,0,5.7]],[['チョコレート','ココア'],[550,7,34,56,0.2,3.9]],[['ナッツ','アーモンド','ピーナッツ'],[600,19,52,22,0,7]],
 [['マヨネーズ'],[668,1.4,72.5,3.6,1.9,0],0.12],[['ドレッシング'],[250,1,23,10,4,0.2],0.1],
 [['植物油','植物油脂','食用油','なたね油','ショートニング','油'],[921,0,100,0,0,0],0.08],
 [['砂糖','糖類','ぶどう糖','果糖','水あめ','異性化糖'],[390,0,0,98,0,0],0.1],
 [['醤油','しょうゆ','しょう油'],[77,7.7,0,7.9,14.5,0],0.05],[['みそ','味噌'],[182,12.5,6,21.9,12.4,4.9],0.06],
 [['食塩','塩'],[0,0,0,0,99.5,0],0.006],[['でん粉','澱粉','でんぷん'],[339,0.1,0.1,83,0,0],0.06],
 [['カレー'],[100,2.5,5,11,1.1,1.2]],[['ソース','たれ'],[130,2,0,30,6,0.5],0.1],[['スープ','だし'],[10,0.6,0,1,1,0],0.3],
];
// typical package weight when the label does not show it
const SERVING=[[/おにぎり|むすび/,110],[/弁当/,420],[/丼/,450],[/定食/,550],[/サンド|バーガー/,150],[/パン/,90],[/サラダ/,150],[/ラーメン|うどん|そば|パスタ|スパゲッティ|焼きそば|麺/,380],[/スープ|汁/,200],[/ヨーグルト/,100],[/チキン|唐揚げ|からあげ/,90],[/ドリンク|茶|コーヒー|ジュース|牛乳|飲料/,300],[/プリン|ケーキ|シュー/,100]];
function servingWeight(name){for(const [re,g] of SERVING)if(re.test(name||''))return g;return 150}
function bigrams(s){s=String(s||'').replace(/[\s（）()・、。]/g,'');const out=new Set();for(let i=0;i<s.length-1;i++)out.add(s.slice(i,i+2));return out}
function similarity(a,b){const A=bigrams(a),B=bigrams(b);if(!A.size||!B.size)return 0;let n=0;for(const x of A)if(B.has(x))n++;return 2*n/(A.size+B.size)}
function round(v){return {kcal:Math.round(v[0]),protein:+v[1].toFixed(1),fat:+v[2].toFixed(1),carbs:+v[3].toFixed(1),salt:+v[4].toFixed(1),fiber:+v[5].toFixed(1)}}
/** Estimate nutrition from what the product contains. Returns null when nothing can be inferred. */
function estimate({name='',ingredients='',weight=null,catalog=[]}={}){
 const text=z2h(ingredients);
 // 1) ingredients list: Japanese labels list ingredients in descending order of weight
 if(text){
  const parts=text.replace(/[（(][^）)]*[）)]/g,'').split(/[、,，・\/]/).map(s=>s.trim()).filter(Boolean);
  const found=[];
  for(const p of parts){if(/^(調味料|pH|酸化防止剤|乳化剤|増粘|着色料|香料|保存料|膨張剤|甘味料|酸味料|加工でん粉|一部に)/.test(p))break;let best=null;for(const row of ING){for(const kw of row[0])if(p.includes(kw)&&(!best||kw.length>best.kw.length))best={kw,row}}if(best&&!found.some(f=>f.row===best.row))found.push(best);if(found.length>=8)break}
  if(found.length){
   const total=weight||servingWeight(name);let shares=found.map((_,i)=>Math.pow(0.45,i));const sum=shares.reduce((a,b)=>a+b,0);shares=shares.map(s=>s/sum);
   // cap seasonings and give the excess back to the main ingredient
   let excess=0;shares=shares.map((s,i)=>{const cap=found[i].row[2];if(cap!=null&&s>cap){excess+=s-cap;return cap}return s});shares[0]+=excess;
   const acc=[0,0,0,0,0,0];found.forEach((f,i)=>{const g=total*shares[i];for(let k=0;k<6;k++)acc[k]+=f.row[1][k]*g/100});
   return {...round(acc),basis:`原材料（${found.map(f=>f.kw).join('・')}）と${weight?'内容量'+weight+'g':'想定量'+total+'g'}から推定`};
  }
 }
 // 2) the most similar known product
 if(name&&catalog.length){const TYPE=/弁当|丼|定食|おにぎり|むすび|寿司|サンド|バーガー|サラダ|スープ|汁|パン|ラーメン|うどん|そば|パスタ|スパゲッティ|カレー|ヨーグルト|プリン|ケーキ/g;const want=name.match(TYPE)||[];let best=null,score=0;for(const f of catalog){if(want.some(w=>!f.name.includes(w)))continue;const s=similarity(name,f.name);if(s>score){score=s;best=f}}
  if(best&&score>=0.4){const r={kcal:best.kcal,protein:best.protein,fat:best.fat,carbs:best.carbs,salt:best.salt,fiber:best.fiber??null};return {...r,basis:`似た商品「${best.name}」（${best.store}）の値から推定`,matchedPrice:best.price}}
 }
 // 3) words in the name alone
 if(name){const found=[];for(const row of ING)for(const kw of row[0])if((kw.length>=2||/^[鮭卵]$/.test(kw))&&name.includes(kw)&&!found.includes(row)&&row[2]==null){found.push(row);break}
  const riceShare=/おにぎり|むすび/.test(name)?0.88:/弁当|丼|定食|寿司|ライス/.test(name)?0.6:0;const rice=ING[0];
  if(found.length||riceShare){const total=weight||servingWeight(name);const acc=[0,0,0,0,0,0];const parts=found.filter(r=>r!==rice);const rest=parts.length?(1-riceShare)/parts.length:0;const use=[...(riceShare?[[rice,parts.length?riceShare:1]]:[]),...parts.map(r=>[r,rest])];
   use.forEach(([r,share])=>{for(let k=0;k<6;k++)acc[k]+=r[1][k]*total*share/100});acc[4]+=riceShare?total*0.004:0;return {...round(acc),basis:`商品名から内容（${['ご飯',...parts.map(r=>r[0][0])].slice(riceShare?0:1).join('・')}）と想定量${total}gを推定`}}}
 return null;
}
/** Small JPEG thumbnail (data URL) for the product list. */
function thumbnail(file,size=120){return new Promise(resolve=>{const url=URL.createObjectURL(file);const img=new Image();img.onload=()=>{try{const s=Math.min(1,size/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.width*s));c.height=Math.max(1,Math.round(img.height*s));c.getContext('2d').drawImage(img,0,0,c.width,c.height);const d=c.toDataURL('image/jpeg',.7);resolve(d.length<16000?d:null)}catch{resolve(null)}finally{URL.revokeObjectURL(url)}};img.onerror=()=>{URL.revokeObjectURL(url);resolve(null)};img.src=url})}
(typeof window!=="undefined"?window:globalThis).NutriFoodOCR={parseLabel,estimate,thumbnail,similarity};
if(typeof module!=='undefined')module.exports={parseLabel,estimate,similarity};
})();
