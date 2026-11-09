/* On-device OCR-text parsing helpers. OCR itself is loaded on demand by the UI. */
(function(root){'use strict';
 const ranges={height:[90,250],weight:[20,350],waist:[35,220],bodyFat:[2,70],alt:[0,3000],ast:[0,3000],tg:[0,2000],hdl:[0,300],ldl:[0,500],glucose:[20,700],hba1c:[2,20],systolic:[50,260],diastolic:[35,160]};
 function normalize(text){return String(text||'').normalize('NFKC').replace(/([A-Z])\s+(?=[A-Z])/g,'$1').replace(/[，,]/g,'.').replace(/[／]/g,'/').replace(/\r/g,'\n')}
 function nums(s){return (String(s||'').match(/\d+(?:\.\d+)?/g)||[]).map(Number).filter(Number.isFinite)}
 function chooseNumber(tail,min,max){const values=nums(tail).filter(v=>v>=min&&v<=max);if(!values.length)return null;return values[values.length-1]}
 const patterns={
 height:/(?:身\s*長|height)\s*[:：]?/i,
 weight:/(?:(?<!脂\s*肪\s*)体\s*重|weight)\s*[:：]?/i,
 waist:/(?:腹\s*囲|ウエスト|waist)\s*[:：]?/i,
 bodyFat:/(?:体\s*脂\s*肪\s*率|体\s*脂\s*肪(?!\s*量)|body\s*fat)\s*[:：]?/i,
 alt:/(?:ALT\s*(?:\(?GPT\)?)?|GPT\b)/i,
 ast:/(?:AST\s*(?:\(?GOT\)?)?|GOT\b)/i,
 tg:/(?:中\s*性\s*脂\s*肪|トリグリセリド|triglycerides?)/i,
 hdl:/(?:HDL\s*(?:コレステロール)?)/i,
 ldl:/(?:LDL\s*(?:コレステロール)?)/i,
 glucose:/(?:空\s*腹\s*時\s*血\s*糖|血\s*糖|glucose)/i,
 hba1c:/(?:Hb\s*A\s*1\s*c)/i
 };
 function parse(text){
   const raw=normalize(text);const lines=raw.split('\n').map(l=>l.trim()).filter(Boolean);
   const out={},evidence={};
   for(const [key,rx] of Object.entries(patterns)){
     const [lo,hi]=ranges[key];
     for(let i=0;i<lines.length;i++){
       const line=lines[i];const m=rx.exec(line);if(!m)continue;
       let tail=line.slice(m.index+m[0].length).slice(0,85);
       // The most reliable case is a labeled row. Avoid guessing from unrelated adjacent rows.
       const v=chooseNumber(tail,lo,hi);
       if(v!=null){out[key]=v;evidence[key]=line;break}
       if(i+1<lines.length && !/[A-Za-z]{3,}|身長|体重|腹囲|血圧|中性脂肪/.test(lines[i+1])){
         const next=chooseNumber(lines[i+1].slice(0,45),lo,hi);
         if(next!=null){out[key]=next;evidence[key]=line+' / '+lines[i+1];break}
       }
     }
   }
   // Many weight-tracker screenshots omit a 体重 label, showing just "92.6 kg".
   if(out.weight==null){for(const l of lines){const m=l.match(/(?:^|\s)(\d{2,3}(?:\.\d{1,2})?)\s*kg\b/i);if(m){const n=+m[1];if(n>=20&&n<=350){out.weight=n;evidence.weight=l;break}}}}
   if(out.height==null){for(const l of lines){const m=l.match(/(\d{2,3}(?:\.\d+)?)\s*cm\b/i);if(m){const n=+m[1];if(n>=125&&n<=250){out.height=n;evidence.height=l;break}}}}
   for(let i=0;i<lines.length;i++){
     if(!/(?:血\s*圧|blood\s*pressure|BP\s*[:：])/i.test(lines[i]))continue;
     const context=(lines[i]+' '+(lines[i+1]||'')).slice(0,160);
     const pairs=[...context.matchAll(/(\d{2,3})\s*(?:[Hh])?\s*\/\s*(?:[Hh]\s*)?(\d{2,3})/g)].map(x=>[+x[1],+x[2]]).filter(x=>x[0]>=50&&x[0]<=260&&x[1]>=35&&x[1]<=160);
     if(pairs.length){out.systolic=pairs[0][0];out.diastolic=pairs[0][1];evidence.systolic=context;evidence.diastolic=context;break}
   }
   const datePart='((?:19|20)\\d{2})\\s*[\\/\\-.年]\\s*(0?[1-9]|1[012])\\s*[\\/\\-.月]\\s*(0?[1-9]|[12]\\d|3[01])(?!\\d)';
   const dateRx=new RegExp(datePart);
   function extractDate(v){const d=dateRx.exec(v);return d?[d[1],d[2].padStart(2,'0'),d[3].padStart(2,'0')].join('-'):null}
   for(const l of lines){if(/(?:生\s*年\s*月\s*日|誕\s*生\s*日|birth\s*date)/i.test(l)){out.birth=extractDate(l);if(out.birth)break}}
   for(const l of lines){const a=l.match(/(?:年\s*齢|age|年\s*令)\s*[:：]?\s*(\d{1,3})\s*(?:歳|才)?/i);if(a&&+a[1]>=1&&+a[1]<=115){out.age=+a[1];break}}
   for(const l of lines){const a=l.match(/性\s*別\s*[:：]?\s*(男|女|男性|女性)/);if(a){out.sex=a[1].startsWith('男')?'male':'female';break}}
   for(const l of lines){if(/(?:受\s*診\s*年\s*月\s*日|検\s*査\s*日|測\s*定\s*日|計\s*測\s*日)/.test(l)){out.measuredAt=extractDate(l);if(out.measuredAt)break}}
   if(!out.measuredAt){for(const l of lines){if(/(?:生\s*年\s*月\s*日|誕生日|birth\s*date)/i.test(l))continue;const d=extractDate(l);if(d){out.measuredAt=d;break}}}

   return {values:out,evidence,matched:Object.keys(out).filter(k=>k!=='measuredAt').length};
 }

 /* Body-composition scale apps (体組成計): a grid of "label / value / rating" tiles.
    OCR returns them either as "label value" on one line, or as a row of labels followed by a row of values. */
 const BODY=[
  ['bmi',/BMI/i,10,80],['bodyFat',/(?<![皮下内臓除]\s*)体\s*脂\s*肪\s*率?(?!\s*量)/,2,70],['subFat',/皮\s*下\s*脂\s*肪/,1,70],
  ['bodyAge',/体\s*内\s*年\s*齢|体\s*年\s*齢/,5,120],['leanMass',/除\s*脂\s*肪\s*体\s*重|除\s*脂\s*肪\s*量/,10,200],['visceral',/内\s*臓\s*脂\s*肪/,1,60],
  ['water',/体\s*水\s*分/,20,80],['skeletal',/骨\s*格\s*筋/,10,80],['bone',/骨\s*量/,0.5,10],
  ['proteinPct',/タ\s*ン\s*パ\s*ク\s*質|た\s*ん\s*ぱ\s*く\s*質|蛋\s*白\s*質/,5,40],['bmr',/基\s*礎\s*代\s*謝/,500,5000],['muscle',/筋\s*肉\s*量/,10,200]
 ];
 function labelsIn(line){const found=[];for(const [key,rx,lo,hi] of BODY){const g=new RegExp(rx.source,rx.flags.includes('g')?rx.flags:rx.flags+'g');let m;while((m=g.exec(line))){found.push({key,lo,hi,index:m.index,end:m.index+m[0].length})}}
   found.sort((a,b)=>a.index-b.index);
   // "骨格筋" also contains no other label, but "除脂肪体重" contains "体重"-like text: drop overlaps keeping the longest
   return found.filter((f,i)=>!found.some((o,j)=>j!==i&&o.index<=f.index&&o.end>=f.end&&(o.end-o.index)>(f.end-f.index)))}
 function cleanNums(s){return (String(s).replace(/(\d)\s+\.\s*(\d)/g,'$1.$2').match(/\d+(?:\.\d+)?/g)||[])}
 // OCR often drops the decimal point of large condensed digits ("7183" for 71.83); try putting it back when that is the only way to fit the range
 function fit(tok,lo,hi){if(tok==null)return null;const n=Number(tok);if(n>=lo&&n<=hi)return n;if(!/\./.test(tok)&&tok.length>=3){for(const d of [1,2]){const v=n/10**d;if(v>=lo&&v<=hi&&String(Math.floor(v)).length>=String(Math.floor(lo)).length)return +v.toFixed(d)}}return null}
 function parseBody(text){
   const raw=normalize(text);const lines=raw.split('\n').map(l=>l.trim()).filter(Boolean);const out={},evidence={};
   for(let i=0;i<lines.length;i++){
     const labels=labelsIn(lines[i]);if(!labels.length)continue;
     if(labels.length===1){const L=labels[0];if(out[L.key]!=null)continue;
       let v=cleanNums(lines[i].slice(L.end)).map(t=>fit(t,L.lo,L.hi)).find(n=>n!=null);
       if(v==null)for(let k=i+1;k<=Math.min(i+2,lines.length-1);k++){if(labelsIn(lines[k]).length)break;v=cleanNums(lines[k]).map(t=>fit(t,L.lo,L.hi)).find(n=>n!=null);if(v!=null)break}
       if(v!=null){out[L.key]=v;evidence[L.key]=lines[i]}
       continue}
     // several labels on one line → values follow, in the same order, on the same line or the next numeric line
     const sameLine=labels.map((L,j)=>cleanNums(lines[i].slice(L.end,labels[j+1]?labels[j+1].index:undefined))[0]);
     let vals=sameLine.every(v=>v!=null)?sameLine:null;
     if(!vals)for(let k=i+1;k<=Math.min(i+3,lines.length-1);k++){if(labelsIn(lines[k]).length)break;const n=cleanNums(lines[k]);if(n.length>=labels.length){vals=n.slice(0,labels.length);break}}
     if(vals)labels.forEach((L,j)=>{const v=fit(vals[j],L.lo,L.hi);if(out[L.key]==null&&v!=null){out[L.key]=v;evidence[L.key]=lines[i]}})
   }
   // body weight: the big "91.30 kg" at the top, never a tile such as 除脂肪体重 / 骨量 / 筋肉量
   const w=parse(text).values.weight;let weight=null;
   for(let i=0;i<lines.length;i++){const l=lines[i];if(labelsIn(l).length)continue;if(i>0&&labelsIn(lines[i-1]).length)continue;if(!/kg/i.test(l))continue;const head=l.replace(/\d{1,2}:\d{2}/g,' ');const sp=head.match(/(?<![\d.])(\d{2,3})(?:\s*[.,]\s*|\s+)(\d{1,2})(?![\d.:])/);const m=sp?[0,sp[1]+'.'+sp[2]]:head.match(/(?<![\d.])(\d{2,3}(?:\.\d{1,2})?)\s*kg\b/i);if(m&&+m[1]>=20&&+m[1]<=350){weight=+m[1];evidence.weight=l;break}}
   if(weight==null&&w!=null&&![out.leanMass,out.muscle].includes(w))weight=w;
   if(weight!=null)out.weight=weight;
   const d=parse(text).values.measuredAt;if(d)out.measuredAt=d;
   return {values:out,evidence,matched:Object.keys(out).filter(k=>k!=='measuredAt').length};
 }
 const api={parse,parseBody,normalize};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 root.NutriHealthOCR=api;
})(typeof window!=='undefined'?window:globalThis);
