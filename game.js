// ============================================================
// 한국지리 백지도 정복 — 게임 엔진 v2 (시·군 백지도 + 모바일 최적화)
// ============================================================
'use strict';

const $ = id => document.getElementById(id);
const REGIONS = ['전체','지역구분','북한','수도권','강원','충청','호남','영남','제주'];
const MAP_REGIONS = ['수도권','강원','충청','호남','영남','제주'];

// ---------- 저장소 ----------
const store = {
  load(key, def){ try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch(e){ return def; } },
  save(key, v){ try { localStorage.setItem(key, JSON.stringify(v)); } catch(e){ /* 저장 불가 환경에서도 게임은 계속 */ } },
  remove(key){ try { localStorage.removeItem(key); } catch(e){} }
};
let stats = store.load('geo_stats', {});
let xp    = store.load('geo_xp', 0);
let board = store.load('geo_board', {});

const RANKS = [
  [0,'🌱 지리 새내기'],[300,'🧭 길눈 밝은 학생'],[800,'🚌 답사 견습생'],
  [1600,'🗺️ 지도 읽는 자'],[2800,'⛰️ 대간 종주자'],[4500,'🚄 국토 순례자'],
  [7000,'🏞️ 지역 전문가'],[10000,'🌏 백지도 마스터'],[15000,'👑 한국지리 그랜드마스터']
];

// ---------- 게임 상태 ----------
const G = {
  mode:null, region:'전체',
  queue:[], idx:0, score:0, combo:0, maxCombo:0, correctCnt:0,
  timer:null, timeLeft:0, timeMax:0, oxEnd:0,
  battle:null, locked:false,
};

const MODE_INFO = {
  explore:  {title:'🔍 백지도 탐색', useMap:true},
  location: {title:'📍 위치 사냥', useMap:true, n:14, time:30},
  muniname: {title:'🔎 지역 판독', useMap:true, n:12, time:25},
  detective:{title:'🕵️ 지역 추리', useMap:true, n:10, time:55},
  climate:  {title:'🌡️ 기후 비교', useMap:true, n:8, time:40},
  stats:    {title:'📊 통계 비교', useMap:true, n:8, time:40},
  mcq:      {title:'📝 개념 퀴즈', useMap:false, n:10, time:35},
  ox:       {title:'⚡ 스피드 OX (60초)', useMap:false, time:60},
  battle:   {title:'⚔️ 1:1 배틀', useMap:true, n:16, time:30},
};

// 마스코트는 위치 사냥의 '설명형' 문제로 흡수
let LOC_POOL=null;
function locPool(){
  if(LOC_POOL) return LOC_POOL;
  const mascotLocs=MASCOTS.map(m=>{
    const mu=MUNIS[m.accept[0]];
    return {name:m.accept[0].replace(/\(.+\)$/,''), x:mu.cx, y:mu.cy, region:m.region, accept:m.accept,
            fact:`마스코트 ‘${m.name}’의 고장 — ${m.desc}`, descOnly:true,
            desc:`마스코트 ‘${m.name}’ — ${m.desc}`};
  });
  LOC_POOL=LOCATIONS.concat(mascotLocs);
  return LOC_POOL;
}
// 설명문에서 지역 이름 가리기
function maskName(text, loc){
  let t=text;
  const names=[loc.name, ...loc.accept];
  names.forEach(n=>{
    const base=n.replace(/\(.+\)$/,'');
    const stem=base.replace(/[시군구]$/,'');
    [base, stem].forEach(s=>{ if(s && s.length>=2) t=t.split(s).join('◯◯'); });
  });
  return t;
}

// ---------- 5개년 기출 빈도 ----------
function freqOf(name){
  const f = FREQ[name] || FREQ[name + '시'] || FREQ[name + '군'];
  return f ? f.count : 0;
}
function freqInfo(name){
  return FREQ[name] || FREQ[name + '시'] || FREQ[name + '군'] || null;
}
function noteOf(name){
  return REGION_NOTES[name] || REGION_NOTES[name + '시'] || REGION_NOTES[name + '군'] || null;
}
function imgSearchLink(keyword, extra){
  const q = encodeURIComponent(keyword + ' ' + (extra || '지리'));
  return `<a class="img-link" href="https://search.naver.com/search.naver?where=image&query=${q}" target="_blank" rel="noopener">📷 ${keyword} 이미지 자료</a>`;
}
// 빈출 지역 가중 무작위 추출 (비복원)
function weightedSample(items, n, keyFn){
  const pool = items.slice(), out = [];
  while(out.length < n && pool.length){
    const ws = pool.map(it => 1 + Math.min(freqOf(keyFn(it)), 18) / 9);   // 최대 3배로 완화
    let r = Math.random() * ws.reduce((a, b) => a + b, 0);
    let i = 0;
    for(; i < pool.length - 1; i++){ r -= ws[i]; if(r <= 0) break; }
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}
// 위치·추리 전용: 같은 시·군 중복 금지 + 최근 출제 이력 회피
function sampleLocQueue(items, n){
  const recent=new Set(store.load('geo_recent_locs',[]));
  const used=new Set(), out=[];
  while(out.length<n){
    const avail=items.filter(it=>!used.has(it.accept[0]));
    if(!avail.length) break;
    const ws=avail.map(it=>{
      let w=1+Math.min(freqOf(it.accept[0]),18)/9;     // 빈출 가중 최대 3배
      if(recent.has(it.accept[0])) w*=0.12;            // 최근에 나온 시·군은 강하게 회피
      return w;
    });
    let r=Math.random()*ws.reduce((a,b)=>a+b,0), i=0;
    for(;i<avail.length-1;i++){ r-=ws[i]; if(r<=0) break; }
    used.add(avail[i].accept[0]); out.push(avail[i]);
  }
  const hist=store.load('geo_recent_locs',[]).concat([...used]);
  store.save('geo_recent_locs', hist.slice(-45));       // 최근 45개 시·군 기억
  return out;
}

// ============================================================
// 홈 화면
// ============================================================
function initHome(){
  const chips = $('region-chips'); chips.innerHTML='';
  REGIONS.forEach(r=>{
    const b=document.createElement('button');
    b.className='chip'+(G.region===r?' on':''); b.textContent=r;
    b.onclick=()=>{ G.region=r; initHome(); };
    chips.appendChild(b);
  });
  let rank=RANKS[0], next=null;
  for(const r of RANKS){ if(xp>=r[0]) rank=r; else { next=r; break; } }
  const streak=store.load('geo_streak',0);
  const today=new Date().toDateString();
  const streakOn = store.load('geo_lastday','')===today;
  $('rank-badge').innerHTML=rank[1]+(streak>=1?` <span class="streak-chip">${streakOn?'🔥':'⏳'} ${streak}일 연속</span>`:'');
  $('xp-bar').style.width = next? Math.min(100,(xp-rank[0])/(next[0]-rank[0])*100)+'%' : '100%';
  $('xp-text').textContent = next? `XP ${xp} / 다음 계급(${next[1]})까지 ${next[0]-xp}` : `XP ${xp} — 최고 계급 달성!`;
  const ml=$('mastery-list'); ml.innerHTML='';
  REGIONS.slice(1).forEach(r=>{
    const s=stats[r]||{c:0,t:0};
    const pct=s.t? Math.round(s.c/s.t*100):0;
    ml.insertAdjacentHTML('beforeend',
      `<div class="mastery-row"><span class="m-name">${r}</span>
       <div class="m-bar"><div class="m-fill" style="width:${pct}%"></div></div>
       <span class="m-val">${pct}% (${s.c}/${s.t})</span></div>`);
  });
  const hb=$('home-board'); hb.innerHTML='';
  let any=false;
  Object.keys(MODE_INFO).forEach(m=>{
    const list=board[m]||[];
    if(list.length){ any=true;
      hb.insertAdjacentHTML('beforeend',
        `<div class="board-row"><span>${list[0].name} — <b>${list[0].score}</b>점</span>
         <span class="b-mode">${MODE_INFO[m].title.replace(/^[^\s]+\s/,'')}</span></div>`);
    }
  });
  if(!any) hb.innerHTML='<div style="color:var(--dim);font-size:.83rem">아직 기록이 없습니다. 첫 도전자가 되어 보세요!</div>';
  updateGachaUI();
  // 빈출 지역 TOP 12
  $('freq-span').textContent=`${FREQ_SPAN.span} 고3 학평·모평·수능 ${FREQ_SPAN.files}회분 언급 횟수 — 빈출 지역은 게임에서 더 자주 출제됩니다`;
  const fl=$('freq-list'); fl.innerHTML='';
  const top=Object.entries(FREQ).sort((a,b)=>b[1].count-a[1].count).slice(0,12);
  const max=top[0][1].count;
  top.forEach(([name,v],i)=>{
    fl.insertAdjacentHTML('beforeend',
      `<div class="freq-row"><span class="f-rank">${i+1}</span><span class="f-name">${name.replace(/(특별자치시|특별자치도|광역시|특별시)$/,'')}</span>
       <div class="f-bar"><div class="f-fill" style="width:${Math.round(v.count/max*100)}%"></div></div>
       <span class="f-val">${v.count}회·${v.exams}개 시험</span></div>`);
  });
}

document.querySelectorAll('.mode-card').forEach(c=>{ c.onclick=()=>startGame(c.dataset.mode); });
$('reset-data').onclick=()=>{
  if(confirm('모든 기록(점수·숙련도·랭킹)을 초기화할까요?')){
    store.remove('geo_stats'); store.remove('geo_xp'); store.remove('geo_board');
    stats={}; xp=0; board={}; initHome();
  }
};

// ============================================================
// 지도 렌더링 (시·군 단위 + 시·도 외곽선 오버레이)
// ============================================================
const VIEW0 = {x:-8, y:-8, w:776, h:822};
let view = {...VIEW0};
let svgBuilt=false;

function buildMap(){
  const svg=$('map-svg');
  svg.innerHTML='';
  applyView();
  for(const [name,m] of Object.entries(MUNIS)){
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',m.d);
    path.setAttribute('class','muni');
    path.dataset.name=name; path.dataset.prov=m.prov; path.dataset.region=m.region;
    svg.appendChild(path);
  }
  for(const [name,p] of Object.entries(PROVINCES)){
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',p.d);
    path.setAttribute('class','prov-border');
    svg.appendChild(path);
  }
  svgBuilt=true;
}
function applyView(){
  $('map-svg').setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);
}
// 부드러운 뷰 전환 (ease-out)
let viewAnimId=null;
let VIEW_ANIM_MS=240;
function animateView(tv){
  if(viewAnimId){ cancelAnimationFrame(viewAnimId); viewAnimId=null; }
  if(VIEW_ANIM_MS<=0 || typeof requestAnimationFrame!=='function'){
    view={...tv}; applyView(); return;
  }
  const from={...view};
  const t0=(typeof performance!=='undefined'?performance.now():0);
  const step=(t)=>{
    const k=Math.min(1,(t-t0)/VIEW_ANIM_MS);
    const e=1-Math.pow(1-k,3);                     // ease-out cubic
    view={x:from.x+(tv.x-from.x)*e, y:from.y+(tv.y-from.y)*e,
          w:from.w+(tv.w-from.w)*e, h:from.h+(tv.h-from.h)*e};
    applyView();
    if(k<1) viewAnimId=requestAnimationFrame(step); else viewAnimId=null;
  };
  viewAnimId=requestAnimationFrame(step);
}
function clampedTarget(tv){
  const old={...view}; view=tv; clampView(); const r={...view}; view=old; return r;
}
function resetView(){ animateView({...VIEW0}); }
function zoomAt(cx, cy, factor){
  const nw=Math.min(VIEW0.w, Math.max(VIEW0.w/8, view.w*factor));
  const k=nw/view.w;
  animateView(clampedTarget({x:cx-(cx-view.x)*k, y:cy-(cy-view.y)*k, w:nw, h:view.h*k}));
}
function clampView(){
  view.x=Math.max(VIEW0.x-60, Math.min(view.x, VIEW0.x+VIEW0.w-view.w+60));
  view.y=Math.max(VIEW0.y-60, Math.min(view.y, VIEW0.y+VIEW0.h-view.h+60));
}
function svgPoint(clientX, clientY){
  const svg=$('map-svg');
  const pt=svg.createSVGPoint(); pt.x=clientX; pt.y=clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

// ----- 터치 팬/핀치 줌 (탭과 구분) -----
let suppressTap=false;
function initMapGestures(){
  const svg=$('map-svg');
  const ptrs=new Map();
  let panStart=null, pinch0=null, moved=false;
  svg.addEventListener('pointerdown',e=>{
    ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(ptrs.size===1){ panStart={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y}; moved=false; }
    else if(ptrs.size===2){
      const [a,b]=[...ptrs.values()];
      pinch0={d:Math.hypot(a.x-b.x,a.y-b.y), w:view.w, h:view.h,
              cx:(a.x+b.x)/2, cy:(a.y+b.y)/2};
    }
  });
  svg.addEventListener('pointermove',e=>{
    if(!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const rect=svg.getBoundingClientRect();
    const scale=view.w/rect.width;
    if(ptrs.size===2 && pinch0){
      const [a,b]=[...ptrs.values()];
      const d=Math.hypot(a.x-b.x,a.y-b.y);
      if(Math.abs(d-pinch0.d)>6){
        moved=true; suppressTap=true;
        const target=svgPoint(pinch0.cx,pinch0.cy);
        const nw=Math.min(VIEW0.w, Math.max(VIEW0.w/8, pinch0.w*(pinch0.d/d)));
        const kk=nw/view.w;
        view.x=target.x-(target.x-view.x)*kk; view.y=target.y-(target.y-view.y)*kk;
        view.w=nw; view.h=pinch0.h*(nw/pinch0.w);
        clampView(); applyView();
      }
    } else if(ptrs.size===1 && panStart){
      const dx=(e.clientX-panStart.x), dy=(e.clientY-panStart.y);
      if(Math.abs(dx)+Math.abs(dy)>10){ moved=true; suppressTap=true; }
      if(moved && view.w<VIEW0.w-1){      // 확대 상태에서만 팬
        view.x=panStart.vx-dx*scale; view.y=panStart.vy-dy*scale;
        clampView(); applyView();
      }
    }
  });
  const up=e=>{
    // 탭(이동 없음)이면 터치 지점에 물결 효과
    if(ptrs.size===1 && !moved && !suppressTap){
      try { const p=svgPoint(e.clientX,e.clientY); tapRipple(p.x,p.y); } catch(err){}
    }
    ptrs.delete(e.pointerId);
    if(ptrs.size<2) pinch0=null;
    if(ptrs.size===0){ panStart=null; setTimeout(()=>{ suppressTap=false; },50); }
  };
  svg.addEventListener('pointerup',up);
  svg.addEventListener('pointercancel',up);
  svg.addEventListener('wheel',e=>{   // 데스크톱 휠 줌
    e.preventDefault();
    const p=svgPoint(e.clientX,e.clientY);
    zoomAt(p.x,p.y, e.deltaY>0?1.25:0.8);
  },{passive:false});
  $('zoom-in').onclick=()=>zoomAt(view.x+view.w/2, view.y+view.h/2, 0.7);
  $('zoom-out').onclick=()=>zoomAt(view.x+view.w/2, view.y+view.h/2, 1.45);
  $('zoom-reset').onclick=resetView;
}

// 탭 물결 효과
function tapRipple(x, y){
  const svg=$('map-svg');
  const r=document.createElementNS('http://www.w3.org/2000/svg','circle');
  r.setAttribute('cx',x); r.setAttribute('cy',y); r.setAttribute('r',6);
  r.setAttribute('class','tap-ripple');
  svg.appendChild(r);
  setTimeout(()=>r.remove(), 500);
}
function clearMapExtras(){
  document.querySelectorAll('#map-svg .loc-dot, #map-svg .loc-label, #map-svg .click-mark, #map-svg .match-mark').forEach(e=>e.remove());
  document.querySelectorAll('#map-svg .muni').forEach(p=>p.classList.remove('correct','wrong','flash','dim-region','pulse'));
}
function muniEl(name){ return document.querySelector(`#map-svg .muni[data-name="${name}"]`); }
function addDot(x, y, r, cls){
  const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
  c.setAttribute('cx',x); c.setAttribute('cy',y); c.setAttribute('r',r);
  c.setAttribute('class',cls);
  $('map-svg').appendChild(c); return c;
}
function addLabel(x, y, text){
  const t=document.createElementNS('http://www.w3.org/2000/svg','text');
  t.setAttribute('x',x); t.setAttribute('y',y);
  t.setAttribute('text-anchor','middle'); t.setAttribute('class','loc-label');
  t.textContent=text; $('map-svg').appendChild(t); return t;
}
function dimOtherRegions(region){
  if(region==='전체') return;
  document.querySelectorAll('#map-svg .muni').forEach(p=>{
    if(p.dataset.region!==region) p.classList.add('dim-region');
  });
}
// ----- 지도 탭 리스너 중앙 관리: 문제 전환·이탈 시 반드시 해제 -----
let activeMapTap=null;
function setMapTap(fn){
  clearMapTap();
  activeMapTap=fn;
  $('map-svg').addEventListener('click',fn);
}
function clearMapTap(){
  if(activeMapTap){ $('map-svg').removeEventListener('click',activeMapTap); activeMapTap=null; }
}
// 각 시·군 탭 핸들러 등록(1회성)
function onMuniTap(fn){
  const handler=(e)=>{
    if(suppressTap || G.locked) return;
    const t=e.target.closest('.muni');
    if(!t) return;
    clearMapTap();
    fn(t, e);
  };
  setMapTap(handler);
  return clearMapTap;
}

// ============================================================
// 공통 흐름
// ============================================================
function show(id){ document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active')); $(id).classList.add('active'); }
function shuffle(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

function pool(mode){
  const r=G.region;
  if(mode==='location'||mode==='detective'){
    const base=locPool();
    let L=base.filter(l=>r==='전체'||l.region===r);
    return L.length>=4?L:base;
  }
  if(mode==='muniname'){
    let M=Object.keys(MUNIS).filter(n=>r==='전체'||MUNIS[n].region===r);
    return M.length>=4?M:Object.keys(MUNIS);
  }
  if(mode==='climate'){
    const stReg=n=>CLIMATE.find(c=>c.name===n)?.region;
    let M=CLIMATE_SETS.filter(s=>r==='전체'||s.st.some(n=>stReg(n)===r)).map(s=>({kind:'match',set:s}));
    let O=ORDER_SETS.filter(s=>r==='전체'||s.st.some(n=>stReg(n)===r)).map(s=>({kind:'order',set:s}));
    const all=M.concat(O);
    return all.length>=4?all:CLIMATE_SETS.map(s=>({kind:'match',set:s})).concat(ORDER_SETS.map(s=>({kind:'order',set:s})));
  }
  if(mode==='stats'){
    let P=STAT_SETS.filter(s=>r==='전체'||s.sd.some(n=>PROVINCES[n]?.region===r));
    return P.length>=2?P:STAT_SETS;
  }
  if(mode==='mcq'){ const M=MCQ.filter(q=>r==='전체'||q.region===r); return M.length?M:MCQ; }
  if(mode==='ox'){ const O=OX.filter(q=>r==='전체'||q.region===r); return O.length?O:OX; }
  return [];
}

function startGame(mode){
  G.mode=mode; G.idx=0; G.score=0; G.combo=0; G.maxCombo=0; G.correctCnt=0; G.locked=false;
  G.battle=null;
  if(!svgBuilt){ buildMap(); initMapGestures(); }
  clearMapExtras(); resetView();
  stopTimer();

  const info=MODE_INFO[mode];
  $('game-title').textContent=info.title+(G.region!=='전체'?` · ${G.region}`:'');
  $('turn-indicator').classList.add('hidden');
  $('map-pane').style.display=info.useMap?'block':'none';
  $('game-body').classList.toggle('no-map', !info.useMap);
  $('btn-next').classList.add('hidden');
  $('feedback-box').classList.add('hidden');

  if(mode==='explore') return startExplore();

  if(mode==='ox'){
    G.queue=shuffle(pool('ox'));
    G.oxEnd=Date.now()+60000;
  } else if(mode==='battle'){
    const types=['location','muniname','detective','climate','stats','mcq','ox'];
    let q=[];
    for(let i=0;i<MODE_INFO.battle.n;i++){
      const t=types[Math.floor(Math.random()*types.length)];
      const p=shuffle(pool(t));
      q.push({btype:t, item:p[i%p.length]});
    }
    G.queue=q;
    const n1=prompt('플레이어 1 이름?','P1')||'P1';
    const n2=prompt('플레이어 2 이름?','P2')||'P2';
    G.battle={turn:1, scores:[0,0], combos:[0,0], correct:[0,0], names:[n1.slice(0,8),n2.slice(0,8)]};
  } else if(mode==='location'||mode==='detective'){
    G.queue=sampleLocQueue(pool(mode), MODE_INFO[mode].n);
  } else if(mode==='muniname'){
    G.queue=weightedSample(pool(mode), MODE_INFO[mode].n, n=>n);
  } else {
    G.queue=shuffle(pool(mode)).slice(0, MODE_INFO[mode].n);
  }
  show('screen-game');
  nextQuestion();
}

function hudUpdate(){
  const total = G.mode==='ox' ? '∞' : G.queue.length;
  $('hud-qnum').textContent=Math.min(G.idx+1, G.queue.length);
  $('hud-qtotal').textContent=total;
  if(G.battle){
    const b=G.battle;
    $('hud-combo').textContent=b.combos[b.turn-1];
    $('hud-score').textContent=`${b.names[0]} ${b.scores[0]} : ${b.scores[1]} ${b.names[1]}`;
    const ti=$('turn-indicator');
    ti.classList.remove('hidden','p1','p2');
    ti.classList.add(b.turn===1?'p1':'p2');
    ti.textContent=`▶ ${b.names[b.turn-1]} 차례`;
  } else {
    $('hud-combo').textContent=G.combo;
    $('hud-score').textContent=G.score;
  }
}

// ---------- 타이머 ----------
function startTimer(sec, onTimeout){
  stopTimer();
  G.timeMax=sec; G.timeLeft=sec;
  const bar=$('timer-bar');
  bar.style.width='100%'; bar.classList.remove('danger');
  G.timer=setInterval(()=>{
    G.timeLeft-=0.1;
    const pct=Math.max(0,G.timeLeft/G.timeMax*100);
    bar.style.width=pct+'%';
    if(pct<30) bar.classList.add('danger');
    if(G.timeLeft<=0){ stopTimer(); onTimeout(); }
  },100);
}
function stopTimer(){ if(G.timer){ clearInterval(G.timer); G.timer=null; } }
function timeBonus(){ return Math.round(Math.max(0,G.timeLeft)/G.timeMax*50); }

// ---------- 점수 ----------
function award(correct, base){
  let pts=0;
  if(G.battle){
    const i=G.battle.turn-1;
    if(correct){
      G.battle.combos[i]++; G.battle.correct[i]++;
      pts=base+timeBonus()+G.battle.combos[i]*10;
      G.battle.scores[i]+=pts;
    } else G.battle.combos[i]=0;
  } else {
    if(correct){
      G.combo++; G.maxCombo=Math.max(G.maxCombo,G.combo); G.correctCnt++;
      pts=base+timeBonus()+G.combo*10;
      G.score+=pts;
    } else G.combo=0;
  }
  return pts;
}
function recordStat(region, correct){
  if(!region) return;
  const s=stats[region]||(stats[region]={c:0,t:0});
  s.t++; if(correct) s.c++;
  store.save('geo_stats',stats);
}

// ---------- 진행 ----------
function nextQuestion(){
  G.locked=false;
  clearMapTap();
  $('feedback-box').classList.add('hidden');
  $('btn-next').classList.add('hidden');
  clearMapExtras();

  if(G.mode==='ox'){
    if(Date.now()>=G.oxEnd || G.idx>=G.queue.length) return endGame();
  } else if(G.idx>=G.queue.length) return endGame();

  hudUpdate();
  let item=G.queue[G.idx], type=G.mode;
  if(G.mode==='battle'){
    type=item.btype; item=item.item;
    const noMap=(type==='mcq'||type==='ox'||(type==='climate'&&item.kind==='order'));
    $('map-pane').style.display=noMap?'none':'block';
    $('game-body').classList.toggle('no-map', noMap);
  }
  if(G.mode==='climate'){   // 순서형은 지도 불필요
    const noMap=item.kind==='order';
    $('map-pane').style.display=noMap?'none':'block';
    $('game-body').classList.toggle('no-map', noMap);
  }

  if(type==='location') askLocation(item);
  else if(type==='muniname') askMuniName(item);
  else if(type==='detective') askDetective(item);
  else if(type==='climate') askClimate(item);
  else if(type==='stats') askStats(item);
  else if(type==='mcq') askMCQ(item);
  else if(type==='ox') askOX(item);
}

function afterAnswer(){
  G.idx++;
  if(G.battle) G.battle.turn = G.battle.turn===1?2:1;
  if(G.mode==='ox'){ setTimeout(nextQuestion, 900); }
  else $('btn-next').classList.remove('hidden');
}
$('btn-next').onclick=nextQuestion;

// 학습 부가 정보: 기출 빈도 + 출제 경향 + 이미지 자료 링크
function studyExtra(name){
  const f=freqInfo(name), n=noteOf(name);
  let h='';
  if(f) h+=`<div class="fb-extra">🔥 최근 5개년 기출 <b>${f.count}회</b> 언급 (${f.exams}개 시험)</div>`;
  if(n) h+=`<div class="fb-extra">📌 ${n}</div>`;
  h+=`<div class="fb-extra">${imgSearchLink(name)}</div>`;
  return h;
}

function feedback(correct, head, body, pts){
  const fb=$('feedback-box');
  // 콤보 칭찬
  const combo = G.battle ? G.battle.combos[G.battle.turn-1] : G.combo;
  let flair='';
  if(correct && combo>=2){
    flair = combo>=7 ? ` · ${combo}연속! 백지도가 머릿속에 있다 🗺️✨`
          : combo>=5 ? ` · ${combo}연속! 지리 감각 폭발 🔥🔥`
          : combo>=3 ? ` · ${combo}연속 🔥` : ` · ${combo}연속!`;
  }
  fb.className='feedback-box '+(correct?'good':'bad');
  fb.innerHTML=`<div class="fb-head">${head}${flair}${pts?` <span class="fb-pts">+${pts}점</span>`:''}</div>${body}`;
  fb.classList.remove('hidden'); fb.classList.add('pop');
  setTimeout(()=>fb.classList.remove('pop'),400);
  // 모바일: 해설이 보이도록 자동 스크롤 + 가벼운 진동
  if(window.innerWidth<=820){
    setTimeout(()=>fb.scrollIntoView({behavior:'smooth', block:'center'}),60);
  }
  try { if(navigator.vibrate) navigator.vibrate(correct?25:[50,40,50]); } catch(e){}
}

// ============================================================
// 모드별 출제
// ============================================================
// --- 위치 사냥: 이름형 + 설명형(특징을 보고 추론) 혼합 ---
function askLocation(loc){
  const info=MODE_INFO[G.mode];
  // 설명형 비중 높게(약 65%) — 마스코트 항목은 항상 설명형
  const descForm = loc.descOnly || (loc.fact && loc.fact.length>=18 && Math.random()<0.65);
  if(descForm){
    const descText = maskName(loc.desc || loc.fact, loc);
    $('question-box').innerHTML=
      `<span class="q-region">${loc.region}</span> 다음 설명에 해당하는 지역을 백지도에서 탭하세요!`+
      `<div class="stat-card" style="font-weight:600">${descText}</div>`;
  } else {
    $('question-box').innerHTML=
      `<span class="q-region">${loc.region}</span> 백지도에서 <b style="color:var(--sea-d);font-size:1.2em">${loc.name}</b> ${loc.accept.length>1?'일대':'(이/가) 속한 시·군'}를 탭하세요!`;
  }
  $('choices-box').innerHTML='<div class="map-hint">💡 해당 시·군을 탭! 작으면 확대(핀치/＋) 후 탭하세요. 빗나가도 가까우면 절반 점수</div>';
  if(G.region!=='전체') dimOtherRegions(G.region);

  const reveal=()=>{
    loc.accept.forEach(n=>muniEl(n)?.classList.add('correct'));
    addDot(loc.x,loc.y,5,'loc-dot target-reveal');
    addLabel(loc.x,loc.y-10,loc.name);
  };
  const off=onMuniTap((t,e)=>{
    G.locked=true; stopTimer();
    const tapped=t.dataset.name;
    const p=svgPoint(e.clientX,e.clientY);
    const d=Math.hypot(p.x-loc.x, p.y-loc.y);
    let correct=false, base=0, head='';
    const baseFull = descForm ? 140 : 120;            // 설명형은 더 높은 점수
    if(loc.accept.includes(tapped)){ correct=true; base=baseFull; head='🎯 정확해요!'; }
    else if(d<=55){ correct=true; base=Math.round(baseFull/2); head=`👍 근접! (${tapped} 탭, 절반 점수)`; t.classList.add('wrong'); }
    else { head=`❌ 아쉬워요 (${tapped} 탭)`; t.classList.add('wrong'); }
    reveal();
    const pts=award(correct,base);
    recordStat(loc.region,correct);
    feedback(correct,head,`<b>${loc.name}</b> — ${loc.fact}`+studyExtra(loc.name),pts);
    hudUpdate(); afterAnswer();
  });
  startTimer(info.time||18,()=>{ if(G.locked)return; G.locked=true; off();
    reveal();
    award(false,0); recordStat(loc.region,false);
    feedback(false,'⏰ 시간 초과!',`<b>${loc.name}</b> — ${loc.fact}`+studyExtra(loc.name),0);
    hudUpdate(); afterAnswer();
  });
}

// --- 지역 추리: 힌트를 하나씩 열며 지역을 추리해 탭 (힌트를 아낄수록 고득점) ---
function buildHints(loc){
  const muniName=loc.accept[0].replace(/\(.+\)$/,'');
  const kind=muniName.endsWith('군')?'군(郡)':muniName.match(/(광역시|특별시|특별자치시)$/)?'광역 도시':'도시';
  const prov=MUNIS[loc.accept[0]]?.prov||'';
  const h1=`${loc.region} 지방의 ${kind}`;
  // 설명을 쉼표·가운뎃점 단위로 잘라 힌트 2~3개 구성
  const masked=maskName(loc.desc||loc.fact, loc);
  const parts=masked.split(/,\s*/).filter(s=>s.trim().length>=4);
  let h2, h3;
  if(parts.length>=2){
    h2=parts[0]; h3=parts.slice(1).join(', ');
  } else {
    const half=Math.ceil(masked.length/2);
    h2=masked.slice(0,half)+'…'; h3=masked;
  }
  return [h1, h2, h3+(prov?` (${prov})`:'')];
}
function askDetective(loc){
  const info=MODE_INFO[G.mode];
  const hints=buildHints(loc);
  let revealed=1;
  const HINT_COST=40, BASE=170;
  const renderQ=()=>{
    $('question-box').innerHTML=
      `<span class="q-region">지역 추리</span> 힌트로 지역을 추리해 지도에서 탭하세요! <span class="map-hint">힌트를 아낄수록 +점수</span>`+
      `<ol class="hint-list">${hints.slice(0,revealed).map(h=>`<li>${h}</li>`).join('')}</ol>`;
  };
  renderQ();
  const renderChoices=()=>{
    $('choices-box').innerHTML='';
    if(revealed<hints.length){
      const b=document.createElement('button');
      b.className='ghost-btn hint-btn';
      b.textContent=`💡 힌트 ${revealed+1} 열기 (-${HINT_COST}점)`;
      b.onclick=()=>{ if(G.locked) return; revealed++; renderQ(); renderChoices(); };
      $('choices-box').appendChild(b);
    } else {
      $('choices-box').innerHTML='<div class="map-hint">모든 힌트 공개! 이제 지도를 탭하세요</div>';
    }
  };
  renderChoices();
  if(G.region!=='전체') dimOtherRegions(G.region);

  const reveal=()=>{
    loc.accept.forEach(n=>muniEl(n)?.classList.add('correct'));
    addDot(loc.x,loc.y,5,'loc-dot target-reveal');
    addLabel(loc.x,loc.y-10,loc.name);
  };
  const expBody=()=>`<b>${loc.name}</b> — ${loc.fact}`+studyExtra(loc.name.replace(/\(.+\)$/,''));
  const handler=(e)=>{
    if(suppressTap||G.locked) return;
    const t=e.target.closest('.muni');
    if(!t) return;
    G.locked=true; clearMapTap(); stopTimer();
    const tapped=t.dataset.name;
    const p=svgPoint(e.clientX,e.clientY);
    const d=Math.hypot(p.x-loc.x, p.y-loc.y);
    const baseFull=Math.max(60, BASE-(revealed-1)*HINT_COST);
    let correct=false, base=0, head='';
    if(loc.accept.includes(tapped)){ correct=true; base=baseFull; head=`🕵️ 명추리! (힌트 ${revealed}개)`; }
    else if(d<=55){ correct=true; base=Math.round(baseFull/2); head=`👍 근접! (${tapped} 탭, 절반 점수)`; t.classList.add('wrong'); }
    else { head=`❌ 아쉬워요 (${tapped} 탭)`; t.classList.add('wrong'); }
    reveal();
    const pts=award(correct,base);
    recordStat(loc.region,correct);
    feedback(correct,head,expBody(),pts);
    hudUpdate(); afterAnswer();
  };
  setMapTap(handler);
  startTimer(info.time||40,()=>{ if(G.locked)return; G.locked=true; clearMapTap();
    reveal(); award(false,0); recordStat(loc.region,false);
    feedback(false,'⏰ 시간 초과!',expBody(),0);
    hudUpdate(); afterAnswer();
  });
}

// --- 지역 판독: 하이라이트된 시·군의 이름 맞히기 ---
function askMuniName(name){
  const info=MODE_INFO[G.mode];
  const m=MUNIS[name];
  $('question-box').innerHTML=
    `<span class="q-region">${m.region}</span> 지도에 <b style="color:var(--accent)">깜빡이는 시·군</b>의 이름은? <span class="map-hint">(${m.prov})</span>`;
  muniEl(name)?.classList.add('flash','pulse');
  if(G.region!=='전체') dimOtherRegions(G.region);
  // 같은 시·도 내에서 오답 3개
  const sib=shuffle(Object.keys(MUNIS).filter(n=>n!==name&&MUNIS[n].prov===m.prov));
  let opts=sib.slice(0,3);
  if(opts.length<3) opts=opts.concat(shuffle(Object.keys(MUNIS).filter(n=>n!==name&&!opts.includes(n))).slice(0,3-opts.length));
  const choices=shuffle([name,...opts]);

  const box=$('choices-box'); box.innerHTML='<div class="choices-grid2"></div>';
  const grid=box.firstChild;
  choices.forEach(n=>{
    const b=document.createElement('button');
    b.className='choice-btn'; b.textContent=n.replace(/\(.+\)$/,'');
    b.dataset.n=n;
    b.onclick=()=>{
      if(G.locked) return; G.locked=true; stopTimer();
      grid.querySelectorAll('button').forEach(x=>x.disabled=true);
      const correct=n===name;
      b.classList.add(correct?'correct':'wrong');
      if(!correct) grid.querySelectorAll('button').forEach(x=>{ if(x.dataset.n===name) x.classList.add('correct'); });
      muniEl(name)?.classList.remove('pulse');
      muniEl(name)?.classList.add('correct');
      const pts=award(correct,100);
      recordStat(m.region,correct);
      feedback(correct,correct?'⭕ 정답!':'❌ 오답!',`<b>${name}</b> (${m.prov})`+studyExtra(name.replace(/\(.+\)$/,'')),pts);
      hudUpdate(); afterAnswer();
    };
    grid.appendChild(b);
  });
  startTimer(info.time||15,()=>{ if(G.locked)return; G.locked=true;
    grid.querySelectorAll('button').forEach(x=>{ x.disabled=true; if(x.dataset.n===name) x.classList.add('correct'); });
    muniEl(name)?.classList.remove('pulse'); muniEl(name)?.classList.add('correct');
    award(false,0); recordStat(m.region,false);
    feedback(false,'⏰ 시간 초과!',`<b>${name}</b> (${m.prov})`,0);
    hudUpdate(); afterAnswer();
  });
}

// --- 기후 판별: 실제 평년값 그래프를 보고 지역 맞히기 ---
function climateIndicators(st){
  const tmin=Math.min(...st.t), tmax=Math.max(...st.t);
  const total=st.p.reduce((a,b)=>a+b,0);
  const summer=st.p[5]+st.p[6]+st.p[7];                 // 6~8월
  const winter=st.p[11]+st.p[0]+st.p[1];                // 12~2월
  return {tmin, tmax, range:+(tmax-tmin).toFixed(1), total:Math.round(total),
          sRate:Math.round(summer/total*100), wRate:Math.round(winter/total*100)};
}
// ----- 2지역 비교용 차트 렌더러들 (유형 다양화) -----
// 묶음 막대: 지표별로 (가)(나) 막대 비교
function renderPairBars(rows, metas, labels){
  labels = labels || ['(가)','(나)'];
  const W=330, H=46+metas.length*58;
  let body='';
  metas.forEach((m,mi)=>{
    const v=[rows[0].v[mi], rows[1].v[mi]];
    const max=Math.max(...v.map(Math.abs), 1e-9);
    const y0=40+mi*58;
    body+=`<text x="10" y="${y0}" font-size="10" font-weight="700" fill="#1B4F8F">${m.label}(${m.unit})</text>`;
    v.forEach((val,i)=>{
      const bw=Math.max(6, Math.abs(val)/max*180);
      const y=y0+8+i*18;
      body+=`<text x="10" y="${y+11}" font-size="10" font-weight="800" fill="#2C4A66">${labels[i]}</text>`+
        `<rect x="38" y="${y}" width="${bw.toFixed(1)}" height="13" rx="4" fill="${i===0?'#20A2EE':'#A4CE4E'}"/>`+
        `<text x="${(42+bw).toFixed(1)}" y="${y+11}" font-size="10" fill="#6E93AE">${val}</text>`;
    });
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="climate-graph" xmlns="http://www.w3.org/2000/svg">
    <text x="10" y="18" font-size="9" fill="#98B9CE">자료 비교</text>${body}</svg>`;
}
// 도표: 수능식 표
function renderPairTable(rows, metas, labels){
  labels = labels || ['(가)','(나)'];
  const tr=metas.map((m,mi)=>
    `<tr><td>${m.label}(${m.unit})</td><td>${rows[0].v[mi]}</td><td>${rows[1].v[mi]}</td></tr>`).join('');
  return `<table class="pair-table"><thead><tr><th>구분</th><th>${labels[0]}</th><th>${labels[1]}</th></tr></thead><tbody>${tr}</tbody></table>`;
}
// 기후 그래프 2개 나란히 (수능 단골 형태)
function renderDualClimate(stA, stB, labels){
  labels = labels || ['(가)','(나)'];
  return `<div class="dual-climate">
    <div><div class="dual-label">${labels[0]}</div>${renderClimateSVG(stA)}</div>
    <div><div class="dual-label">${labels[1]}</div>${renderClimateSVG(stB)}</div>
  </div>`;
}
function renderClimateSVG(st){
  const W=340, H=210, L=38, R=44, T=14, B=24;
  const pw=W-L-R, ph=H-T-B;
  const pMax=Math.max(450, Math.ceil(Math.max(...st.p)/50)*50);
  const tLo=-30, tHi=30;
  const x=i=>L+pw*(i+0.5)/12;
  const yT=v=>T+ph*(1-(v-tLo)/(tHi-tLo));
  const yP=v=>T+ph*(1-v/pMax);
  let bars='', line='', dots='', gridT='';
  st.p.forEach((v,i)=>{ const bw=pw/12*0.62;
    bars+=`<rect x="${(x(i)-bw/2).toFixed(1)}" y="${yP(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H-B-yP(v)).toFixed(1)}" fill="#5BB8F0" opacity=".85"/>`; });
  line='<polyline fill="none" stroke="#E2574C" stroke-width="2" points="'+
    st.t.map((v,i)=>`${x(i).toFixed(1)},${yT(v).toFixed(1)}`).join(' ')+'"/>';
  st.t.forEach((v,i)=>{ dots+=`<circle cx="${x(i).toFixed(1)}" cy="${yT(v).toFixed(1)}" r="2.4" fill="#E2574C"/>`; });
  [-20,-10,0,10,20].forEach(v=>{ gridT+=`<line x1="${L}" y1="${yT(v)}" x2="${W-R}" y2="${yT(v)}" stroke="#D8E8F2" stroke-width="${v===0?1.2:0.6}"/>`+
    `<text x="${L-5}" y="${yT(v)+3}" text-anchor="end" font-size="8" fill="#6E93AE">${v}</text>`; });
  let gridP='';
  for(let v=100; v<pMax; v+=100) gridP+=`<text x="${W-R+5}" y="${(yP(v)+3).toFixed(1)}" font-size="8" fill="#6E93AE">${v}</text>`;
  const months=[1,3,5,7,9,11].map(m=>`<text x="${x(m-1).toFixed(1)}" y="${H-9}" text-anchor="middle" font-size="8" fill="#6E93AE">${m}월</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="climate-graph" xmlns="http://www.w3.org/2000/svg">
    ${gridT}${gridP}${bars}${line}${dots}${months}
    <text x="${L-5}" y="${T-3}" font-size="8" fill="#E2574C">기온(℃)</text>
    <text x="${W-R+5}" y="${T-3}" font-size="8" fill="#1278C2">강수량(mm)</text>
    <line x1="${L}" y1="${H-B}" x2="${W-R}" y2="${H-B}" stroke="#A9CDE3" stroke-width="1"/>
  </svg>`;
}
// ----- 매칭형 공통 유틸 -----
const PERMS3=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
const MARK_L=['A','B','C'];
function buildPermChoices(correct){
  const others=shuffle(PERMS3.filter(p=>p.join()!==correct.join())).slice(0,4);
  return shuffle([correct, ...others]);
}
function permText(perm){ return ['(가)','(나)','(다)'].map((g,i)=>`${g}-${MARK_L[perm[i]]}`).join(' · '); }
// 지도 마커 A·B·C: 좌상단 → 우상단 순서 (x 우선, 비슷하면 북쪽 먼저)
function sortMarkers(arr, xy){
  return arr.slice().sort((a,b)=>{
    const A=xy(a), B=xy(b);
    if(Math.abs(A.x-B.x)>=45) return A.x-B.x;
    return A.y-B.y;
  });
}
function fitViewTo(pts, pad){
  const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y);
  let x0=Math.min(...xs)-pad, y0=Math.min(...ys)-pad;
  let w=Math.max(...xs)-Math.min(...xs)+pad*2, h=Math.max(...ys)-Math.min(...ys)+pad*2;
  const s=Math.max(w,h,220);             // 너무 과한 확대 방지
  animateView(clampedTarget({x:x0-(s-w)/2, y:y0-(s-h)/2, w:s, h:s*VIEW0.h/VIEW0.w}));
}
function addMatchMark(x, y, letter){
  const svg=$('map-svg');
  const g=document.createElementNS('http://www.w3.org/2000/svg','g');
  g.setAttribute('class','match-mark');
  g.innerHTML=`<circle cx="${x}" cy="${y}" r="13" fill="#E2574C" stroke="#FFFFFF" stroke-width="2.5"/>`+
    `<text x="${x}" y="${y+5}" text-anchor="middle" font-size="14" font-weight="800" fill="#FFFFFF">${letter}</text>`;
  svg.appendChild(g); return g;
}
// 산점도: 두 지표 평면에 (가)~(다) 점 표시 — 수능 자료 형식
function renderScatterSVG(rows, m1, m2, labels){
  const W=320,H=230,L=52,R=16,T=18,B=40;
  const xs=rows.map(r=>r.v1), ys=rows.map(r=>r.v2);
  const x0=Math.min(...xs), x1=Math.max(...xs), y0=Math.min(...ys), y1=Math.max(...ys);
  const px=v=>L+(W-L-R)*((v-x0)/((x1-x0)||1)*0.8+0.1);
  const py=v=>T+(H-T-B)*(1-((v-y0)/((y1-y0)||1)*0.8+0.1));
  let pts='';
  labels = labels || ['(가)','(나)','(다)'];
  rows.forEach((r,i)=>{
    pts+=`<circle cx="${px(r.v1).toFixed(1)}" cy="${py(r.v2).toFixed(1)}" r="5.5" fill="#1278C2" stroke="#fff" stroke-width="1.5"/>`+
      `<text x="${px(r.v1).toFixed(1)}" y="${(py(r.v2)-10).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="800" fill="#1B4F8F">${labels[i]}</text>`+
      `<text x="${px(r.v1).toFixed(1)}" y="${(py(r.v2)+18).toFixed(1)}" text-anchor="middle" font-size="9" fill="#6E93AE">${r.v1}${m1.unit==='%'||m1.unit==='℃'?m1.unit:''}, ${r.v2}${m2.unit==='%'||m2.unit==='℃'?m2.unit:''}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="climate-graph" xmlns="http://www.w3.org/2000/svg">
    <line x1="${L}" y1="${H-B}" x2="${W-R}" y2="${H-B}" stroke="#A9CDE3"/>
    <line x1="${L}" y1="${T}" x2="${L}" y2="${H-B}" stroke="#A9CDE3"/>
    <text x="${(L+W-R)/2}" y="${H-12}" text-anchor="middle" font-size="10" fill="#6E93AE">${m1.label}(${m1.unit}) →</text>
    <text x="14" y="${(T+H-B)/2}" font-size="10" fill="#6E93AE" transform="rotate(-90 14 ${(T+H-B)/2})" text-anchor="middle">${m2.label}(${m2.unit}) →</text>
    ${pts}</svg>`;
}

// --- 기후 비교: 매칭형(지도 A~C ↔ 자료 가나다) / 순서형 ---
function climVal(st, key){
  const ind=climateIndicators(st);
  return key==='tavg' ? +(st.t.reduce((a,b)=>a+b,0)/12).toFixed(1) : ind[key==='tmin'?'tmin':key==='tmax'?'tmax':key];
}
function askClimate(item){
  if(item.kind==='order') return askClimateOrder(item.set);
  return askClimateMatch(item.set);
}
// ----- 2지역 비교 공통: 진술형 보기 생성 ("A는 B보다 ~") -----
function cmpWord(key, meta){
  if(key==='range'||key==='popGrow') return '크다';
  if(meta.unit==='℃'||meta.unit==='%') return '높다';
  return '많다';
}
function pairStatements(valsA, valsB, keys, metaOf){
  const cands=[];
  keys.forEach((k,ki)=>{
    const a=valsA[ki], b=valsB[ki];
    if(a==null||b==null) return;
    const diff=Math.abs(a-b), base=Math.max(Math.abs(a),Math.abs(b),1e-9);
    if(diff/base<0.07 && diff<0.7) return;            // 동률에 가까운 지표 제외
    const m=metaOf(k), w=cmpWord(k,m);
    cands.push({text:`A는 B보다 ${m.label}이(가) ${w}.`, truth:a>b});
    cands.push({text:`B는 A보다 ${m.label}이(가) ${w}.`, truth:b>a});
  });
  const trues=shuffle(cands.filter(c=>c.truth));
  const falses=shuffle(cands.filter(c=>!c.truth));
  if(!trues.length || falses.length<3) return null;
  return shuffle([trues[0], ...falses.slice(0,3)]);
}

function askClimateMatch(set){
  const info=MODE_INFO[G.mode];
  // 세트에서 2개 지역만 추출 (빠른 템포)
  const pick=shuffle(set.st.slice()).slice(0,2).map(n=>CLIMATE.find(c=>c.name===n));
  const markers=sortMarkers(pick, s=>({x:s.x, y:s.y}));            // A·B: 좌상단→우상단
  const gOrder=[0,1].sort((a,b)=>climVal(markers[a],set.inds[0])-climVal(markers[b],set.inds[0])); // (가)(나): 왼쪽부터
  const metas=set.inds.map(k=>CLIM_INDS[k]);
  markers.forEach((s,i)=>addMatchMark(s.x, s.y, MARK_L[i]));
  fitViewTo(markers, 95);

  const allKeys=Object.keys(CLIM_INDS);
  const stmts=pairStatements(
    allKeys.map(k=>climVal(markers[0],k)), allKeys.map(k=>climVal(markers[1],k)),
    allKeys, k=>CLIM_INDS[k]);
  const qtype = (stmts && Math.random()>=0.62) ? 'stmt' : 'tap';

  // 차트 유형 다양화
  const chartLabels = qtype==='tap' ? ['(가)','(나)'] : ['A','B'];
  const chartRows = (qtype==='tap'?gOrder:[0,1]).map(mi=>({v:set.inds.map(k=>climVal(markers[mi],k))}));
  const ct=['dual','table','bars','scatter'][Math.floor(Math.random()*4)];
  let chart;
  if(ct==='dual') chart=renderDualClimate(markers[(qtype==='tap'?gOrder:[0,1])[0]], markers[(qtype==='tap'?gOrder:[0,1])[1]], chartLabels);
  else if(ct==='table') chart=renderPairTable(chartRows, metas, chartLabels);
  else if(ct==='bars') chart=renderPairBars(chartRows, metas, chartLabels);
  else chart=renderScatterSVG(chartRows.map(r=>({v1:r.v[0], v2:r.v[1]})), metas[0], metas[1], chartLabels);

  const expBody=()=>`A: ${markers[0].name} · B: ${markers[1].name}<div class="fb-extra">📌 ${set.point}</div>`;
  const revealNames=()=>{
    document.querySelectorAll('#map-svg .match-mark').forEach(g=>g.remove());
    markers.forEach(s=>{ addDot(s.x,s.y,5,'loc-dot target-reveal'); addLabel(s.x,s.y-10,s.name); });
  };

  if(qtype==='tap'){
    const target=markers[gOrder[0]];                 // (가)에 해당하는 지역
    $('question-box').innerHTML=
      `<span class="q-region">기후 비교</span> 자료의 <b style="color:var(--sea-d)">(가)</b>에 해당하는 지역을 지도의 A·B에서 탭하세요!`+
      chart+`<div class="map-hint">1991~2020년 평년값 · 위치(위도·해안/내륙·고도)로 판단!</div>`;
    $('choices-box').innerHTML='';
    const handler=(e)=>{
      if(suppressTap||G.locked) return;
      const p=svgPoint(e.clientX,e.clientY);
      const d0=Math.hypot(p.x-markers[0].x,p.y-markers[0].y), d1=Math.hypot(p.x-markers[1].x,p.y-markers[1].y);
      const tapped=d0<=d1?0:1;
      G.locked=true; clearMapTap(); stopTimer();
      const ok=markers[tapped]===target;
      revealNames();
      const pts=award(ok,90);
      pick.forEach(s=>recordStat(s.region,ok));
      feedback(ok, ok?'정답':`오답 (탭: ${MARK_L[tapped]})`, `(가)는 <b>${MARK_L[markers.indexOf(target)]} ${target.name}</b> · `+expBody(), pts);
      hudUpdate(); afterAnswer();
    };
    setMapTap(handler);
    startTimer(28,()=>{ if(G.locked)return; G.locked=true; clearMapTap();
      revealNames(); award(false,0); pick.forEach(s=>recordStat(s.region,false));
      feedback(false,'시간 초과',`(가)는 <b>${target.name}</b> · `+expBody(),0);
      hudUpdate(); afterAnswer();
    });
  } else {
    $('question-box').innerHTML=
      `<span class="q-region">기후 비교</span> 지도에 표시된 A, B 두 지역에 대한 설명으로 <b style="color:var(--sea-d)">옳은 것</b>은?`+
      chart+`<div class="map-hint">자료와 위치를 함께 보고 판단하세요</div>`;
    const box=$('choices-box'); box.innerHTML='';
    stmts.forEach(st=>{
      const b=document.createElement('button');
      b.className='choice-btn'; b.textContent=st.text; b.dataset.t=st.truth?'1':'0';
      b.onclick=()=>{
        if(G.locked) return; G.locked=true; stopTimer();
        box.querySelectorAll('button').forEach(x=>x.disabled=true);
        const ok=st.truth;
        b.classList.add(ok?'correct':'wrong');
        if(!ok) box.querySelectorAll('button').forEach(x=>{ if(x.dataset.t==='1') x.classList.add('correct'); });
        revealNames();
        const pts=award(ok,120);
        pick.forEach(s=>recordStat(s.region,ok));
        feedback(ok,ok?'정답':'오답',expBody(),pts);
        hudUpdate(); afterAnswer();
      };
      box.appendChild(b);
    });
    startTimer(info.time||30,()=>{ if(G.locked)return; G.locked=true;
      box.querySelectorAll('button').forEach(x=>{ x.disabled=true; if(x.dataset.t==='1') x.classList.add('correct'); });
      revealNames(); award(false,0); pick.forEach(s=>recordStat(s.region,false));
      feedback(false,'시간 초과',expBody(),0);
      hudUpdate(); afterAnswer();
    });
  }
}
function askClimateOrder(set){
  const sts=set.st.map(n=>CLIMATE.find(c=>c.name===n));
  const m=CLIM_INDS[set.ind];
  const sorted=sts.slice().sort((a,b)=>climVal(b,set.ind)-climVal(a,set.ind));
  const correct=sorted.map(s=>s.name).join(' > ');
  $('question-box').innerHTML=
    `<span class="q-region">기후 비교</span> 다음 세 지역을 <b style="color:var(--accent-l)">${m.label}</b>이(가) 큰 지역부터 순서대로 옳게 나열한 것은?`+
    `<div class="stat-card" style="text-align:center;font-weight:700">${shuffle(sts.slice()).map(s=>s.name).join(' · ')}</div>`+
    `<div class="map-hint">위치(위도·내륙/해안·고도)를 떠올리며 상대 비교 — 절댓값 암기가 아닌 원리로!</div>`;
  let perms=shuffle(PERMS3).slice(0,5);
  if(!perms.some(p=>p.map(i=>sts[i].name).join(' > ')===correct)){
    perms[0]=sorted.map(s=>sts.indexOf(s)); perms=shuffle(perms);   // 정답 보장 후 재섞기
  }
  const expBody=`${sorted.map(s=>`${s.name} ${climVal(s,set.ind)}${m.unit}`).join(' > ')}<div class="fb-extra">📌 ${set.point}</div>`;
  const box=$('choices-box'); box.innerHTML='';
  perms.forEach(p=>{
    const txt=p.map(i=>sts[i].name).join(' > ');
    const b=document.createElement('button');
    b.className='choice-btn'; b.textContent=txt; b.dataset.t=txt;
    b.onclick=()=>{
      if(G.locked) return; G.locked=true; stopTimer();
      box.querySelectorAll('button').forEach(x=>x.disabled=true);
      const ok=txt===correct;
      b.classList.add(ok?'correct':'wrong');
      if(!ok) box.querySelectorAll('button').forEach(x=>{ if(x.dataset.t===correct) x.classList.add('correct'); });
      const pts=award(ok,110);
      sts.forEach(s=>recordStat(s.region,ok));
      feedback(ok,ok?'정답':'오답',expBody,pts);
      hudUpdate(); afterAnswer();
    };
    box.appendChild(b);
  });
  startTimer(MODE_INFO[G.mode].time||25,()=>{ if(G.locked)return; G.locked=true;
    box.querySelectorAll('button').forEach(x=>{ x.disabled=true; if(x.dataset.t===correct) x.classList.add('correct'); });
    award(false,0); sts.forEach(s=>recordStat(s.region,false));
    feedback(false,'시간 초과',expBody,0);
    hudUpdate(); afterAnswer();
  });
}

// --- 통계 비교: 지도에 표시된 세 시·도 A~C ↔ 통계 자료 (가)~(다) 매칭 ---
let PROV_CENTER=null;
function provCenter(name){
  if(!PROV_CENTER){
    PROV_CENTER={};
    const acc={};
    for(const [n,m] of Object.entries(MUNIS)){
      (acc[m.prov]=acc[m.prov]||[]).push([m.cx,m.cy]);
    }
    for(const [p,pts] of Object.entries(acc)){
      PROV_CENTER[p]={x:pts.reduce((a,b)=>a+b[0],0)/pts.length, y:pts.reduce((a,b)=>a+b[1],0)/pts.length};
    }
  }
  return PROV_CENTER[name];
}
function statVal(sd, key){
  if(key==='popGrow') return sd.pop1970 ? +(sd.pop2020/sd.pop1970).toFixed(1) : null;
  const m=STAT_INDS[key];
  return +(sd[key]*m.scale).toFixed(sd[key]*m.scale>=100?0:1);
}
function shortSido(n){ return n.replace(/(특별자치시|특별자치도|광역시|특별시)$/,''); }
function askStats(set){
  const info=MODE_INFO[G.mode];
  const pick=shuffle(set.sd.slice()).slice(0,2).map(n=>SIDO_STATS.find(s=>s.name===n));
  const markers=sortMarkers(pick, s=>provCenter(s.name));          // A·B: 좌상단→우상단
  const gOrder=[0,1].sort((a,b)=>statVal(markers[a],set.inds[0])-statVal(markers[b],set.inds[0]));
  const metas=set.inds.map(k=>STAT_INDS[k]);

  const target=new Set(markers.map(s=>s.name));
  document.querySelectorAll('#map-svg .muni').forEach(x=>{ if(!target.has(x.dataset.prov)) x.classList.add('dim-region'); });
  markers.forEach((s,i)=>{ const c=provCenter(s.name); addMatchMark(c.x, c.y, MARK_L[i]); });

  const allKeys=Object.keys(STAT_INDS);
  const stmts=pairStatements(
    allKeys.map(k=>statVal(markers[0],k)), allKeys.map(k=>statVal(markers[1],k)),
    allKeys, k=>STAT_INDS[k]);
  const qtype = (stmts && Math.random()>=0.62) ? 'stmt' : 'tap';

  const chartLabels = qtype==='tap' ? ['(가)','(나)'] : ['A','B'];
  const chartRows = (qtype==='tap'?gOrder:[0,1]).map(mi=>({v:set.inds.map(k=>statVal(markers[mi],k))}));
  const ct=['table','bars','scatter'][Math.floor(Math.random()*3)];
  let chart;
  if(ct==='table') chart=renderPairTable(chartRows, metas, chartLabels);
  else if(ct==='bars') chart=renderPairBars(chartRows, metas, chartLabels);
  else chart=renderScatterSVG(chartRows.map(r=>({v1:r.v[0], v2:r.v[1]})), metas[0], metas[1], chartLabels);

  const expBody=()=>`A: ${shortSido(markers[0].name)} · B: ${shortSido(markers[1].name)}<div class="fb-extra">📌 ${set.point}</div>`;
  const revealNames=()=>{
    document.querySelectorAll('#map-svg .match-mark').forEach(g=>g.remove());
    markers.forEach(s=>{ const c=provCenter(s.name); addLabel(c.x, c.y+4, shortSido(s.name)); });
  };

  if(qtype==='tap'){
    const targetSd=markers[gOrder[0]];
    $('question-box').innerHTML=
      `<span class="q-region">통계 비교</span> 자료의 <b style="color:var(--sea-d)">(가)</b>에 해당하는 시·도를 지도의 A·B에서 탭하세요!`+
      chart+`<div class="map-hint">통계청 자료 — 산업·인구의 지역 차로 판단! (A·B 시·도만 탭 가능)</div>`;
    $('choices-box').innerHTML='';
    const handler=(e)=>{
      if(suppressTap||G.locked) return;
      const t=e.target.closest('.muni');
      if(!t || !target.has(t.dataset.prov)) return;      // A·B 외 탭은 무시
      G.locked=true; clearMapTap(); stopTimer();
      const ok=t.dataset.prov===targetSd.name;
      revealNames();
      const pts=award(ok,90);
      pick.forEach(s=>recordStat(PROVINCES[s.name]?.region,ok));
      feedback(ok, ok?'정답':`오답 (탭: ${shortSido(t.dataset.prov)})`, `(가)는 <b>${shortSido(targetSd.name)}</b> · `+expBody(), pts);
      hudUpdate(); afterAnswer();
    };
    setMapTap(handler);
    startTimer(28,()=>{ if(G.locked)return; G.locked=true; clearMapTap();
      revealNames(); award(false,0); pick.forEach(s=>recordStat(PROVINCES[s.name]?.region,false));
      feedback(false,'시간 초과',`(가)는 <b>${shortSido(targetSd.name)}</b> · `+expBody(),0);
      hudUpdate(); afterAnswer();
    });
  } else {
    $('question-box').innerHTML=
      `<span class="q-region">통계 비교</span> 지도에 표시된 A, B 두 시·도에 대한 설명으로 <b style="color:var(--sea-d)">옳은 것</b>은?`+
      chart+`<div class="map-hint">자료와 위치를 함께 보고 판단하세요</div>`;
    const box=$('choices-box'); box.innerHTML='';
    stmts.forEach(st=>{
      const b=document.createElement('button');
      b.className='choice-btn'; b.textContent=st.text; b.dataset.t=st.truth?'1':'0';
      b.onclick=()=>{
        if(G.locked) return; G.locked=true; stopTimer();
        box.querySelectorAll('button').forEach(x=>x.disabled=true);
        const ok=st.truth;
        b.classList.add(ok?'correct':'wrong');
        if(!ok) box.querySelectorAll('button').forEach(x=>{ if(x.dataset.t==='1') x.classList.add('correct'); });
        revealNames();
        const pts=award(ok,120);
        pick.forEach(s=>recordStat(PROVINCES[s.name]?.region,ok));
        feedback(ok,ok?'정답':'오답',expBody(),pts);
        hudUpdate(); afterAnswer();
      };
      box.appendChild(b);
    });
    startTimer(info.time||30,()=>{ if(G.locked)return; G.locked=true;
      box.querySelectorAll('button').forEach(x=>{ x.disabled=true; if(x.dataset.t==='1') x.classList.add('correct'); });
      revealNames(); award(false,0); pick.forEach(s=>recordStat(PROVINCES[s.name]?.region,false));
      feedback(false,'시간 초과',expBody(),0);
      hudUpdate(); afterAnswer();
    });
  }
}

// --- 4지선다 ---
function askMCQ(q){
  const info=MODE_INFO[G.mode];
  $('question-box').innerHTML=`<span class="q-region">${q.region}</span> ${q.q}`;
  const box=$('choices-box'); box.innerHTML='';
  const order=shuffle(q.choices.map((c,i)=>i));
  order.forEach(i=>{
    const b=document.createElement('button');
    b.className='choice-btn'; b.innerHTML=q.choices[i];
    b.dataset.i=i;
    b.onclick=()=>{
      if(G.locked) return; G.locked=true; stopTimer();
      box.querySelectorAll('button').forEach(x=>x.disabled=true);
      const correct=i===q.answer;
      b.classList.add(correct?'correct':'wrong');
      if(!correct){ box.querySelectorAll('button').forEach(x=>{ if(x.dataset.i==q.answer) x.classList.add('correct'); }); }
      const pts=award(correct,100);
      recordStat(q.region,correct);
      feedback(correct,correct?'⭕ 정답!':'❌ 오답!',`💡 ${q.exp}`,pts);
      hudUpdate(); afterAnswer();
    };
    box.appendChild(b);
  });
  startTimer(info.time||25,()=>{ if(G.locked)return; G.locked=true;
    box.querySelectorAll('button').forEach(x=>{ x.disabled=true; if(x.dataset.i==q.answer) x.classList.add('correct'); });
    award(false,0); recordStat(q.region,false);
    feedback(false,'⏰ 시간 초과!',`💡 ${q.exp}`,0);
    hudUpdate(); afterAnswer();
  });
}

// --- OX ---
function askOX(q){
  $('question-box').innerHTML=`<span class="q-region">${q.region}</span> ${q.q}`;
  const box=$('choices-box');
  box.innerHTML='<div class="ox-row"></div>';
  const row=box.firstChild;
  [['⭕',true],['❌',false]].forEach(([label,val])=>{
    const b=document.createElement('button');
    b.className='choice-btn'; b.textContent=label;
    b.onclick=()=>{
      if(G.locked) return; G.locked=true; stopTimer();
      row.querySelectorAll('button').forEach(x=>x.disabled=true);
      const correct=val===q.answer;
      b.classList.add(correct?'correct':'wrong');
      const pts=award(correct,70);
      recordStat(q.region,correct);
      feedback(correct,correct?'⭕ 정답!':'❌ 오답!',`정답: ${q.answer?'O':'X'} — ${q.exp}`,pts);
      hudUpdate(); afterAnswer();
    };
    row.appendChild(b);
  });
  const sec = G.mode==='battle' ? 8 : Math.min(8,(G.oxEnd-Date.now())/1000);
  startTimer(Math.max(1,sec),()=>{ if(G.locked)return; G.locked=true;
    row.querySelectorAll('button').forEach(x=>x.disabled=true);
    award(false,0); recordStat(q.region,false);
    if(G.mode==='ox' && Date.now()>=G.oxEnd) return endGame();
    feedback(false,'⏰ 시간 초과!',`정답: ${q.answer?'O':'X'} — ${q.exp}`,0);
    hudUpdate(); afterAnswer();
  });
}

// ============================================================
// 탐색(학습) 모드 — 탭 기반
// ============================================================
function startExplore(){
  show('screen-game');
  ['hud-qnum','hud-combo','hud-score'].forEach(id=>$(id).parentElement.style.visibility='hidden');
  $('timer-bar').style.width='0%';

  $('question-box').innerHTML='<span class="q-region">학습 모드</span> 시·군이나 파란 점을 탭하면 정보가 표시됩니다.';
  const box=$('choices-box');
  box.innerHTML='<div class="explore-controls" id="exp-chips"></div><div id="exp-info" style="color:var(--dim);font-size:.9rem;line-height:1.6">아직 선택된 지역이 없습니다.</div>';
  const chipBox=$('exp-chips');
  ['전체',...MAP_REGIONS].forEach(r=>{
    const b=document.createElement('button');
    b.className='chip'+(r==='전체'?' on':''); b.textContent=r;
    b.onclick=()=>{ chipBox.querySelectorAll('.chip').forEach(c=>c.classList.remove('on')); b.classList.add('on'); renderExploreDots(r); };
    chipBox.appendChild(b);
  });
  renderExploreDots('전체');

  // 시·군 탭 → 정보 표시 (상시 리스너)
  const svg=$('map-svg');
  svg.onclick=(e)=>{
    if(suppressTap) return;
    const dot=e.target.closest('.loc-dot');
    if(dot){ showLocInfo(dot.dataset.name); return; }
    const t=e.target.closest('.muni');
    if(!t) return;
    document.querySelectorAll('#map-svg .muni').forEach(x=>x.classList.remove('flash'));
    t.classList.add('flash');
    const name=t.dataset.name;
    const inside=LOCATIONS.filter(l=>l.accept.includes(name));
    $('exp-info').innerHTML=
      `<b style="color:var(--accent);font-size:1.08rem">${name}</b> <span class="q-region" style="margin-left:6px">${t.dataset.prov}</span>`+
      (inside.length? inside.map(l=>`<div style="margin-top:7px"><b>📍 ${l.name}</b><br>${l.fact}</div>`).join('')
        : '<div style="margin-top:7px">등록된 수능 포인트가 없는 지역입니다. 경계와 위치만 눈에 익혀 두세요!</div>')+
      studyExtra(name.replace(/\(.+\)$/,''));
  };
}
function showLocInfo(name){
  const l=LOCATIONS.find(x=>x.name===name);
  if(!l) return;
  $('exp-info').innerHTML=`<b style="color:var(--accent);font-size:1.08rem">📍 ${l.name}</b> <span class="q-region" style="margin-left:6px">${l.region}</span><div style="margin-top:7px">${l.fact}</div>`+studyExtra(l.name);
}
function renderExploreDots(region){
  clearMapExtras();
  dimOtherRegions(region==='전체'?'전체':region);
  const tip=$('map-tooltip');
  LOCATIONS.filter(l=>region==='전체'||l.region===region).forEach(l=>{
    const d=addDot(l.x,l.y,4.5+Math.min(freqOf(l.name),30)*0.12,'loc-dot');  // 빈출 지역일수록 큰 점
    d.dataset.name=l.name;
    d.onmousemove=(e)=>{ if(matchMedia('(hover:hover)').matches){ tip.classList.remove('hidden'); tip.innerHTML=`<b>${l.name}</b><br>${l.fact}`; positionTip(e,tip); } };
    d.onmouseleave=()=>tip.classList.add('hidden');
  });
}
function positionTip(e,tip){
  const rect=$('map-pane').getBoundingClientRect();
  tip.style.left=Math.max(4, Math.min(rect.width-270, e.clientX-rect.left+14))+'px';
  tip.style.top=(e.clientY-rect.top+10)+'px';
}

// ============================================================
// 🎴 지역 카드 컬렉션 (뽑기/수집)
// ============================================================
let coins = store.load('geo_coins', 0);
let cards = store.load('geo_cards', {});          // {지역명: 보유 수}
const DRAW_COST = 5;

function rarityOf(loc){
  const f=freqOf(loc.accept[0]);
  return f>=15 ? '전설' : f>=4 ? '희귀' : '일반';
}
const RARITY_META = {
  '전설': {cls:'legend', label:'★ 전설', p:0.05},
  '희귀': {cls:'rare',   label:'◆ 희귀', p:0.25},
  '일반': {cls:'common', label:'● 일반', p:0.70},
};
function cardEmoji(loc){
  const f=(loc.fact||'')+(loc.name||'');
  const rules=[[/공항/,'✈️'],[/조선|항만|항구/,'🚢'],[/제철|철강/,'🏭'],[/석유 화학|정유/,'🛢️'],
    [/반도체|전자|디스플레이|IT/,'💻'],[/자동차/,'🚗'],[/한우|목축|축산/,'🐂'],[/녹차|차밭|다향/,'🍵'],
    [/사과/,'🍎'],[/포도|와인/,'🍇'],[/감귤/,'🍊'],[/인삼|홍삼/,'🌿'],[/쌀|평야|곡창|벼/,'🌾'],
    [/갯벌|염전|천일염/,'🦀'],[/화산|오름|용암|주상 절리/,'🌋'],[/석회|카르스트|동굴/,'🕳️'],
    [/눈|동계|스키|산천어/,'❄️'],[/온천/,'♨️'],[/신도시|택지/,'🏙️'],[/도청|행정|청사/,'🏛️'],
    [/세계 .?유산|불국사|해인사|하회|법주사|고인돌|왕릉|청자/,'🏯'],[/축제/,'🎉'],
    [/기차|철도|KTX/,'🚄'],[/섬|도서|다도해/,'🏝️'],[/호수|호반|댐/,'💧'],[/국립 공원|산/,'⛰️'],
    [/치즈/,'🧀'],[/나비|반딧불|생태|습지|늪/,'🦋'],[/마늘|양파/,'🧄'],[/구석기|유적/,'🗿'],
    [/원자력|발전/,'⚡'],[/우주|항공/,'🚀'],[/혁신도시/,'🏢']];
  for(const [re,e] of rules) if(re.test(f)) return e;
  return '📍';
}
let MUNI_BBOX={};
function muniBBox(name){
  if(MUNI_BBOX[name]) return MUNI_BBOX[name];
  const d=MUNIS[name].d;
  const nums=d.match(/-?\d+\.?\d*/g).map(Number);
  let minx=1e9,miny=1e9,maxx=-1e9,maxy=-1e9;
  for(let i=0;i<nums.length;i+=2){
    if(nums[i]<minx)minx=nums[i]; if(nums[i]>maxx)maxx=nums[i];
    if(nums[i+1]<miny)miny=nums[i+1]; if(nums[i+1]>maxy)maxy=nums[i+1];
  }
  const pad=Math.max(maxx-minx,maxy-miny)*0.1;
  return MUNI_BBOX[name]={x:minx-pad,y:miny-pad,w:maxx-minx+pad*2,h:maxy-miny+pad*2};
}
function cardHTML(loc, owned, count){
  const rar=RARITY_META[rarityOf(loc)];
  const mu=loc.accept[0], bb=muniBBox(mu);
  const meaning=(loc.fact||'').split(/[,·]/)[0].trim();
  const sil=`<svg viewBox="${bb.x.toFixed(0)} ${bb.y.toFixed(0)} ${bb.w.toFixed(0)} ${bb.h.toFixed(0)}" class="card-sil"><path d="${MUNIS[mu].d}" /></svg>`;
  if(!owned){
    return `<div class="rcard unknown"><div class="card-sil-wrap">${sil}</div><div class="rcard-name">???</div><div class="rcard-meaning">${loc.region} 지방</div></div>`;
  }
  return `<div class="rcard ${rar.cls}">
    <div class="rcard-rar">${rar.label}</div>
    <div class="rcard-emoji">${cardEmoji(loc)}</div>
    <div class="card-sil-wrap">${sil}</div>
    <div class="rcard-name">${loc.name}</div>
    <div class="rcard-meaning">${meaning}</div>
    ${count>1?`<div class="rcard-cnt">×${count}</div>`:''}
  </div>`;
}
function updateGachaUI(){
  if($('coin-cnt')) $('coin-cnt').innerHTML=`🪙 <b>${coins}</b>`;
  if($('coll-progress')) $('coll-progress').textContent=`(${Object.keys(cards).length}/${LOCATIONS.length})`;
  if($('btn-draw')) $('btn-draw').disabled = coins<DRAW_COST;
}
function drawCard(){
  if(coins<DRAW_COST) return null;
  coins-=DRAW_COST; store.save('geo_coins',coins);
  const roll=Math.random();
  const want = roll<RARITY_META['전설'].p ? '전설' : roll<RARITY_META['전설'].p+RARITY_META['희귀'].p ? '희귀' : '일반';
  let cand=LOCATIONS.filter(l=>rarityOf(l)===want);
  if(!cand.length) cand=LOCATIONS;
  const loc=cand[Math.floor(Math.random()*cand.length)];
  const dup=!!cards[loc.name];
  cards[loc.name]=(cards[loc.name]||0)+1;
  if(dup){ coins+=2; store.save('geo_coins',coins); }   // 중복 → 2코인 환급
  store.save('geo_cards',cards);
  updateGachaUI();
  return {loc, dup, rar:rarityOf(loc)};
}
function openGacha(){
  const res=drawCard();
  if(!res) return;
  const modal=$('gacha-modal');
  modal.classList.remove('hidden');
  const card=$('gacha-card');
  card.classList.remove('flipped','legend-glow');
  $('gcard-front').innerHTML=cardHTML(res.loc,true,cards[res.loc.name]);
  $('gacha-msg').innerHTML='';
  setTimeout(()=>{
    card.classList.add('flipped');
    if(res.rar==='전설'){ card.classList.add('legend-glow'); confetti(modal.querySelector('.gacha-stage')); }
    $('gacha-msg').innerHTML=
      (res.dup?`이미 가진 카드! <b style="color:var(--gold)">+2🪙 환급</b>`:`<b style="color:var(--sea-d)">NEW!</b> 새로운 지역 카드 획득`)+
      ` · 보유 🪙 ${coins}`;
    $('btn-draw-again').textContent=`한 번 더 (5🪙)`;
    $('btn-draw-again').disabled = coins<DRAW_COST;
  }, 650);
  try { if(navigator.vibrate) navigator.vibrate(res.rar==='전설'?[40,60,40,60,120]:30); } catch(e){}
}
function renderCollection(filter){
  const grid=$('cards-grid'); grid.innerHTML='';
  const list=LOCATIONS.filter(l=>filter==='전체'||l.region===filter);
  const ord={'전설':0,'희귀':1,'일반':2};
  list.sort((a,b)=>(cards[b.name]?1:0)-(cards[a.name]?1:0) || ord[rarityOf(a)]-ord[rarityOf(b)] || a.name.localeCompare(b.name));
  list.forEach(l=>{
    const owned=!!cards[l.name];
    const el=document.createElement('div');
    el.innerHTML=cardHTML(l,owned,cards[l.name]||0);
    const c=el.firstElementChild;
    c.onclick=()=>{ if(owned){ c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); } };
    grid.appendChild(c);
  });
  const ownedCnt=list.filter(l=>cards[l.name]).length;
  $('coll-title-progress').textContent=`${ownedCnt}/${list.length}`;
}
function openCollection(){
  show('screen-cards');
  const chipBox=$('coll-chips'); chipBox.innerHTML='';
  ['전체',...MAP_REGIONS].forEach(r=>{
    const b=document.createElement('button');
    b.className='chip'+(r==='전체'?' on':''); b.textContent=r;
    b.onclick=()=>{ chipBox.querySelectorAll('.chip').forEach(c=>c.classList.remove('on')); b.classList.add('on'); renderCollection(r); };
    chipBox.appendChild(b);
  });
  renderCollection('전체');
}

// ============================================================
// 종료 / 결과
// ============================================================
// 연속 학습(스트릭) 기록
function bumpStreak(){
  const today=new Date().toDateString();
  const last=store.load('geo_lastday','');
  if(last===today) return store.load('geo_streak',1);
  const yest=new Date(Date.now()-864e5).toDateString();
  const s=(last===yest)? store.load('geo_streak',0)+1 : 1;
  store.save('geo_lastday',today); store.save('geo_streak',s);
  return s;
}
// 결과 꽃가루
function confetti(host){
  const colors=['#FFD23F','#A4CE4E','#20A2EE','#F2889B','#E2574C'];
  for(let i=0;i<26;i++){
    const s=document.createElement('span');
    s.className='confetti';
    s.style.cssText=`left:${Math.random()*100}%;background:${colors[i%colors.length]};animation-delay:${Math.random()*0.7}s;animation-duration:${1.6+Math.random()*1.2}s;transform:rotate(${Math.random()*360}deg)`;
    host.appendChild(s);
    setTimeout(()=>s.remove(), 3200);
  }
}
function resultComment(acc){
  if(acc>=90) return '이 감각이면 수능장에서도 흔들리지 않겠어요. 만점 가즈아! 🏆';
  if(acc>=70) return '상위권 페이스! 틀린 지역만 탐색 모드로 복습하면 완성 💪';
  if(acc>=50) return '기본기 장착 완료. 빈출 지역부터 한 번 더 돌아봐요 📚';
  return '오늘 틀린 지역이 수능날의 점수가 됩니다. 탐색 모드부터 차근차근! 🌱';
}

function endGame(){
  stopTimer();
  clearMapTap();
  $('map-svg').onclick=null;
  ['hud-qnum','hud-combo','hud-score'].forEach(id=>$(id).parentElement.style.visibility='');
  show('screen-result');
  bumpStreak();
  const detail=$('result-detail');
  $('name-entry').classList.add('hidden');

  if(G.battle){
    const b=G.battle;
    const w = b.scores[0]===b.scores[1] ? -1 : (b.scores[0]>b.scores[1]?0:1);
    const gap = Math.abs(b.scores[0]-b.scores[1]);
    $('result-title').textContent='⚔️ 배틀 결과';
    $('result-main').textContent = w<0 ? '무승부!' : `🏆 ${b.names[w]} 승리!`;
    const tag = w<0 ? '다시 붙어야겠죠?' : gap<150 ? '진땀나는 접전이었어요!' : '압도적인 승리!';
    detail.innerHTML=`${tag}<table class="vs-table">
      <tr><td><b>${b.names[0]}</b></td><td>${b.scores[0]}점</td><td>정답 ${b.correct[0]}/${Math.ceil(G.queue.length/2)}</td></tr>
      <tr><td><b>${b.names[1]}</b></td><td>${b.scores[1]}점</td><td>정답 ${b.correct[1]}/${Math.floor(G.queue.length/2)}</td></tr></table>`;
    xp+=Math.round((b.scores[0]+b.scores[1])/20);
    const earned=Math.max(1, Math.round((b.scores[0]+b.scores[1])/200));
    coins+=earned; store.save('geo_coins',coins); updateGachaUI();
    detail.innerHTML+=`<div style="margin-top:6px">🪙 카드 코인 +${earned} (보유 ${coins})</div>`;
    confetti(document.querySelector('.result-card'));
  } else {
    const answered = G.idx;
    $('result-title').textContent=MODE_INFO[G.mode].title+' 결과';
    $('result-main').textContent=G.score+'점';
    const acc = answered? Math.round(G.correctCnt/answered*100):0;
    const earned=Math.max(answered>=3?1:0, Math.round(G.score/100));
    coins+=earned; store.save('geo_coins',coins); updateGachaUI();
    detail.innerHTML=`정답 ${G.correctCnt} / ${answered} (정답률 ${acc}%) · 최대 콤보 ${G.maxCombo}🔥`+
      (earned?`<br>🪙 카드 코인 <b style="color:var(--gold)">+${earned}</b> (보유 ${coins}${coins>=DRAW_COST?' — 뽑기 가능!':''})`:'')+
      `<br><span style="font-size:.86em">${resultComment(acc)}</span>`;
    xp+=Math.round(G.score/10);
    if(acc>=70 && answered>=5) confetti(document.querySelector('.result-card'));
    if(G.score>0){
      $('name-entry').classList.remove('hidden');
      $('player-name').value=store.load('geo_lastname','');
    }
  }
  store.save('geo_xp',xp);
}

$('btn-save-score').onclick=()=>{
  const name=($('player-name').value.trim()||'무명').slice(0,10);
  store.save('geo_lastname',name);
  const list=board[G.mode]||(board[G.mode]=[]);
  list.push({name,score:G.score,date:new Date().toISOString().slice(0,10)});
  list.sort((a,b)=>b.score-a.score); board[G.mode]=list.slice(0,10);
  store.save('geo_board',board);
  $('name-entry').classList.add('hidden');
};
$('btn-retry').onclick=()=>startGame(G.mode);
$('btn-home').onclick=()=>{ initHome(); show('screen-home'); };
$('btn-quit').onclick=()=>{ stopTimer(); clearMapTap(); $('map-svg').onclick=null;
  ['hud-qnum','hud-combo','hud-score'].forEach(id=>$(id).parentElement.style.visibility='');
  initHome(); show('screen-home');
};

// ---------- 카드 뽑기/컬렉션 이벤트 ----------
$('btn-draw').onclick=openGacha;
$('btn-draw-again').onclick=openGacha;
$('btn-gacha-close').onclick=()=>{ $('gacha-modal').classList.add('hidden'); initHome(); };
$('btn-collection').onclick=openCollection;
$('btn-cards-back').onclick=()=>{ initHome(); show('screen-home'); };

// ---------- 시작 ----------
buildMap();
initMapGestures();
initHome();
