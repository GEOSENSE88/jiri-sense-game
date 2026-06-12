// 문항 중복·유사도 감사: 2-gram 자카드 유사도로 의심 쌍 출력
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const ctx = {};
const code = ['map-data.js','stats-data.js','questions.js'].map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('\n').replace(/^const /gm,'var ');
(new Function('ctx', code + '; ctx.MCQ=MCQ; ctx.OX=OX; ctx.PROV_QUIZ=PROV_QUIZ;'))(ctx);

const grams = s => {
  const t = (s||'').replace(/[^가-힣A-Za-z0-9]/g,'');
  const g = new Set();
  for(let i=0;i<t.length-1;i++) g.add(t.slice(i,i+2));
  return g;
};
const jac = (a,b) => {
  let inter=0; for(const x of a) if(b.has(x)) inter++;
  return inter/(a.size+b.size-inter || 1);
};

function audit(name, items, textFn, thr){
  const gs = items.map(q=>grams(textFn(q)));
  const out=[];
  for(let i=0;i<items.length;i++) for(let j=i+1;j<items.length;j++){
    const s = jac(gs[i],gs[j]);
    if(s>=thr) out.push([s.toFixed(2), i, j, textFn(items[i]).slice(0,42), textFn(items[j]).slice(0,42)]);
  }
  console.log(`\n=== ${name}: ${out.length}쌍 (임계 ${thr}) ===`);
  out.sort((a,b)=>b[0]-a[0]).forEach(r=>console.log(`${r[0]} [${r[1]}]·[${r[2]}] "${r[3]}" ↔ "${r[4]}"`));
}
const mt = q => q.q + ' ' + q.exp;
audit('MCQ 내부', ctx.MCQ, mt, 0.40);
audit('OX 내부', ctx.OX, mt, 0.45);

// MCQ ↔ OX 교차 (같은 사실 반복)
{
  const a = ctx.MCQ.map(q=>grams(mt(q))), b = ctx.OX.map(q=>grams(mt(q)));
  const out=[];
  for(let i=0;i<a.length;i++) for(let j=0;j<b.length;j++){
    const s = jac(a[i],b[j]);
    if(s>=0.40) out.push([s.toFixed(2), i, j, ctx.MCQ[i].q.slice(0,40), ctx.OX[j].q.slice(0,40)]);
  }
  console.log(`\n=== MCQ↔OX 교차: ${out.length}쌍 ===`);
  out.sort((x,y)=>y[0]-x[0]).forEach(r=>console.log(`${r[0]} MCQ[${r[1]}]·OX[${r[2]}] "${r[3]}" ↔ "${r[4]}"`));
}
