// 데이터 무결성 검증 스크립트 (node _test_data.js)
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const ctx = {};
function loadInto(file){
  const code = fs.readFileSync(path.join(dir,file),'utf8');
  // const 선언을 전역으로 노출
  const wrapped = code.replace(/^const /gm,'var ');
  (new Function('ctx', wrapped + `
    ctx.MAP_W=typeof MAP_W!=='undefined'?MAP_W:ctx.MAP_W;
    ctx.MAP_H=typeof MAP_H!=='undefined'?MAP_H:ctx.MAP_H;
    ctx.PROVINCES=typeof PROVINCES!=='undefined'?PROVINCES:ctx.PROVINCES;
    ctx.LOCATIONS=typeof LOCATIONS!=='undefined'?LOCATIONS:ctx.LOCATIONS;
    ctx.MCQ=typeof MCQ!=='undefined'?MCQ:ctx.MCQ;
    ctx.OX=typeof OX!=='undefined'?OX:ctx.OX;
    ctx.PROV_QUIZ=typeof PROV_QUIZ!=='undefined'?PROV_QUIZ:ctx.PROV_QUIZ;
    ctx.MUNIS=typeof MUNIS!=='undefined'?MUNIS:ctx.MUNIS;
    ctx.MASCOTS=typeof MASCOTS!=='undefined'?MASCOTS:ctx.MASCOTS;
  `))(ctx);
}
loadInto('map-data.js');
loadInto('questions.js');
;(function(){
  const code = fs.readFileSync(path.join(dir,'stats-data.js'),'utf8').replace(/^const /gm,'var ');
  (new Function('ctx', code + '; ctx.CLIMATE=CLIMATE; ctx.SIDO_STATS=SIDO_STATS;'))(ctx);
  const code2 = fs.readFileSync(path.join(dir,'match-sets.js'),'utf8').replace(/^const /gm,'var ');
  (new Function('ctx', code2 + '; ctx.CLIMATE_SETS=CLIMATE_SETS; ctx.ORDER_SETS=ORDER_SETS; ctx.STAT_SETS=STAT_SETS; ctx.CLIM_INDS=CLIM_INDS; ctx.STAT_INDS=STAT_INDS;'))(ctx);
})();

let errors = 0;
const err = m => { console.log('  [오류]', m); errors++; };

console.log('=== 지도 데이터 ===');
console.log('시·도 수:', Object.keys(ctx.PROVINCES).length);
if(Object.keys(ctx.PROVINCES).length !== 17) err('시·도가 17개가 아님');
console.log('지점 수:', ctx.LOCATIONS.length);
const W = ctx.MAP_W, H = ctx.MAP_H;
ctx.LOCATIONS.forEach(l => {
  if(l.x < 0 || l.x > W+20 || l.y < 0 || l.y > H+20) err(`${l.name} 좌표 범위 밖 (${l.x},${l.y})`);
  if(!l.fact || l.fact.length < 5) err(`${l.name} 설명 누락`);
});
const names = ctx.LOCATIONS.map(l=>l.name);
const dup = names.filter((n,i)=>names.indexOf(n)!==i);
if(dup.length) err('지점 이름 중복: '+dup);

console.log('=== 문제 은행 ===');
console.log('MCQ:', ctx.MCQ.length, '| OX:', ctx.OX.length, '| 시도퀴즈:', ctx.PROV_QUIZ.length);
const REGIONS = ['지역구분','북한','수도권','강원','충청','호남','영남','제주'];
ctx.MCQ.forEach((q,i) => {
  if(!REGIONS.includes(q.region)) err(`MCQ#${i} region 오류: ${q.region}`);
  if(!Array.isArray(q.choices) || q.choices.length !== 4) err(`MCQ#${i} 보기 4개 아님`);
  if(typeof q.answer !== 'number' || q.answer < 0 || q.answer > 3) err(`MCQ#${i} answer 범위 오류`);
  if(!q.exp) err(`MCQ#${i} 해설 누락`);
  const d = q.choices.filter((c,j)=>q.choices.indexOf(c)!==j);
  if(d.length) err(`MCQ#${i} 보기 중복: ${d}`);
});
ctx.OX.forEach((q,i) => {
  if(!REGIONS.includes(q.region)) err(`OX#${i} region 오류: ${q.region}`);
  if(typeof q.answer !== 'boolean') err(`OX#${i} answer가 boolean 아님`);
  if(!q.exp) err(`OX#${i} 해설 누락`);
});
ctx.PROV_QUIZ.forEach((q,i) => {
  if(!ctx.PROVINCES[q.answer]) err(`PROV#${i} 정답 시·도 없음: ${q.answer}`);
});
console.log('마스코트:', ctx.MASCOTS.length);
ctx.MASCOTS.forEach((m,i) => {
  if(!m.name || !m.desc || !m.exp) err(`MASCOT#${i} 필드 누락`);
  if(!REGIONS.includes(m.region)) err(`MASCOT#${i} region 오류: ${m.region}`);
  m.accept.forEach(a => { if(!ctx.MUNIS[a]) err(`MASCOT#${i} 시·군 없음: ${a}`); });
  if(m.desc.includes(m.accept[0].replace(/[시군구]$/,''))) err(`MASCOT#${i} 설명에 정답 지역명 노출: ${m.name}`);
});
ctx.LOCATIONS.forEach(l => {
  l.accept.forEach(a => { if(!ctx.MUNIS[a]) err(`지점 ${l.name} 시·군 매핑 오류: ${a}`); });
});

console.log('기후 관측소:', ctx.CLIMATE.length, '| 시도 통계:', ctx.SIDO_STATS.length);
ctx.CLIMATE.forEach((c,i) => {
  if(c.p.length !== 12 || c.t.length !== 12) err(`CLIMATE#${i} ${c.name} 월 자료 12개 아님`);
  if(c.p.some(v => typeof v !== 'number' || v < 0)) err(`CLIMATE#${i} ${c.name} 강수 이상값`);
  if(c.t.some(v => typeof v !== 'number' || v < -40 || v > 40)) err(`CLIMATE#${i} ${c.name} 기온 이상값`);
  if(!REGIONS.concat(['북한']).includes(c.region)) err(`CLIMATE#${i} region 오류`);
});
if(ctx.SIDO_STATS.length !== 17) err('시도 통계가 17개 아님');

// 비교 세트 검증
console.log('비교 세트: 기후 매칭', ctx.CLIMATE_SETS.length, '/ 순서형', ctx.ORDER_SETS.length, '/ 통계', ctx.STAT_SETS.length);
const climVal = (st, key) => {
  const t = st.t, p = st.p;
  const tmin = Math.min(...t), tmax = Math.max(...t), total = p.reduce((a,b)=>a+b,0);
  const map = { tavg: t.reduce((a,b)=>a+b,0)/12, tmin, tmax, range: tmax-tmin, total,
    sRate: (p[5]+p[6]+p[7])/total*100, wRate: (p[11]+p[0]+p[1])/total*100 };
  return map[key];
};
ctx.CLIMATE_SETS.forEach((s,i) => {
  s.st.forEach(n => {
    const st = ctx.CLIMATE.find(c=>c.name===n);
    if(!st) return err(`CSET#${i} 관측소 없음: ${n}`);
    if(st.x == null) err(`CSET#${i} ${n} 지도 좌표 없음(매칭형 불가)`);
  });
  if(!s.point) err(`CSET#${i} 학습 포인트 누락`);
  s.inds.forEach(k => { if(!ctx.CLIM_INDS[k]) err(`CSET#${i} 지표 오류: ${k}`); });
  // 두 지표를 함께 보면 세 지역이 구분 가능한지(동률 방지)
  const sts = s.st.map(n=>ctx.CLIMATE.find(c=>c.name===n)).filter(Boolean);
  if(sts.length===3){
    for(let a=0;a<3;a++) for(let b=a+1;b<3;b++){
      const d1=Math.abs(climVal(sts[a],s.inds[0])-climVal(sts[b],s.inds[0]));
      const d2=Math.abs(climVal(sts[a],s.inds[1])-climVal(sts[b],s.inds[1]));
      if(d1<0.5 && d2<0.5) err(`CSET#${i} ${sts[a].name}-${sts[b].name} 지표 차이 미미(판별 곤란)`);
    }
  }
});
ctx.ORDER_SETS.forEach((s,i) => {
  const sts = s.st.map(n=>ctx.CLIMATE.find(c=>c.name===n));
  sts.forEach((st,j) => { if(!st) err(`OSET#${i} 관측소 없음: ${s.st[j]}`); });
  if(!ctx.CLIM_INDS[s.ind]) err(`OSET#${i} 지표 오류`);
  if(sts.every(Boolean)){
    const vals = sts.map(st=>climVal(st,s.ind)).sort((a,b)=>b-a);
    if(vals[0]-vals[1] < 0.5 || vals[1]-vals[2] < 0.5) err(`OSET#${i} ${s.st} 값 차이 미미: ${vals.map(v=>v.toFixed(1))}`);
  }
});
ctx.STAT_SETS.forEach((s,i) => {
  s.sd.forEach(n => { if(!ctx.SIDO_STATS.find(x=>x.name===n)) err(`SSET#${i} 시·도 없음: ${n}`); });
  s.inds.forEach(k => { if(!ctx.STAT_INDS[k]) err(`SSET#${i} 지표 오류: ${k}`); });
  if(!s.point) err(`SSET#${i} 학습 포인트 누락`);
  // 첫 지표 기준 동률 방지
  const vals = s.sd.map(n => {
    const sd = ctx.SIDO_STATS.find(x=>x.name===n);
    return s.inds[0]==='popGrow' ? sd.pop2020/sd.pop1970 : sd[s.inds[0]];
  }).sort((a,b)=>b-a);
  const v2 = s.sd.map(n => {
    const sd = ctx.SIDO_STATS.find(x=>x.name===n);
    return s.inds[1]==='popGrow' ? sd.pop2020/sd.pop1970 : sd[s.inds[1]];
  }).sort((a,b)=>b-a);
  const close = (arr) => (arr[0]-arr[1])/Math.max(arr[0],1e-9) < 0.08 || (arr[1]-arr[2])/Math.max(arr[1],1e-9) < 0.08;
  if(close(vals) && close(v2)) err(`SSET#${i} ${s.sd} 두 지표 모두 차이 미미`);
});
ctx.SIDO_STATS.forEach(s => {
  if(!ctx.PROVINCES[s.name]) err(`SIDO ${s.name} 지도에 없음`);
  ['pop2020','mfgShip','farms'].forEach(k => { if(s[k] == null) err(`SIDO ${s.name} ${k} 누락`); });
  ['pop2020Rank','mfgShipRank'].forEach(k => { if(!(s[k] >= 1 && s[k] <= 17)) err(`SIDO ${s.name} ${k} 순위 오류`); });
});

// 권역별 문항 분포
const cnt = {};
ctx.MCQ.forEach(q=>cnt[q.region]=(cnt[q.region]||0)+1);
console.log('MCQ 권역 분포:', JSON.stringify(cnt));
const cnt2 = {};
ctx.LOCATIONS.forEach(l=>cnt2[l.region]=(cnt2[l.region]||0)+1);
console.log('지점 권역 분포:', JSON.stringify(cnt2));

console.log(errors ? `\n총 ${errors}개 오류!` : '\n✅ 모든 검증 통과');
process.exit(errors ? 1 : 0);
