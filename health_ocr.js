/* On-device OCR-text parsing helpers. OCR itself is loaded on demand by the UI. */
(function(root){'use strict';
 const ranges={height:[90,250],weight:[20,350],waist:[35,220],bodyFat:[2,70],alt:[0,3000],ast:[0,3000],tg:[0,2000],hdl:[0,300],ldl:[0,500],glucose:[20,700],hba1c:[2,20],systolic:[50,260],diastolic:[35,160]};
 function normalize(text){return String(text||'').normalize('NFKC').replace(/([A-Z])\s+(?=[A-Z])/g,'$1').replace(/[，,]/g,'.').replace(/[／]/g,'/').replace(/\r/g,'\n')}
 function nums(s){return (String(s||'').match(/\d+(?:\.\d+)?/g)||[]).map(Number).filter(Number.isFinite)}
 function chooseNumber(tail,min,max){const values=nums(tail).filter(v=>v>=min&&v<=max);if(!values.length)return null;return values[values.length-1]}
 const patterns={
 height:/(?:身\s*長|height)\s*[:：]?/i,
 weight:/(?:体\s*重|weight)\s*[:：]?/i,
 waist:/(?:腹\s*囲|ウエスト|waist)\s*[:：]?/i,
 bodyFat:/(?:体\s*脂\s*肪\s*率|body\s*fat)\s*[:：]?/i,
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
 const api={parse,normalize};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 root.NutriHealthOCR=api;
})(typeof window!=='undefined'?window:globalThis);
