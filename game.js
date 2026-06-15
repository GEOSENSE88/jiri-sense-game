// ============================================================
// 한국지리 백지도 정복 — 게임 엔진 v2 (시·군 백지도 + 모바일 최적화)
// ============================================================
'use strict';

const $ = id => document.getElementById(id);
const REGIONS = ['전체','북한','수도권','강원','충청','호남','영남','제주'];
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
let wanted = store.load('geo_wanted', {});   // 오답 지역 수배서 {accept키: {miss, streak}}
let titles = store.load('geo_titles', {});   // 권역 보스전 클리어 칭호 {권역: true}
let serverBoard = null;   // 서버 공유 명예의 전당(있으면 우선 표시, 없으면 로컬 fallback)

// ---------- 공유 명예의 전당 API ----------
const LB_API = '/api';
async function fetchServerBoard(){
  try{
    const r = await fetch(LB_API + '/leaderboard', {cache:'no-store'});
    if(!r.ok) return null;
    serverBoard = await r.json();
    return serverBoard;
  }catch(e){ return null; }   // 서버 불가 환경에서도 게임은 계속(로컬 기록 사용)
}
async function postServerScore(mode, name, score){
  try{
    const r = await fetch(LB_API + '/score', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({mode, name, score})
    });
    return r.ok ? await r.json() : null;
  }catch(e){ return null; }
}

// ============================================================
// 👤 학생 계정 — 가벼운 신원(반+닉네임+비밀번호)으로 서버에 진도 동기화
//   로그인은 선택: 안 하면 게스트로 로컬 저장만(기존 동작). 기기 바뀌면 로그인으로 복원.
// ============================================================
let account = store.load('geo_account', null);   // {cls, nickname, token}

// 동기화 대상 상태 한 묶음
function gatherState(){ return { v:1, xp, coins, stats, cards, wanted, mission, titles }; }
function applyState(s){
  if(!s) return;
  if(typeof s.xp==='number') xp=s.xp;
  if(typeof s.coins==='number') coins=s.coins;
  if(s.stats) stats=s.stats;
  if(s.cards) cards=s.cards;
  if(s.wanted) wanted=s.wanted;
  if(s.mission) mission=s.mission;
  if(s.titles) titles=s.titles;
  store.save('geo_xp',xp); store.save('geo_coins',coins); store.save('geo_stats',stats);
  store.save('geo_cards',cards); store.save('geo_wanted',wanted);
  store.save('geo_mission',mission); store.save('geo_titles',titles);
}
// 서버 진도 vs 로컬 진도 병합 — 손실 없이 '더 풍부한 쪽' 채택
function mergeState(server){
  const local=gatherState(); const m={v:1};
  m.xp=Math.max(local.xp||0, server.xp||0);
  m.coins=Math.max(local.coins||0, server.coins||0);
  m.titles=Object.assign({}, server.titles||{}, local.titles||{});      // 칭호 합집합
  m.cards=Object.assign({}, server.cards||{});                          // 카드 최대 보유수
  for(const k in (local.cards||{})) m.cards[k]=Math.max(m.cards[k]||0, local.cards[k]);
  m.stats={};                                                          // 숙련도: 더 많이 푼 쪽
  new Set([...Object.keys(local.stats||{}),...Object.keys(server.stats||{})]).forEach(r=>{
    const a=(local.stats||{})[r]||{c:0,t:0}, b=(server.stats||{})[r]||{c:0,t:0}; m.stats[r]=(a.t>=b.t)?a:b; });
  m.wanted={};                                                         // 수배: muni별 더 많이 틀린 쪽
  new Set([...Object.keys(local.wanted||{}),...Object.keys(server.wanted||{})]).forEach(k=>{
    const a=(local.wanted||{})[k], b=(server.wanted||{})[k]; m.wanted[k]=(!b||(a&&a.miss>=b.miss))?a:b; });
  const today=new Date().toDateString();                               // 미션: 오늘자 진행 많은 쪽
  const lm=local.mission, sm=server.mission;
  const lp=lm&&lm.date===today? lm.list.reduce((s,i)=>s+(i.prog||0),0):-1;
  const sp=sm&&sm.date===today? sm.list.reduce((s,i)=>s+(i.prog||0),0):-1;
  m.mission= sp>lp? sm : (lm||sm);
  return m;
}
async function apiLogin(cls, nickname, pin){
  try{
    const r=await fetch(LB_API+'/student/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({class:cls, nickname, pin})});
    const j=await r.json().catch(()=>({}));
    return r.ok? j : {error: j.error||'로그인 실패'};
  }catch(e){ return {error:'서버에 연결할 수 없습니다. 게스트(로컬 저장)로 계속 플레이됩니다.'}; }
}
async function apiSync(){
  if(!account||!account.token) return null;
  try{
    const r=await fetch(LB_API+'/student/sync',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token:account.token, xp, data:gatherState()})});
    return r.ok? await r.json() : null;
  }catch(e){ return null; }
}
async function apiRoster(cls, pw){
  try{
    const r=await fetch(LB_API+'/class/roster?class='+encodeURIComponent(cls)+'&pw='+encodeURIComponent(pw));
    const j=await r.json().catch(()=>({}));
    return r.ok? j : {error: j.error||'조회 실패'};
  }catch(e){ return {error:'서버에 연결할 수 없습니다'}; }
}
async function doLogin(cls, nickname, pin){
  const res=await apiLogin(cls, nickname, pin);
  if(res.error) return res;
  account={cls, nickname, token:res.token};
  store.save('geo_account', account);
  if(!res.isNew) applyState(mergeState({xp:res.xp, ...(res.data||{})}));
  await apiSync();                 // 병합 결과(또는 신규 로컬)를 서버에 반영
  initHome();
  return {ok:true, isNew:res.isNew};
}
function logoutAccount(){ account=null; store.remove('geo_account'); renderAccount(); initHome(); }
// 앱 시작 시: 로그인 상태면 서버 최신 진도를 끌어와 병합(다른 기기에서 한 기록 반영)
async function syncOnLoad(){
  if(!account||!account.token) return;
  try{
    const r=await fetch(LB_API+'/student/me?token='+encodeURIComponent(account.token));
    if(!r.ok){ if(r.status===401){ /* 토큰 만료 */ } return; }
    const j=await r.json();
    applyState(mergeState({xp:j.xp, ...(j.data||{})}));
    initHome(); apiSync();
  }catch(e){}
}
let _syncT=null;
function scheduleSync(){ if(!account) return; clearTimeout(_syncT); _syncT=setTimeout(()=>apiSync(), 1200); }

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
  wanted:   {title:'🔍 오답 수배 복습', useMap:true, n:12, time:30},
  boss:     {title:'👹 권역 보스전', useMap:true, n:10, time:30},
};
const MODE_COLOR={location:'#1278C2',muniname:'#2FA34F',detective:'#6A5ACD',climate:'#E8740C',stats:'#1B4F8F',mcq:'#0F9D8C',ox:'#0FA958',battle:'#E2574C',wanted:'#C2410C',boss:'#B5342A'};
const BOSS_REGIONS = ['수도권','강원','충청','호남','영남','제주'];
const BOSS_GATE = 0.6, BOSS_MIN_T = 5;   // 숙련도 60%↑(최소 5문항 풀이)면 도전 가능
function bossMastery(r){ const s=stats[r]; return s&&s.t? s.c/s.t : 0; }
function bossUnlocked(r){ const s=stats[r]; return !!s && s.t>=BOSS_MIN_T && s.c/s.t>=BOSS_GATE; }
function bossTitle(r){ return `${regionLabel(r)} 정복자`; }

// 첫 문항(런 시작) 워밍업: 지도 확대·이동·탭 판정을 익히기 전에 시간 초과로 이탈하는 것 방지.
// 지도 조작이 필요한 모드만 대상. 모든 플레이어·모든 런에 동일 적용되므로 공유 랭킹 공정성은 유지됨.
const WARMUP_MODES = new Set(['location','muniname','detective','climate','stats','battle','wanted']);
const WARMUP_MULT = 1.6, WARMUP_ADD = 8;

// 마스코트는 위치 사냥의 '설명형' 문제로 흡수
let LOC_POOL=null;
function locPool(){
  if(LOC_POOL) return LOC_POOL;
  const mascotAssets = (typeof MASCOT_ASSETS !== 'undefined' ? MASCOT_ASSETS : [])
    .filter(a=>a.accept && a.accept[0] && MUNIS[a.accept[0]]);
  const mascotImageByMuni = new Map(mascotAssets.map(a=>[a.accept[0], a.image]));
  const curatedMascots = new Set(MASCOTS.map(m=>m.accept[0]));
  const mascotLocs=MASCOTS.map(m=>{
    const mu=MUNIS[m.accept[0]];
    return {name:m.accept[0].replace(/\(.+\)$/,''), x:mu.cx, y:mu.cy, region:m.region, accept:m.accept,
            image:mascotImageByMuni.get(m.accept[0]) || null,
            fact:`마스코트 ‘${m.name}’의 고장 — ${m.desc}`, descOnly:true,
            desc:`마스코트 ‘${m.name}’ — ${m.desc}`};
  });
  const imageMascotLocs=mascotAssets
    .filter(a=>!curatedMascots.has(a.accept[0]))
    .map(a=>{
      const mu=MUNIS[a.accept[0]], label=a.accept[0].replace(/\(.+\)$/,'');
      return {name:label, x:mu.cx, y:mu.cy, region:mu.region, accept:a.accept,
              image:a.image, descOnly:true, imageOnly:true,
              fact:`${label} 지자체 캐릭터 이미지`,
              desc:'다음 지자체 캐릭터 이미지를 보고 해당 시·군을 찾으세요.'};
    });
  LOC_POOL=LOCATIONS.concat(mascotLocs, imageMascotLocs);
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
function escapeAttr(s){
  return String(s).replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
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
// 명예의 전당 렌더 — 서버 공유 랭킹(serverBoard) 우선, 없으면 로컬(board)
function renderHomeBoard(){
  const hb=$('home-board'); if(!hb) return;
  const src = serverBoard || board;
  hb.innerHTML=''; let any=false;
  Object.keys(MODE_INFO).forEach(m=>{
    const list=src[m]||[];
    if(list.length){ any=true;
      hb.insertAdjacentHTML('beforeend',
        `<div class="board-row"><span>${list[0].name} — <b>${list[0].score}</b>점</span>
         <span class="b-mode">${MODE_INFO[m].title.replace(/^[^\s]+\s/,'')}</span></div>`);
    }
  });
  if(!any) hb.innerHTML='<div style="color:var(--dim);font-size:.83rem">아직 기록이 없습니다. 첫 도전자가 되어 보세요!</div>';
}

function initHome(){
  const chips = $('region-chips'); chips.innerHTML='';
  REGIONS.forEach(r=>{
    const b=document.createElement('button');
    b.className='chip'+(G.region===r?' on':''); b.textContent=regionLabel(r);
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
  renderHomeBoard();
  fetchServerBoard().then(b=>{ if(b) renderHomeBoard(); });   // 서버 공유 랭킹으로 갱신
  updateGachaUI();
  renderAccount();
  renderRecommend();
  renderMission();
  renderBoss();
  renderWanted();
  // 빈출 지역 TOP 12 — 특별·광역시 제외, 시·군 단위만
  $('freq-span').textContent=`${FREQ_SPAN.span} 고3 학평·모평·수능 ${FREQ_SPAN.files}회분 언급 횟수(시·군 기준) — 빈출 지역은 게임에서 더 자주 출제됩니다`;
  const fl=$('freq-list'); fl.innerHTML='';
  const METRO_RE=/(특별시|광역시|특별자치시)$/;
  const top=Object.entries(FREQ)
    .filter(([name])=>MUNIS[name] && !METRO_RE.test(name))
    .sort((a,b)=>b[1].count-a[1].count).slice(0,12);
  const max=top.length?top[0][1].count:1;
  top.forEach(([name,v],i)=>{
    fl.insertAdjacentHTML('beforeend',
      `<div class="freq-row"><span class="f-rank">${i+1}</span><span class="f-name">${name.replace(/\(.+\)$/,'')}</span>
       <div class="f-bar"><div class="f-fill" style="width:${Math.round(v.count/max*100)}%"></div></div>
       <span class="f-val">${v.count}회·${v.exams}개 시험</span></div>`);
  });
}

// 🎯 오늘의 지리 미션 렌더
function renderMission(){
  const box=$('mission-body'); if(!box) return;
  ensureMission();
  box.innerHTML=mission.list.map(it=>{
    const d=missionDef(it.id); if(!d) return '';
    const prog=Math.min(it.prog,d.goal), pct=Math.round(prog/d.goal*100);
    const state = it.claimed ? '<span class="ms-claimed">✓ 완료</span>'
      : it.done ? `<button class="ms-claim" data-mid="${it.id}">받기 🪙${d.reward.c}·XP${d.reward.x}</button>`
      : `<span class="ms-prog">${prog}/${d.goal}</span>`;
    return `<div class="mission-row${it.done?' done':''}">
      <div class="ms-top"><span class="ms-label">${d.label}</span>${state}</div>
      <div class="ms-bar"><div class="ms-fill" style="width:${pct}%"></div></div></div>`;
  }).join('');
  box.querySelectorAll('.ms-claim').forEach(b=>b.onclick=()=>claimMission(b.dataset.mid));
}

// 👤 계정 칩
function renderAccount(){
  const el=$('account-chip'); if(!el) return;
  if(account){ el.innerHTML=`👤 ${account.nickname} <small>${account.cls}</small>`; el.classList.add('on'); }
  else { el.innerHTML='👤 로그인 · 기록 저장'; el.classList.remove('on'); }
}

// 🧭 마스코트 추천 도전 — 상태에 맞는 '오늘 할 것' 한 줄 제안
function renderRecommend(){
  const bubble=$('rec-bubble'), btn=$('rec-btn'); if(!bubble||!btn) return;
  let text, label, action;
  const bossCand=BOSS_REGIONS.filter(r=>bossUnlocked(r)&&!titles[r])
    .sort((a,b)=>bossMastery(b)-bossMastery(a))[0];
  const wn=Object.keys(wanted).length;
  if(bossCand){
    text=`${regionLabel(bossCand)} 숙련도 ${Math.round(bossMastery(bossCand)*100)}%! 보스전 도전 각이야 👹`;
    label='보스전 도전'; action=()=>startGame('boss', bossCand);
  } else if(wn>0){
    text=`오답 ${wn}곳이 수배 중! 복습하고 코인까지 챙기자 🔍`;
    label='수배 복습'; action=()=>{ G.region='전체'; startGame('wanted'); };
  } else {
    const weak=BOSS_REGIONS.filter(r=>{ const s=stats[r]; return s&&s.t>=3; })
      .sort((a,b)=>bossMastery(a)-bossMastery(b))[0];
    if(weak && bossMastery(weak)<0.7){
      text=`${regionLabel(weak)}이 조금 약해. 위치 사냥으로 다져볼까? 💪`;
      label=`${regionLabel(weak)} 연습`; action=()=>{ G.region=weak; startGame('location'); };
    } else {
      text='오늘의 미션부터 깨 보자! 작은 목표가 실력이 돼 🎯';
      label='위치 사냥 시작'; action=()=>{ G.region='전체'; startGame('location'); };
    }
  }
  bubble.textContent=text;
  btn.textContent=label; btn.onclick=action;
}

// 👹 권역 보스전 — 숙련도 게이트 + 칭호
function renderBoss(){
  const box=$('boss-body'); if(!box) return;
  box.innerHTML=BOSS_REGIONS.map(r=>{
    const m=Math.round(bossMastery(r)*100), unlocked=bossUnlocked(r), cleared=!!titles[r];
    const right = cleared ? `<span class="boss-tag">🏆 정복</span>`
      : unlocked ? `<span class="boss-go">도전 ▶</span>`
      : `<span class="boss-lock">🔒 ${m}%</span>`;
    return `<button class="boss-btn${unlocked?'':' locked'}${cleared?' cleared':''}" data-region="${r}" ${unlocked?'':'disabled'}>
      <span class="boss-name">${regionLabel(r)}</span>${right}</button>`;
  }).join('');
  box.querySelectorAll('.boss-btn:not([disabled])').forEach(b=>b.onclick=()=>startGame('boss', b.dataset.region));
}

// 🔍 오답 지역 수배서 — 틀린 시·군을 모아 복습 유도
function renderWanted(){
  const box=$('wanted-body'); if(!box) return;
  const keys=Object.keys(wanted).sort((a,b)=>wanted[b].miss-wanted[a].miss);
  if(!keys.length){
    box.innerHTML='<div class="wanted-empty">수배 중인 지역이 없습니다. 위치 사냥·지역 판독·추리에서 틀린 시·군이 자동으로 여기에 모입니다.</div>';
    return;
  }
  const danger=keys.filter(m=>wanted[m].miss>=3).length;
  const chips=keys.map(m=>{
    const w=wanted[m], dg=w.miss>=3;
    return `<span class="wanted-chip${dg?' danger':''}">${dg?'🚨 ':''}${muniShort(m)}<small>${w.miss}회</small></span>`;
  }).join('');
  box.innerHTML=
    `<div class="wanted-sub">${keys.length}개 지역 수배 중${danger?` · <b style="color:var(--red)">위험 ${danger}곳</b>`:''} · 2연속 정답 시 해제</div>`+
    `<div class="wanted-chips">${chips}</div>`+
    `<button class="primary-btn" id="btn-wanted-review">🎯 수배 지역만 복습 (${Math.min(keys.length,MODE_INFO.wanted.n)}문제)</button>`;
  $('btn-wanted-review').onclick=()=>{ G.region='전체'; startGame('wanted'); };
}

const MODE_CTA={location:'사냥 시작!',muniname:'판독 시작!',detective:'추리 시작!',climate:'분석 도전!',stats:'비교 도전!',mcq:'퀴즈 시작!',ox:'스피드 OX!',battle:'대결 시작!'};
document.querySelectorAll('.mode-card').forEach(c=>{
  c.onclick=()=>startGame(c.dataset.mode);
  const p=c.querySelector('.mode-play'); if(p&&MODE_CTA[c.dataset.mode]) p.textContent=MODE_CTA[c.dataset.mode]+' ▶';
});
$('reset-data').onclick=()=>{
  if(confirm('모든 기록(점수·숙련도·랭킹·수배서)을 초기화할까요?')){
    store.remove('geo_stats'); store.remove('geo_xp'); store.remove('geo_board'); store.remove('geo_wanted'); store.remove('geo_mission'); store.remove('geo_titles');
    stats={}; xp=0; board={}; wanted={}; mission=null; titles={}; initHome();
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
      // 핀치 시작: 시작 시점의 뷰와 손가락 중점 아래의 지도 좌표(앵커)를 고정
      if(viewAnimId){ cancelAnimationFrame(viewAnimId); viewAnimId=null; }
      const [a,b]=[...ptrs.values()];
      const rect=svg.getBoundingClientRect();
      const mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
      pinch0={d:Math.hypot(a.x-b.x,a.y-b.y), v:{...view},
              ax:view.x+(mx-rect.left)/rect.width*view.w,
              ay:view.y+(my-rect.top)/rect.height*view.h};
      panStart=null;
    }
  });
  svg.addEventListener('pointermove',e=>{
    if(!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const rect=svg.getBoundingClientRect();
    if(ptrs.size===2 && pinch0){
      const [a,b]=[...ptrs.values()];
      const d=Math.hypot(a.x-b.x,a.y-b.y);
      if(Math.abs(d-pinch0.d)>6) { moved=true; suppressTap=true; }
      if(moved){
        // 시작 상태 기준으로만 계산 → 드리프트 없음. 앵커가 항상 손가락 중점 아래에 유지
        const nw=Math.min(VIEW0.w, Math.max(VIEW0.w/8, pinch0.v.w*(pinch0.d/d)));
        const nh=pinch0.v.h*(nw/pinch0.v.w);
        const mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
        view={x:pinch0.ax-(mx-rect.left)/rect.width*nw,
              y:pinch0.ay-(my-rect.top)/rect.height*nh, w:nw, h:nh};
        clampView(); applyView();
      }
    } else if(ptrs.size===1 && panStart){
      const scale=panStart.vw!==undefined?panStart.vw/rect.width:view.w/rect.width;
      const dx=(e.clientX-panStart.x), dy=(e.clientY-panStart.y);
      if(Math.abs(dx)+Math.abs(dy)>10){ moved=true; suppressTap=true; }
      if(moved){                          // 확대 여부와 무관하게 항상 팬 (페이지 스크롤과 분리)
        view.x=panStart.vx-dx*scale; view.y=panStart.vy-dy*scale;
        clampView(); applyView();
      }
    }
    if(moved || ptrs.size===2){ try { e.preventDefault(); } catch(err){} }
  });
  const up=e=>{
    // 탭(이동 없음)이면 터치 지점에 물결 효과
    if(ptrs.size===1 && !moved && !suppressTap){
      try { const p=svgPoint(e.clientX,e.clientY); tapRipple(p.x,p.y); } catch(err){}
    }
    ptrs.delete(e.pointerId);
    if(ptrs.size<2) pinch0=null;
    if(ptrs.size===1){
      // 핀치 → 한 손가락 전환: 남은 손가락 기준으로 팬 기준점 재설정 (점프 방지)
      const [rest]=[...ptrs.values()];
      panStart={x:rest.x, y:rest.y, vx:view.x, vy:view.y, vw:view.w};
    }
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
function addLabel(x, y, text, cls){
  const t=document.createElementNS('http://www.w3.org/2000/svg','text');
  t.setAttribute('x',x); t.setAttribute('y',y);
  t.setAttribute('text-anchor','middle'); t.setAttribute('class','loc-label'+(cls?' '+cls:''));
  t.textContent=text; $('map-svg').appendChild(t); return t;
}
// 오답으로 탭한 시·군에 빨간 이름 라벨
function labelWrongMuni(name){
  const m=MUNIS[name];
  if(m) addLabel(m.cx, m.cy+4, name.replace(/\(.+\)$/,''), 'bad');
}
// 권역 경계 박스 (문제 시작 시 자동 확대용)
let REGION_BBOX=null;
function regionBBox(region){
  if(!REGION_BBOX){
    REGION_BBOX={};
    for(const [n,m] of Object.entries(MUNIS)){
      const bb=muniBBox(n);
      const r=REGION_BBOX[m.region]||(REGION_BBOX[m.region]={minx:1e9,miny:1e9,maxx:-1e9,maxy:-1e9});
      r.minx=Math.min(r.minx,bb.x); r.miny=Math.min(r.miny,bb.y);
      r.maxx=Math.max(r.maxx,bb.x+bb.w); r.maxy=Math.max(r.maxy,bb.y+bb.h);
    }
  }
  return REGION_BBOX[region];
}
// 출제 지역의 권역으로 부드럽게 확대 (정답 자체는 노출하지 않음)
function fitRegion(region){
  const r=regionBBox(region);
  if(!r) return;
  fitViewTo([{x:r.minx,y:r.miny},{x:r.maxx,y:r.maxy}], 26);
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
function show(id){ document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active')); $(id).classList.add('active'); try{ window.scrollTo(0,0); }catch(e){} }
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
    return M.length>=4?M:CLIMATE_SETS.map(s=>({kind:'match',set:s}));   // 순서형 제거: 지도 탭형만
  }
  if(mode==='stats'){
    let P=STAT_SETS.filter(s=>r==='전체'||s.sd.some(n=>PROVINCES[n]?.region===r));
    return P.length>=2?P:STAT_SETS;
  }
  if(mode==='mcq'){ const M=MCQ.filter(q=>r==='전체'||q.region===r); return M.length?M:MCQ; }
  if(mode==='ox'){ const O=OX.filter(q=>r==='전체'||q.region===r); return O.length?O:OX; }
  return [];
}

// 👹 권역 보스전 출제 — 해당 권역 위주 혼합 10문항(위치·판독·개념·OX·기후)
function bossQueue(region){
  const prevR=G.region; G.region=region;
  const locs  = sampleLocQueue(pool('location'), 3);
  const munis = weightedSample(pool('muniname'), 3, n=>n);
  const mcqs  = shuffle(pool('mcq')).slice(0,2);
  const oxs   = shuffle(pool('ox')).slice(0,1);
  const clim  = shuffle(pool('climate')).slice(0,1);
  G.region=prevR;
  const q=[];
  locs.forEach(l=>l&&q.push({btype:'location', item:l}));
  munis.forEach(m=>m&&q.push({btype:'muniname', item:m}));
  mcqs.forEach(m=>m&&q.push({btype:'mcq', item:m}));
  oxs.forEach(o=>o&&q.push({btype:'ox', item:o}));
  clim.forEach(c=>c&&q.push({btype:'climate', item:c}));
  return shuffle(q).slice(0, MODE_INFO.boss.n);
}

function startGame(mode, opt){
  G.mode=mode; G.idx=0; G.score=0; G.combo=0; G.maxCombo=0; G.correctCnt=0; G.locked=false;
  G.battle=null; G.bossRegion=null;
  if(mode==='boss'){ G.bossRegion=opt; G.region=opt; }
  if(!svgBuilt){ buildMap(); initMapGestures(); }
  clearMapExtras(); resetView();
  stopTimer();
  { const tip=$('warmup-tip'); if(tip) tip.classList.add('hidden'); }
  { const bb=$('boss-bar'); if(bb) bb.classList.toggle('hidden', mode!=='boss'); }

  const info=MODE_INFO[mode];
  $('screen-game').style.setProperty('--mode-c', MODE_COLOR[mode]||'#1278C2');
  $('game-title').textContent = mode==='boss'
    ? `👹 ${regionLabel(opt)} 보스전`
    : info.title+(G.region!=='전체'?` · ${G.region}`:'');
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
  } else if(mode==='wanted'){
    const wp=wantedPool();
    G.queue=sampleLocQueue(wp, Math.min(wp.length, MODE_INFO.wanted.n));
  } else if(mode==='muniname'){
    G.queue=weightedSample(pool(mode), MODE_INFO[mode].n, n=>n);
  } else if(mode==='boss'){
    G.queue=bossQueue(opt);
  } else {
    G.queue=shuffle(pool(mode)).slice(0, MODE_INFO[mode].n);
  }
  if(mode==='boss') hudUpdate();   // 보스 HP 초기 표시
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
  if(G.mode==='boss'){
    const bb=$('boss-bar'); if(!bb) return;
    const max=G.queue.length, hp=Math.max(0, max-G.correctCnt), pct=Math.round(hp/max*100);
    const need=Math.ceil(max*0.7);
    bb.innerHTML=`<div class="boss-top"><span>👹 ${regionLabel(G.bossRegion)} 보스 HP</span>`+
      `<span>${hp}/${max} · ${need}타 격파</span></div>`+
      `<div class="boss-hp"><div class="boss-hp-fill" style="width:${pct}%"></div></div>`;
  }
}

// ---------- 타이머 ----------
function startTimer(sec, onTimeout){
  stopTimer();
  // 런 첫 문항 워밍업(지도 조작 모드만): 시간 넉넉하게 + 안내 배지
  const warm = G.idx===0 && WARMUP_MODES.has(G.mode);
  if(warm) sec = Math.round(sec*WARMUP_MULT)+WARMUP_ADD;
  const tip=$('warmup-tip');
  if(tip){
    tip.classList.toggle('hidden', !warm);
    if(warm) tip.textContent='🔰 연습 감각 — 첫 문제는 시간이 넉넉해요. 확대·이동·탭을 익혀 보세요!';
  }
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
    missionProgress({mode:G.mode, correct, combo:G.combo});
  }
  return pts;
}
function recordStat(region, correct){
  if(!region) return;
  const s=stats[region]||(stats[region]={c:0,t:0});
  s.t++; if(correct) s.c++;
  store.save('geo_stats',stats);
  missionProgress({region, correct});
}

// --- 오답 지역 수배서 ---
// 시·군 위치 모드(위치 사냥·지역 판독·추리)에서 그 시·군을 정확히 맞혔는지(hit)를 기록.
// 틀리면 수배 등록(miss 누적, 3회↑ '위험'), 2연속 정답이면 수배 해제.
function logResult(muni, hit){
  if(!muni) return;
  if(hit){
    const w=wanted[muni];
    if(!w) return;                       // 수배 중이 아니면 무시
    w.streak=(w.streak||0)+1;
    if(w.streak>=2) delete wanted[muni]; // 2연속 정답 → 해제
  } else {
    const w=wanted[muni]||(wanted[muni]={miss:0,streak:0});
    w.miss++; w.streak=0;
  }
  store.save('geo_wanted',wanted);
  missionProgress({muni, correct:hit});
}
// 시·군 정식키(예: '태백시') → 짧은 표시명(예: '태백')
function muniShort(muni){
  const l=LOCATIONS.find(x=>x.accept.includes(muni));
  return (l&&l.name) || muni.replace(/(특별자치시|특별자치도|광역시|특별시|자치시|자치도|시|군)$/,'');
}
// 수배 중인 시·군을 위치 사냥 형식으로 풀 수 있게 loc 객체 목록 생성
function wantedPool(){
  return Object.keys(wanted).map(muni=>{
    const l=LOCATIONS.find(x=>x.accept.includes(muni));
    if(l) return l;
    const mu=MUNIS[muni]; if(!mu) return null;   // LOCATION 없는 시·군은 즉석 생성
    return {name:muniShort(muni), x:mu.cx, y:mu.cy, region:mu.region, accept:[muni],
            fact:`${mu.prov} ${muniShort(muni)} — 백지도에서 위치를 다시 확인하세요.`};
  }).filter(Boolean);
}

// ============================================================
// 🎯 오늘의 지리 미션 — 매일 3개, 깨면 코인·XP 보상 (날짜 시드 → 모두 같은 미션)
// ============================================================
const MISSION_POOL = [
  {id:'reg-jeju',  label:'제주권 문제 5개 맞히기',  goal:5, type:'solve', region:'제주',   reward:{c:5,x:40}},
  {id:'reg-gw',    label:'강원권 문제 6개 맞히기',  goal:6, type:'solve', region:'강원',   reward:{c:5,x:40}},
  {id:'reg-honam', label:'호남권 문제 6개 맞히기',  goal:6, type:'solve', region:'호남',   reward:{c:5,x:40}},
  {id:'reg-chung', label:'충청권 문제 6개 맞히기',  goal:6, type:'solve', region:'충청',   reward:{c:5,x:40}},
  {id:'reg-yeong', label:'영남권 문제 6개 맞히기',  goal:6, type:'solve', region:'영남',   reward:{c:5,x:40}},
  {id:'reg-sudo',  label:'수도권 문제 6개 맞히기',  goal:6, type:'solve', region:'수도권', reward:{c:5,x:40}},
  {id:'mode-clim', label:'기후 비교 3문제 맞히기',  goal:3, type:'mode',  mode:'climate', reward:{c:6,x:45}},
  {id:'mode-stat', label:'통계 비교 3문제 맞히기',  goal:3, type:'mode',  mode:'stats',   reward:{c:6,x:45}},
  {id:'mode-loc',  label:'위치 사냥 8문제 맞히기',  goal:8, type:'mode',  mode:'location',reward:{c:6,x:45}},
  {id:'card-new',  label:'지역 카드 1장 새로 획득', goal:1, type:'card',  reward:{c:4,x:30}},
  {id:'freq-top',  label:'빈출 TOP10 지역 중 3곳 맞히기', goal:3, type:'freq', reward:{c:8,x:60}},
  {id:'combo7',    label:'한 게임에서 7콤보 달성',  goal:7, type:'combo', reward:{c:6,x:50}},
];
const MISSION_N = 3;
function missionDef(id){ return MISSION_POOL.find(m=>m.id===id); }
function hashStr(s){ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
function pickMissions(dateStr, k){
  let seed=hashStr(dateStr)||1;
  const rnd=()=>{ seed^=seed<<13; seed^=seed>>>17; seed^=seed<<5; seed>>>=0; return seed/4294967296; };
  const idx=MISSION_POOL.map((_,i)=>i);
  for(let i=idx.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); [idx[i],idx[j]]=[idx[j],idx[i]]; }
  return idx.slice(0,k).map(i=>({id:MISSION_POOL[i].id, prog:0, done:false, claimed:false, seen:[]}));
}
let mission = store.load('geo_mission', null);
function ensureMission(){
  const t=new Date().toDateString();
  if(!mission || mission.date!==t){
    mission={date:t, list:pickMissions(t, MISSION_N)};
    store.save('geo_mission', mission);
  }
  return mission;
}
let FREQ_TOP_SET=null;
function freqTopSet(){
  if(FREQ_TOP_SET) return FREQ_TOP_SET;
  const METRO=/(특별시|광역시|특별자치시)$/;
  FREQ_TOP_SET=new Set(Object.entries(FREQ)
    .filter(([n])=>MUNIS[n]&&!METRO.test(n))
    .sort((a,b)=>b[1].count-a[1].count).slice(0,10).map(([n])=>n));
  return FREQ_TOP_SET;
}
// 미션 진행도 갱신 — 출처별로 필드가 달라 미션 유형 간 중복 집계 없음
//   award()    → {mode, correct, combo}   (문항당 1회)
//   recordStat → {region, correct}
//   logResult  → {muni, correct}          (빈출 시·군)
//   drawCard   → {isNew}
function missionProgress(ev){
  ensureMission();
  let changed=false;
  for(const it of mission.list){
    if(it.done) continue;
    const d=missionDef(it.id); if(!d) continue;
    if(d.type==='solve'  && ev.region===d.region && ev.correct) { it.prog++; changed=true; }
    else if(d.type==='mode' && ev.mode===d.mode && ev.correct)  { it.prog++; changed=true; }
    else if(d.type==='card' && ev.isNew)                        { it.prog++; changed=true; }
    else if(d.type==='combo' && typeof ev.combo==='number')     { if(ev.combo>it.prog){ it.prog=ev.combo; changed=true; } }
    else if(d.type==='freq' && ev.muni && ev.correct && freqTopSet().has(ev.muni)){
      if(!it.seen.includes(ev.muni)){ it.seen.push(ev.muni); it.prog++; changed=true; }
    }
    if(it.prog>=d.goal && !it.done){ it.done=true; changed=true; }
  }
  if(changed){
    store.save('geo_mission', mission);
    if($('mission-body') && $('screen-home')?.classList.contains('active')) renderMission();
  }
}
function claimMission(id){
  const it=mission&&mission.list.find(x=>x.id===id);
  if(!it || !it.done || it.claimed) return;
  const d=missionDef(id); if(!d) return;
  it.claimed=true; store.save('geo_mission', mission);
  coins+=d.reward.c; store.save('geo_coins', coins);
  xp+=d.reward.x; store.save('geo_xp', xp);
  updateGachaUI();
  renderMission();
  scheduleSync();
}

// ---------- 진행 ----------
function nextQuestion(){
  G.locked=false;
  clearMapTap();
  $('feedback-box').classList.add('hidden');
  $('btn-next').classList.add('hidden');
  clearMapExtras();
  // 문제 전환 시 지도를 즉시 원위치 (비교 모드는 이후 자체적으로 자동 확대)
  if(viewAnimId){ cancelAnimationFrame(viewAnimId); viewAnimId=null; }
  view={...VIEW0}; applyView();

  if(G.mode==='ox'){
    if(Date.now()>=G.oxEnd || G.idx>=G.queue.length) return endGame();
  } else if(G.idx>=G.queue.length) return endGame();

  hudUpdate();
  let item=G.queue[G.idx], type=G.mode;
  if(G.mode==='battle'||G.mode==='boss'){
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

  if(type==='location'||type==='wanted') askLocation(item);
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

// 점수 +N 튀어오름 (HUD 점수 위)
function scorePop(pts){
  const host=document.querySelector('.hud .score'); if(!host) return;
  const el=document.createElement('span');
  el.className='score-pop'; el.textContent='+'+pts;
  host.appendChild(el);
  setTimeout(()=>el.remove(), 1000);
}
const MASCOT_VER='?v=20260615j';
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
  const face=`<img class="fb-mascot ${correct?'happy':'sad'}" src="${correct?'guide-correct.png':'guide-think.png'}${MASCOT_VER}" alt="">`;
  fb.className='feedback-box '+(correct?'good':'bad');
  fb.innerHTML=`<div class="fb-head">${face}${head}${flair}${pts?` <span class="fb-pts">+${pts}점</span>`:''}</div>${body}`;
  fb.classList.remove('hidden'); fb.classList.add('pop');
  setTimeout(()=>fb.classList.remove('pop'),400);
  if(correct && pts>0) scorePop(pts);
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
  const imageForm = !!loc.image && (loc.imageOnly || loc.descOnly || Math.random()<0.45);
  if(descForm){
    const descText = maskName(loc.desc || loc.fact, loc);
    const imageHTML = imageForm
      ? `<div class="mascot-clue"><img src="${escapeAttr(loc.image)}" alt="지자체 캐릭터 이미지" loading="eager"></div>`
      : '';
    $('question-box').innerHTML=
      `<span class="q-region">${regionLabel(loc.region)}</span> ${imageForm?'이 캐릭터는 어느 지역일까?':'어느 지역일까?'} 백지도에서 콕! 찍어 보자`+
      imageHTML+
      `<div class="stat-card" style="font-weight:600">${descText}</div>`;
  } else {
    $('question-box').innerHTML=
      `<span class="q-region">${regionLabel(loc.region)}</span> 백지도에서 <b style="color:var(--sea-d);font-size:1.2em">${loc.name}</b> ${loc.accept.length>1?'일대':'(이/가) 속한 시·군'}를 탭하세요!`;
  }
  $('choices-box').innerHTML='<div class="map-hint">💡 작으면 확대해서 콕! 가까우면 절반 점수</div>';
  if(G.region!=='전체') dimOtherRegions(G.region);
  fitRegion(loc.region);                 // 출제 권역으로 자동 확대

  const reveal=()=>{
    loc.accept.forEach(n=>muniEl(n)?.classList.add('correct','hit'));
    addDot(loc.x,loc.y,5,'loc-dot target-reveal');
    addLabel(loc.x,loc.y-10,loc.name);
  };
  const off=onMuniTap((t,e)=>{
    G.locked=true; stopTimer();
    const tapped=t.dataset.name;
    const p=svgPoint(e.clientX,e.clientY);
    const d=Math.hypot(p.x-loc.x, p.y-loc.y);
    let correct=false, base=0, head='';
    const exact=loc.accept.includes(tapped);          // 정확히 그 시·군을 탭했는지(수배서 판정 기준)
    const baseFull = descForm ? 140 : 120;            // 설명형은 더 높은 점수
    if(exact){ correct=true; base=baseFull; head='🎯 정확해요!'; }
    else if(d<=55){ correct=true; base=Math.round(baseFull/2); head=`👍 근접! (${tapped} 탭, 절반 점수)`; t.classList.add('wrong'); labelWrongMuni(tapped); }
    else { head=`❌ 아쉬워요 (${tapped} 탭)`; t.classList.add('wrong'); labelWrongMuni(tapped); }
    reveal();
    const pts=award(correct,base);
    recordStat(loc.region,correct);
    logResult(loc.accept[0], exact);
    feedback(correct,head,`<b>${loc.name}</b> — ${loc.fact}`+studyExtra(loc.name),pts);
    hudUpdate(); afterAnswer();
  });
  startTimer(info.time||18,()=>{ if(G.locked)return; G.locked=true; off();
    reveal();
    award(false,0); recordStat(loc.region,false); logResult(loc.accept[0], false);
    feedback(false,'⏰ 아깝다, 시간 초과!',`<b>${loc.name}</b> — ${loc.fact}`+studyExtra(loc.name),0);
    hudUpdate(); afterAnswer();
  });
}

// --- 지역 추리: 힌트를 하나씩 열며 지역을 추리해 탭 (힌트를 아낄수록 고득점) ---
function buildHints(loc){
  const muniName=loc.accept[0].replace(/\(.+\)$/,'');
  const kind=muniName.endsWith('군')?'군(郡)':muniName.match(/(광역시|특별시|특별자치시)$/)?'광역 도시':'도시';
  const prov=MUNIS[loc.accept[0]]?.prov||'';
  const h1=`${loc.region} 지방의 ${kind}`;
  // 설명을 의미 단위로 잘라 힌트 2~3개 구성 (괄호·숫자 보호, 단어 중간 잘림 방지)
  const masked=maskName(loc.desc||loc.fact, loc);
  const parts=splitFact(masked).filter(s=>s.length>=4);
  let h2, h3;
  if(parts.length>=2){
    h2=parts[0]; h3=parts.slice(1).join(', ');
  } else {
    // 한 덩어리 설명: 절반 근처의 공백(단어 경계)에서 분할
    const words=masked.split(' ');
    if(words.length>=4){
      const cut=Math.ceil(words.length/2);
      h2=words.slice(0,cut).join(' ')+' …';
      h3=masked;
    } else {
      h2=masked; h3=masked;   // 너무 짧으면 그대로
    }
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
  fitRegion(loc.region);                 // 출제 권역으로 자동 확대

  const reveal=()=>{
    loc.accept.forEach(n=>muniEl(n)?.classList.add('correct','hit'));
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
    const exact=loc.accept.includes(tapped);
    if(exact){ correct=true; base=baseFull; head=`🕵️ 명추리! (힌트 ${revealed}개)`; }
    else if(d<=55){ correct=true; base=Math.round(baseFull/2); head=`👍 근접! (${tapped} 탭, 절반 점수)`; t.classList.add('wrong'); labelWrongMuni(tapped); }
    else { head=`❌ 아쉬워요 (${tapped} 탭)`; t.classList.add('wrong'); labelWrongMuni(tapped); }
    reveal();
    const pts=award(correct,base);
    recordStat(loc.region,correct);
    logResult(loc.accept[0], exact);
    feedback(correct,head,expBody(),pts);
    hudUpdate(); afterAnswer();
  };
  setMapTap(handler);
  startTimer(info.time||40,()=>{ if(G.locked)return; G.locked=true; clearMapTap();
    reveal(); award(false,0); recordStat(loc.region,false); logResult(loc.accept[0], false);
    feedback(false,'⏰ 아깝다, 시간 초과!',expBody(),0);
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
  // 출제 시·군 주변으로 자동 확대 (이미 깜빡임으로 공개된 상태)
  {
    const bb=muniBBox(name);
    fitViewTo([{x:bb.x,y:bb.y},{x:bb.x+bb.w,y:bb.y+bb.h}], Math.max(bb.w,bb.h)*0.9+40);
  }
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
      if(correct) muniEl(name)?.classList.add('hit');
      const pts=award(correct,100);
      recordStat(m.region,correct);
      logResult(name, correct);
      feedback(correct,correct?'⭕ 정답!':'❌ 오답!',`<b>${name}</b> (${m.prov})`+studyExtra(name.replace(/\(.+\)$/,'')),pts);
      hudUpdate(); afterAnswer();
    };
    grid.appendChild(b);
  });
  startTimer(info.time||15,()=>{ if(G.locked)return; G.locked=true;
    grid.querySelectorAll('button').forEach(x=>{ x.disabled=true; if(x.dataset.n===name) x.classList.add('correct'); });
    muniEl(name)?.classList.remove('pulse'); muniEl(name)?.classList.add('correct');
    award(false,0); recordStat(m.region,false); logResult(name, false);
    feedback(false,'⏰ 아깝다, 시간 초과!',`<b>${name}</b> (${m.prov})`,0);
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
// 인구 변화 라인 그래프 (2010=100 상댓값, 두 지역) — 수능 단골 형태
function renderPopChange(seriesA, seriesB, labels){
  labels = labels || ['(가)','(나)'];
  const W=330, H=200, L=38, R=14, T=18, B=34;
  const years=POP_SERIES_YEARS;
  const all=seriesA.concat(seriesB);
  const ymax=Math.max(200, Math.ceil(Math.max(...all)/50)*50);
  const x=i=>L+(W-L-R)*i/(years.length-1);
  const y=v=>T+(H-T-B)*(1-v/ymax);
  let grid='';
  for(let v=0; v<=ymax; v+=50){
    grid+=`<line x1="${L}" y1="${y(v).toFixed(1)}" x2="${W-R}" y2="${y(v).toFixed(1)}" stroke="#D8E8F2" stroke-width="${v===100?1.4:0.6}" ${v===100?'':'stroke-dasharray="3 3"'}/>`+
      `<text x="${L-5}" y="${(y(v)+3).toFixed(1)}" text-anchor="end" font-size="8" fill="#6E93AE">${v}</text>`;
  }
  const months=[0,3,6,9].map(i=>`<text x="${x(i).toFixed(1)}" y="${H-9}" text-anchor="middle" font-size="8" fill="#6E93AE">${("'"+String(years[i]).slice(2))}</text>`).join('');
  const line=(s,col)=>`<polyline fill="none" stroke="${col}" stroke-width="2.4" points="${s.map((v,i)=>x(i).toFixed(1)+','+y(v).toFixed(1)).join(' ')}"/>`+
    s.map((v,i)=>`<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.2" fill="${col}"/>`).join('');
  // 끝점 라벨
  const endLbl=(s,col,txt)=>`<text x="${(W-R-2).toFixed(1)}" y="${(y(s[s.length-1])-4).toFixed(1)}" text-anchor="end" font-size="10" font-weight="800" fill="${col}">${txt}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="climate-graph" xmlns="http://www.w3.org/2000/svg">
    ${grid}${months}
    ${line(seriesA,'#1278C2')}${line(seriesB,'#E2574C')}
    ${endLbl(seriesA,'#1278C2',labels[0])}${endLbl(seriesB,'#E2574C',labels[1])}
    <text x="${L}" y="${T-6}" font-size="8" fill="#6E93AE">2010=100 상댓값</text>
  </svg>`;
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
  const qtype = 'tap';   // 모바일 편의: 항상 지도 탭형(진술형 선지 스크롤 제거)

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
  const qtype = 'tap';   // 모바일 편의: 항상 지도 탭형(진술형 선지 스크롤 제거)

  // 인구 변화 그래프 사용 조건: 탭형 + 둘 다 시계열 보유 + 2020 상댓값 차이가 충분
  const canPop = markers.every(s=>s.popSeries) && Math.abs(markers[0].popSeries[9]-markers[1].popSeries[9])>=12;
  const usePop = qtype==='tap' && canPop && Math.random()<0.5;
  // 인구 변화일 땐 (가)(나)를 2020 상댓값 오름차순으로 매핑(그래프 끝점 낮은 쪽=가)
  const order = usePop ? [0,1].sort((a,b)=>markers[a].popSeries[9]-markers[b].popSeries[9]) : (qtype==='tap'?gOrder:[0,1]);
  const chartLabels = qtype==='tap' ? ['(가)','(나)'] : ['A','B'];
  let chart;
  if(usePop){
    chart=renderPopChange(markers[order[0]].popSeries, markers[order[1]].popSeries, chartLabels);
  } else {
    const chartRows = order.map(mi=>({v:set.inds.map(k=>statVal(markers[mi],k))}));
    const ct=['table','bars','scatter'][Math.floor(Math.random()*3)];
    if(ct==='table') chart=renderPairTable(chartRows, metas, chartLabels);
    else if(ct==='bars') chart=renderPairBars(chartRows, metas, chartLabels);
    else chart=renderScatterSVG(chartRows.map(r=>({v1:r.v[0], v2:r.v[1]})), metas[0], metas[1], chartLabels);
  }

  const popPoint = usePop
    ? `<div class="fb-extra">📈 1975~2020 인구 변화(2010=100): 수도권·대도시 주변은 우상향, 농어촌·산업 쇠퇴 지역은 우하향</div>` : '';
  const expBody=()=>`A: ${shortSido(markers[0].name)} · B: ${shortSido(markers[1].name)}<div class="fb-extra">📌 ${set.point}</div>${popPoint}`;
  const revealNames=()=>{
    document.querySelectorAll('#map-svg .match-mark').forEach(g=>g.remove());
    markers.forEach(s=>{ const c=provCenter(s.name); addLabel(c.x, c.y+4, shortSido(s.name)); });
  };

  if(qtype==='tap'){
    const targetSd=markers[order[0]];
    $('question-box').innerHTML=
      `<span class="q-region">통계 비교</span> 자료의 <b style="color:var(--sea-d)">(가)</b>에 해당하는 시·도를 지도의 A·B에서 탭하세요!`+
      chart+`<div class="map-hint">${usePop?'인구 변화 그래프(2010=100) — 증가/감소 추세로 판단!':'통계청 자료 — 산업·인구의 지역 차로 판단!'} (A·B 시·도만 탭 가능)</div>`;
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
    feedback(false,'⏰ 아깝다, 시간 초과!',`💡 ${q.exp}`,0);
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
    feedback(false,'⏰ 아깝다, 시간 초과!',`정답: ${q.answer?'O':'X'} — ${q.exp}`,0);
    hudUpdate(); afterAnswer();
  });
}

// ============================================================
// 탐색(학습) 모드 — 탭 기반
// ============================================================
const EXP={list:[], i:-1};
function startExplore(){
  show('screen-game');
  ['hud-qnum','hud-combo','hud-score'].forEach(id=>$(id).parentElement.style.visibility='hidden');
  $('timer-bar').style.width='0%';

  $('question-box').innerHTML='<span class="q-region">학습 모드</span> 시·군이나 파란 점을 탭하거나, ◀ ▶ 로 지역을 넘겨 보세요.';
  const box=$('choices-box');
  box.innerHTML='<div class="explore-controls" id="exp-chips"></div><div id="exp-info" class="exp-info">지역을 선택하면 핵심 정보가 여기에 표시됩니다.</div>';
  const chipBox=$('exp-chips');
  ['전체',...MAP_REGIONS].forEach(r=>{
    const b=document.createElement('button');
    b.className='chip'+(r==='전체'?' on':''); b.textContent=regionLabel(r);
    b.onclick=()=>{ chipBox.querySelectorAll('.chip').forEach(c=>c.classList.remove('on')); b.classList.add('on'); renderExploreDots(r); };
    chipBox.appendChild(b);
  });
  renderExploreDots('전체');

  // 시·군/점 탭 → 해당 지역으로 이동
  const svg=$('map-svg');
  svg.onclick=(e)=>{
    if(suppressTap) return;
    const dot=e.target.closest('.loc-dot');
    if(dot){ const i=EXP.list.findIndex(l=>l.name===dot.dataset.name); if(i>=0) expShow(i); return; }
    const t=e.target.closest('.muni');
    if(!t) return;
    const name=t.dataset.name;
    const i=EXP.list.findIndex(l=>l.accept.includes(name));
    if(i>=0){ expShow(i); return; }
    // 등록 지점이 없는 시·군: 간단 정보 + 확대
    document.querySelectorAll('#map-svg .muni').forEach(x=>x.classList.remove('flash'));
    t.classList.add('flash');
    const bb=muniBBox(name);
    fitViewTo([{x:bb.x,y:bb.y},{x:bb.x+bb.w,y:bb.y+bb.h}], Math.max(bb.w,bb.h)*0.8+40);
    const rc2=REGION_COLORS[MUNIS[name].region]||{};
    $('exp-info').innerHTML=
      `<div class="exp-head"><b>${name.replace(/\(.+\)$/,'')}</b><span class="reg-chip" style="background:${rc2.deep||'var(--sea)'}">${regionLabel(MUNIS[name].region)}</span></div>`+
      `<div class="exp-popline">${popBadgeHTML(name)}</div>`+
      `<div class="exp-text">등록된 수능 포인트가 없는 지역 — 경계와 위치만 눈에 익혀 두세요!</div>`+studyExtra(name.replace(/\(.+\)$/,''));
  };
}
// 괄호 내부와 숫자(33.9km, 1,947m 등)를 보호하며 쉼표·마침표로 분리
function splitFact(f){
  const parts=[]; let cur=''; let depth=0;
  for(let i=0;i<(f||'').length;i++){
    const ch=f[i];
    if(ch==='('||ch==='（') depth++;
    if(ch===')'||ch==='）') depth=Math.max(0,depth-1);
    const numCtx=/\d/.test(f[i-1]||'') && /\d/.test(f[i+1]||'');
    if((ch===','||ch==='.') && depth===0 && !numCtx){ parts.push(cur); cur=''; }
    else cur+=ch;
  }
  parts.push(cur);
  return parts.map(s=>s.trim()).filter(s=>s.length>=2);
}
// 뱃지는 핵심 8종만: 도명 유래·특례시·도청 소재지·혁신도시·기업도시·1기/2기 신도시·국가 산업 단지
const DONAME_ORIGIN=['강릉','원주','충주','청주','전주','나주','경주','상주'];   // 강원·충청·전라·경상
const TEUKRYE=['수원','고양','용인','창원','화성'];                              // 특례시(2022·2025)
const SINDOSI1=['성남','고양','부천'];                                           // 분당·일산·중동 (안양·군포는 지점 미등록)
const SINDOSI2=['성남','화성','김포','파주','수원','용인','하남','평택','인천']; // 판교·동탄·한강·운정·광교·위례·고덕·검단
function factBadges(loc){
  const fact=loc.fact||'';
  const base=(loc.name||'').replace(/\(.+\)$/,'');
  const badges=[];
  const add=(t,cls)=>{ if(!badges.some(b=>b.t===t)) badges.push({t,cls}); };
  if(DONAME_ORIGIN.includes(base)) add('📜 도(道) 명칭 유래','b-origin');
  if(TEUKRYE.includes(base)||/특례시/.test(fact)) add('⭐ 특례시','b-teuk');
  if(/도청/.test(fact)) add('🏛️ 도청 소재지','b-docheong');
  if(/혁신도시/.test(fact)) add('🏢 혁신도시','b-hyuksin');
  if(/기업도시/.test(fact)) add('💼 기업도시','b-gieop');
  if(SINDOSI1.includes(base)||/1기 신도시/.test(fact)) add('🏘️ 수도권 1기 신도시','b-sin1');
  if(SINDOSI2.includes(base)||/2기 신도시/.test(fact)) add('🌆 수도권 2기 신도시','b-sin2');
  if(/국가 ?산업 ?단지/.test(fact)) add('⚙️ 국가 산업 단지','b-sandan');
  return {badges, texts:splitFact(fact)};
}
// 권역 표기: 수도권 외에는 '권'을 붙여 통일 (강원권·충청권…)
function regionLabel(r){
  return (r==='수도권'||!MAP_REGIONS.includes(r)) ? r : r+'권';
}
// 시·군 인구 순위 (전국 / 권역 내)
let POP_RANK=null;
function popRank(name){
  if(!POP_RANK){
    POP_RANK={};
    const entries=Object.entries(MUNIS).filter(([n,m])=>m.pop>0);
    const nat=entries.slice().sort((a,b)=>b[1].pop-a[1].pop);
    nat.forEach(([n],i)=>POP_RANK[n]={nat:i+1});
    for(const reg of MAP_REGIONS){
      entries.filter(([n,m])=>m.region===reg)
        .sort((a,b)=>b[1].pop-a[1].pop)
        .forEach(([n],i)=>{ POP_RANK[n].reg=i+1; });
    }
  }
  return POP_RANK[name];
}
function popBadgeHTML(muniName, region){
  const m=MUNIS[muniName];
  if(!m||!m.pop) return '';
  const r=popRank(muniName);
  return `<span class="exp-pop">👥 인구 ${fmtPop(m.pop)}</span>`+
    `<span class="exp-rank rk-nat">전국 ${r.nat}위</span>`+
    `<span class="exp-rank rk-reg">${regionLabel(region||m.region)} ${r.reg}위</span>`;
}
function expShow(i){
  if(!EXP.list.length) return;
  EXP.i=(i+EXP.list.length)%EXP.list.length;
  const l=EXP.list[EXP.i];
  // 지도: 해당 시·군 강조 + 확대
  document.querySelectorAll('#map-svg .muni').forEach(x=>x.classList.remove('flash'));
  l.accept.forEach(n=>muniEl(n)?.classList.add('flash'));
  const bb=muniBBox(l.accept[0]);
  fitViewTo([{x:bb.x,y:bb.y},{x:bb.x+bb.w,y:bb.y+bb.h}], Math.max(bb.w,bb.h)*0.8+40);
  // 정보 패널
  const {badges,texts}=factBadges(l);
  const rc=REGION_COLORS[l.region]||{};
  $('exp-info').innerHTML=
    `<div class="exp-nav">
       <button class="ghost-btn exp-prev">◀ 이전</button>
       <span class="exp-count">${EXP.i+1} / ${EXP.list.length}</span>
       <button class="ghost-btn exp-next">다음 ▶</button>
     </div>
     <div class="exp-head"><b>${cardDisplayName(l)}</b>
       <span class="reg-chip" style="background:${rc.deep||'var(--sea)'}">${regionLabel(l.region)}</span>
     </div>
     <div class="exp-popline">${popBadgeHTML(l.accept[0], l.region)}</div>`+
    (badges.length?`<div class="exp-badges">${badges.map(b=>`<span class="exp-badge ${b.cls}">${b.t}</span>`).join('')}</div>`:'')+
    (texts.length?`<div class="exp-text">${texts.join('. ')}</div>`:'')+
    studyExtra(l.name.replace(/\(.+\)$/,''));
  $('exp-info').querySelector('.exp-prev').onclick=()=>expShow(EXP.i-1);
  $('exp-info').querySelector('.exp-next').onclick=()=>expShow(EXP.i+1);
  // 좌우 스와이프로도 넘기기
  const panel=$('exp-info');
  let sx=null;
  panel.ontouchstart=(e)=>{ sx=e.touches[0].clientX; };
  panel.ontouchend=(e)=>{
    if(sx===null) return;
    const dx=e.changedTouches[0].clientX-sx; sx=null;
    if(Math.abs(dx)>48) expShow(EXP.i+(dx<0?1:-1));
  };
}
function renderExploreDots(region){
  clearMapExtras();
  resetView();
  dimOtherRegions(region==='전체'?'전체':region);
  EXP.list=LOCATIONS.filter(l=>region==='전체'||l.region===region);
  EXP.i=-1;
  $('exp-info').innerHTML='지역을 선택하거나 ◀ ▶ 로 넘겨 보세요.'+
    `<div class="exp-nav" style="margin-top:8px"><button class="ghost-btn" onclick="expShow(0)">첫 지역부터 보기 ▶</button></div>`;
  const tip=$('map-tooltip');
  EXP.list.forEach(l=>{
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
// 권역별 카드 색 (배경 틴트 / 칩·지도 채움색)
const REGION_COLORS = {
  '수도권': {bg:'#D9EFFD', deep:'#1278C2', map:'#6FB7EC'},
  '강원':   {bg:'#DDF3E1', deep:'#2FA34F', map:'#7FCB8F'},
  '충청':   {bg:'#FFF3C9', deep:'#C77F00', map:'#F6CE5B'},
  '호남':   {bg:'#FFE5E1', deep:'#D8554A', map:'#F08A80'},
  '영남':   {bg:'#EAE4FB', deep:'#6A5ACD', map:'#A795E0'},
  '제주':   {bg:'#FFE9D4', deep:'#E8740C', map:'#F9A86B'},
};
// ----- 지역성 테마 스탬프(미니 일러스트) 라이브러리 -----
// 각 스탬프는 100×100 기준 좌표로 그리고 호출 시 위치·크기로 변환
const STAMP_ART = {
  tea:    `<ellipse cx="35" cy="55" rx="26" ry="14" fill="#2FA34F" transform="rotate(-35 35 55)"/><ellipse cx="68" cy="48" rx="24" ry="13" fill="#5CB531" transform="rotate(25 68 48)"/><path d="M35 55 Q50 30 68 48" stroke="#1F7A38" stroke-width="5" fill="none" stroke-linecap="round"/>`,
  ship:   `<path d="M15 62 L85 62 L72 84 L28 84 Z" fill="#1278C2"/><rect x="44" y="34" width="12" height="28" fill="#E2574C"/><rect x="36" y="46" width="28" height="16" rx="3" fill="#fff"/><path d="M8 70 Q18 64 28 70 T48 70 T68 70 T88 70" stroke="#7CC4F0" stroke-width="6" fill="none" stroke-linecap="round"/>`,
  factory:`<rect x="20" y="45" width="60" height="38" rx="4" fill="#8FA6B6"/><rect x="28" y="28" width="12" height="20" fill="#6E93AE"/><rect x="52" y="22" width="12" height="26" fill="#6E93AE"/><circle cx="34" cy="18" r="8" fill="#fff" opacity=".9"/><circle cx="62" cy="12" r="10" fill="#fff" opacity=".8"/><rect x="30" y="56" width="11" height="11" fill="#FFD23F"/><rect x="56" y="56" width="11" height="11" fill="#FFD23F"/>`,
  apple:  `<circle cx="50" cy="58" r="26" fill="#E2574C"/><circle cx="40" cy="50" r="8" fill="#FF8E8E" opacity=".8"/><path d="M50 34 Q52 22 62 18" stroke="#7A4E21" stroke-width="6" fill="none" stroke-linecap="round"/><ellipse cx="66" cy="26" rx="12" ry="7" fill="#5CB531" transform="rotate(28 66 26)"/>`,
  grape:  `<circle cx="38" cy="46" r="11" fill="#8E7BE5"/><circle cx="60" cy="46" r="11" fill="#7E6CD9"/><circle cx="49" cy="60" r="11" fill="#6A5ACD"/><circle cx="38" cy="73" r="10" fill="#8E7BE5"/><circle cx="60" cy="73" r="10" fill="#7E6CD9"/><path d="M50 36 Q50 22 58 16" stroke="#7A4E21" stroke-width="5" fill="none" stroke-linecap="round"/><ellipse cx="64" cy="22" rx="11" ry="6" fill="#5CB531" transform="rotate(20 64 22)"/>`,
  citrus: `<circle cx="50" cy="58" r="26" fill="#FF9F2E"/><circle cx="41" cy="50" r="7" fill="#FFC97C" opacity=".9"/><ellipse cx="58" cy="30" rx="12" ry="7" fill="#2FA34F" transform="rotate(-18 58 30)"/>`,
  rice:   `<path d="M50 84 Q48 52 50 30" stroke="#C7A14A" stroke-width="5" fill="none"/><g fill="#FFD23F" stroke="#C7A14A" stroke-width="2"><ellipse cx="42" cy="34" rx="7" ry="11" transform="rotate(20 42 34)"/><ellipse cx="58" cy="34" rx="7" ry="11" transform="rotate(-20 58 34)"/><ellipse cx="40" cy="50" rx="7" ry="11" transform="rotate(25 40 50)"/><ellipse cx="60" cy="50" rx="7" ry="11" transform="rotate(-25 60 50)"/><ellipse cx="50" cy="22" rx="7" ry="11"/></g>`,
  crab:   `<ellipse cx="50" cy="58" rx="24" ry="17" fill="#F08A80"/><circle cx="42" cy="50" r="4.5" fill="#fff"/><circle cx="58" cy="50" r="4.5" fill="#fff"/><circle cx="42" cy="50" r="2.2" fill="#4A3426"/><circle cx="58" cy="50" r="2.2" fill="#4A3426"/><path d="M28 46 Q14 36 18 24 M72 46 Q86 36 82 24" stroke="#E2574C" stroke-width="6" fill="none" stroke-linecap="round"/><circle cx="16" cy="22" r="7" fill="#E2574C"/><circle cx="84" cy="22" r="7" fill="#E2574C"/>`,
  snow:   `<g stroke="#7CC4F0" stroke-width="6" stroke-linecap="round"><path d="M50 18 V82 M22 34 L78 66 M78 34 L22 66"/></g><circle cx="50" cy="50" r="8" fill="#fff" stroke="#7CC4F0" stroke-width="4"/>`,
  mountain:`<path d="M14 80 L42 32 L60 60 L72 42 L90 80 Z" fill="#2FA34F"/><path d="M42 32 L52 49 L46 49 L54 60 L34 60 L42 46 Z" fill="#fff" opacity=".9"/>`,
  temple: `<path d="M18 46 Q50 18 82 46 L74 46 Q50 28 26 46 Z" fill="#4A6E3A"/><path d="M24 50 H76 L72 44 H28 Z" fill="#8E5A2B"/><rect x="32" y="50" width="36" height="26" fill="#F2E6D0"/><rect x="44" y="56" width="12" height="20" fill="#8E5A2B"/><rect x="28" y="76" width="44" height="7" rx="2" fill="#A8794A"/>`,
  train:  `<rect x="22" y="34" width="56" height="38" rx="14" fill="#fff" stroke="#1278C2" stroke-width="5"/><rect x="30" y="42" width="40" height="13" rx="5" fill="#7CC4F0"/><circle cx="38" cy="64" r="5" fill="#1B4F8F"/><circle cx="62" cy="64" r="5" fill="#1B4F8F"/><path d="M22 78 H78" stroke="#9CC8E8" stroke-width="5" stroke-linecap="round"/>`,
  lighthouse:`<path d="M42 30 H58 L62 78 H38 Z" fill="#fff" stroke="#E2574C" stroke-width="4"/><path d="M40 44 H60 M39 58 H61" stroke="#E2574C" stroke-width="7"/><rect x="40" y="18" width="20" height="13" rx="4" fill="#FFD23F"/><path d="M30 84 H70" stroke="#1278C2" stroke-width="6" stroke-linecap="round"/>`,
  ginseng:`<path d="M50 30 Q46 48 50 56 Q40 62 36 78 M50 56 Q60 64 62 80 M50 42 Q42 46 38 42" stroke="#D9B48A" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M50 30 Q44 18 34 16 M50 30 Q56 16 66 14" stroke="#2FA34F" stroke-width="6" fill="none" stroke-linecap="round"/><ellipse cx="32" cy="14" rx="9" ry="5" fill="#5CB531"/><ellipse cx="68" cy="12" rx="9" ry="5" fill="#5CB531"/>`,
  cheese: `<path d="M16 64 L84 40 L84 76 L16 76 Z" fill="#FFD23F" stroke="#E8B100" stroke-width="3"/><circle cx="42" cy="62" r="6" fill="#FFF3C9"/><circle cx="62" cy="56" r="5" fill="#FFF3C9"/><circle cx="70" cy="68" r="4" fill="#FFF3C9"/>`,
  butterfly:`<g fill="#F2889B"><ellipse cx="34" cy="42" rx="17" ry="14" transform="rotate(-20 34 42)"/><ellipse cx="66" cy="42" rx="17" ry="14" transform="rotate(20 66 42)"/><ellipse cx="36" cy="64" rx="13" ry="11" transform="rotate(15 36 64)" fill="#FF6B9D"/><ellipse cx="64" cy="64" rx="13" ry="11" transform="rotate(-15 64 64)" fill="#FF6B9D"/></g><rect x="46" y="34" width="8" height="40" rx="4" fill="#4A3426"/><path d="M48 32 Q42 22 36 20 M52 32 Q58 22 64 20" stroke="#4A3426" stroke-width="3.5" fill="none" stroke-linecap="round"/>`,
  hotspring:`<ellipse cx="50" cy="68" rx="30" ry="14" fill="#7CC4F0"/><path d="M36 50 Q32 40 36 32 M50 52 Q46 40 50 30 M64 50 Q60 40 64 32" stroke="#9CC8E8" stroke-width="6" fill="none" stroke-linecap="round"/>`,
  cow:    `<ellipse cx="50" cy="56" rx="26" ry="22" fill="#C68A4F"/><ellipse cx="50" cy="66" rx="13" ry="9" fill="#F2D9BD"/><circle cx="41" cy="48" r="4" fill="#4A3426"/><circle cx="59" cy="48" r="4" fill="#4A3426"/><circle cx="45" cy="65" r="2.5" fill="#8E5A2B"/><circle cx="55" cy="65" r="2.5" fill="#8E5A2B"/><path d="M26 40 Q18 32 20 24 M74 40 Q82 32 80 24" stroke="#A8794A" stroke-width="6" fill="none" stroke-linecap="round"/><ellipse cx="28" cy="46" rx="7" ry="5" fill="#C68A4F"/><ellipse cx="72" cy="46" rx="7" ry="5" fill="#C68A4F"/>`,
  fish:   `<ellipse cx="46" cy="52" rx="26" ry="15" fill="#7CC4F0"/><path d="M70 52 L88 38 L88 66 Z" fill="#5BB8F0"/><circle cx="32" cy="48" r="4" fill="#1B4F8F"/><path d="M40 44 Q48 38 58 42 M42 60 Q50 66 60 62" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  garlic: `<path d="M50 26 Q42 36 36 50 Q30 70 50 78 Q70 70 64 50 Q58 36 50 26 Z" fill="#F6F0E4" stroke="#D9CBB0" stroke-width="3"/><path d="M50 30 V76 M42 40 Q46 60 50 76 M58 40 Q54 60 50 76" stroke="#D9CBB0" stroke-width="2.5" fill="none"/><path d="M50 26 Q52 16 58 12" stroke="#5CB531" stroke-width="5" fill="none" stroke-linecap="round"/>`,
  cave:   `<path d="M20 80 Q20 34 50 30 Q80 34 80 80 Z" fill="#8E7BE5"/><path d="M34 80 Q34 52 50 50 Q66 52 66 80 Z" fill="#3B2F66"/><path d="M44 50 L46 62 M56 52 L54 64" stroke="#C9BEF5" stroke-width="4" stroke-linecap="round"/>`,
  volcano:`<path d="M22 78 Q34 42 44 40 L56 40 Q66 42 78 78 Z" fill="#C68A4F"/><ellipse cx="50" cy="40" rx="9" ry="4" fill="#8E5A2B"/><path d="M30 66 Q40 58 50 66 T70 66" stroke="#A8D158" stroke-width="6" fill="none" stroke-linecap="round"/>`,
  plane:  `<path d="M22 58 L78 42 Q86 40 84 48 L80 52 L40 64 Z" fill="#fff" stroke="#1278C2" stroke-width="4"/><path d="M52 48 L42 30 L52 30 L62 45 Z" fill="#7CC4F0"/><path d="M44 60 L38 72 L46 70 L52 58 Z" fill="#7CC4F0"/><circle cx="74" cy="46" r="3" fill="#1278C2"/>`,
  car:    `<path d="M22 62 Q24 48 36 46 L62 44 Q74 44 78 56 L80 62 Q82 70 74 70 H28 Q20 70 22 62 Z" fill="#5BB8F0" stroke="#1278C2" stroke-width="3.5"/><rect x="38" y="48" width="20" height="11" rx="4" fill="#DFF3FD"/><circle cx="36" cy="70" r="7" fill="#1B4F8F"/><circle cx="66" cy="70" r="7" fill="#1B4F8F"/>`,
  chip:   `<rect x="30" y="30" width="40" height="40" rx="6" fill="#1B4F8F"/><rect x="40" y="40" width="20" height="20" rx="3" fill="#7CC4F0"/><g stroke="#1B4F8F" stroke-width="5" stroke-linecap="round"><path d="M38 30 V18 M50 30 V18 M62 30 V18 M38 70 V82 M50 70 V82 M62 70 V82 M30 38 H18 M30 50 H18 M30 62 H18 M70 38 H82 M70 50 H82 M70 62 H82"/></g>`,
  pottery:`<path d="M38 26 H62 Q58 36 64 44 Q74 56 64 72 Q58 80 50 80 Q42 80 36 72 Q26 56 36 44 Q42 36 38 26 Z" fill="#7FB8A4" stroke="#4E8A75" stroke-width="3"/><path d="M40 50 Q50 44 60 50 M42 60 Q50 55 58 60" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".8"/>`,
  building:`<rect x="30" y="26" width="40" height="56" rx="4" fill="#9CC8E8"/><g fill="#FFF3C9"><rect x="37" y="34" width="9" height="9"/><rect x="54" y="34" width="9" height="9"/><rect x="37" y="50" width="9" height="9"/><rect x="54" y="50" width="9" height="9"/><rect x="44" y="66" width="12" height="16" fill="#1B4F8F"/></g>`,
  strawberry:`<path d="M50 36 Q72 38 70 58 Q66 78 50 82 Q34 78 30 58 Q28 38 50 36 Z" fill="#E2574C"/><g fill="#FFF3C9"><circle cx="42" cy="52" r="2.5"/><circle cx="58" cy="52" r="2.5"/><circle cx="50" cy="64" r="2.5"/><circle cx="40" cy="66" r="2"/><circle cx="60" cy="66" r="2"/></g><path d="M40 36 L50 26 L60 36 L50 40 Z" fill="#2FA34F"/>`,
};
// 지역성 → 스탬프 매핑 (위에서부터 우선)
const STAMP_RULES = [
  [/치즈/,'cheese'], [/녹차|차밭|다향/,'tea'], [/한우|목축|축산/,'cow'],
  [/조선 공업|조선소|항구|항만|포구/,'ship'], [/제철|철강|석유 화학|정유|시멘트/,'factory'],
  [/공항/,'plane'], [/자동차/,'car'], [/반도체|전자|디스플레이|IT|광\(光\)/,'chip'],
  [/사과/,'apple'], [/포도|와인|복분자/,'grape'], [/감귤/,'citrus'], [/딸기/,'strawberry'],
  [/인삼|홍삼|산수유/,'ginseng'], [/마늘|양파/,'garlic'],
  [/갯벌|염전|천일염|대게|꽃게/,'crab'], [/오징어|산천어|재첩|굴비|수산|멸치|전복/,'fish'],
  [/동굴|카르스트|석회/,'cave'], [/화산|오름|용암|주상 절리|분화구/,'volcano'],
  [/눈|동계|스키|설|폭설/,'snow'], [/온천/,'hotspring'],
  [/청자|도자기|옹기/,'pottery'], [/나비|반딧불|생태|습지|늪|철새/,'butterfly'],
  [/불국사|해인사|하회|법주사|사찰|향교|서원|읍성|한옥|고인돌|왕릉|유적|성당|절/,'temple'],
  [/KTX|철도|기차|전철/,'train'], [/등대|다도해|섬|도서/,'lighthouse'],
  [/벼|쌀|평야|곡창|간척/,'rice'], [/혁신도시|도청|행정|신도시|청사/,'building'],
  [/국립 공원|산맥|고원|봉|산$|산지|지리산|설악|덕유|소백/,'mountain'],
];
function stampsOf(loc){
  const text=(loc.fact||'')+' '+(loc.name||'');
  const found=[];
  for(const [re,key] of STAMP_RULES){
    if(re.test(text) && !found.includes(key)) found.push(key);
    if(found.length>=2) break;
  }
  if(!found.length) found.push('mountain');
  return found;
}
function stampSVG(key, x, y, size, flip){
  const art=STAMP_ART[key]||STAMP_ART.mountain;
  return `<g data-stamp="${key}" transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${(size/100*(flip?-1:1)).toFixed(4)},${(size/100).toFixed(4)}) translate(-50,-50)">${art}</g>`;
}

// 아이콘 스타일의 귀여운 땅 캐릭터: 연두 땅 + 흰 외곽선(고정 두께) + 얼굴
function cuteLandSVG(mu, withFace, loc){
  const bb=muniBBox(mu), m=MUNIS[mu];
  const s=Math.sqrt(bb.w*bb.h);          // 기하평균 → 길쭉한 지역도 얼굴 크기 일정
  // 얼굴 비율 (도형 크기에 비례 → 카드마다 같은 느낌)
  const er=s*0.052, gap=s*0.14;
  const fx=m.cx, fy=m.cy;
  const face=withFace?`
    <g class="land-face">
      <circle cx="${fx-gap/2}" cy="${fy}" r="${er}" fill="#4A3426"/>
      <circle cx="${fx+gap/2}" cy="${fy}" r="${er}" fill="#4A3426"/>
      <circle cx="${fx-gap/2+er*0.3}" cy="${fy-er*0.35}" r="${er*0.32}" fill="#fff"/>
      <circle cx="${fx+gap/2+er*0.3}" cy="${fy-er*0.35}" r="${er*0.32}" fill="#fff"/>
      <ellipse cx="${fx-gap*0.95}" cy="${fy+er*1.1}" rx="${er*0.85}" ry="${er*0.5}" fill="#FF8F7A" opacity=".65"/>
      <ellipse cx="${fx+gap*0.95}" cy="${fy+er*1.1}" rx="${er*0.85}" ry="${er*0.5}" fill="#FF8F7A" opacity=".65"/>
      <path d="M ${fx-er*0.9} ${fy+er*1.15} Q ${fx} ${fy+er*2.3} ${fx+er*0.9} ${fy+er*1.15}"
            fill="none" stroke="#4A3426" stroke-width="${(er*0.42).toFixed(2)}" stroke-linecap="round"/>
    </g>`:'';
  // 지역성 스탬프: 주제 일러스트를 땅 주변에 배치
  let stampG='';
  if(withFace && loc){
    const st=stampsOf(loc);
    stampG += stampSVG(st[0], fx+s*0.40, fy-s*0.34, s*0.46, false);
    if(st[1]) stampG += stampSVG(st[1], fx-s*0.42, fy+s*0.34, s*0.36, false);
  }
  return `<svg viewBox="${bb.x.toFixed(0)} ${bb.y.toFixed(0)} ${bb.w.toFixed(0)} ${bb.h.toFixed(0)}" class="card-sil">
    <path d="${m.d}" class="land-shadow" vector-effect="non-scaling-stroke"/>
    <path d="${m.d}" class="land" vector-effect="non-scaling-stroke"/>
    ${face}${stampG}</svg>`;
}
// 도(道) 소속 시·군은 '경북 구미'처럼 도 이름을 함께 표기
const PROV_SHORT={'경기도':'경기','강원특별자치도':'강원','충청북도':'충북','충청남도':'충남',
  '전북특별자치도':'전북','전라남도':'전남','경상북도':'경북','경상남도':'경남','제주특별자치도':'제주'};
function cardDisplayName(loc){
  const mu=loc.accept[0];
  const prov=MUNIS[mu]?.prov||'';
  const base=loc.name.replace(/\(.+\)$/,'');
  const short=PROV_SHORT[prov];
  return short ? `${short} ${base}` : base;
}
function fmtPop(p){
  if(!p) return '';
  if(p>=1e6) return (p/1e4).toFixed(0)+'만';
  if(p>=1e5) return Math.round(p/1e4)+'만';
  return (p/1e4).toFixed(1)+'만';
}
function cardHTML(loc, owned, count){
  const rar=RARITY_META[rarityOf(loc)];
  const mu=loc.accept[0];
  const rc=REGION_COLORS[loc.region]||REGION_COLORS['수도권'];
  const meaning=(loc.fact||'').split(/[,·]/)[0].trim();
  const pop=MUNIS[mu]?.pop;
  if(!owned){
    return `<div class="rcard unknown">
      <div class="card-sil-wrap">${cuteLandSVG(mu,false)}</div>
      <div class="rcard-name">???</div><div class="rcard-meaning">${loc.region} 지방</div></div>`;
  }
  return `<div class="rcard ${rar.cls}" style="--regbg:${rc.bg};--regdeep:${rc.deep}">
    <div class="rcard-rar">${rar.label}</div>
    <div class="rcard-reg">${regionLabel(loc.region)}</div>
    <span class="rcard-spark s1">✦</span><span class="rcard-spark s2">✦</span>
    <span class="rcard-cloud c1"></span><span class="rcard-cloud c2"></span>
    <div class="card-sil-wrap">${cuteLandSVG(mu,true,loc)}</div>
    <div class="rcard-name">${cardDisplayName(loc)}</div>
    <div class="rcard-meaning">${meaning}</div>
    ${pop?`<div class="rcard-pop">👥 ${fmtPop(pop)}</div>`:''}
    ${count>1?`<div class="rcard-cnt">×${count}</div>`:''}
  </div>`;
}
// 카드 상세 보기: 큰 카드 + 전체 설명 + 실제 이미지(마스코트·명소) 검색 연결
function openCardDetail(loc){
  const modal=$('gacha-modal');
  modal.classList.remove('hidden');
  const card=$('gacha-card');
  card.classList.add('flipped'); card.classList.remove('legend-glow');
  if(rarityOf(loc)==='전설') card.classList.add('legend-glow');
  $('gcard-front').innerHTML=cardHTML(loc,true,cards[loc.name]||1);
  const pop=MUNIS[loc.accept[0]]?.pop;
  const pr=pop?popRank(loc.accept[0]):null;
  $('gacha-msg').innerHTML=
    `<div style="max-width:300px;margin:0 auto;line-height:1.6"><b>${cardDisplayName(loc)}</b>${pop?` · 인구 약 ${fmtPop(pop)} 명 (전국 ${pr.nat}위 · ${regionLabel(loc.region)} ${pr.reg}위)`:''}<br>${loc.fact}</div>`+
    `<div style="margin-top:8px">${imgSearchLink(loc.name.replace(/\(.+\)$/,''),'마스코트')} ${imgSearchLink(loc.name.replace(/\(.+\)$/,''),'관광 명소')}</div>`;
  $('btn-draw-again').classList.add('hidden');
}
// 🗺️ 정복 지도: 수집한 카드의 시·군이 권역 색으로 채워짐
function conquestMapSVG(){
  const ownedMuni=new Set();
  Object.keys(cards).forEach(n=>{
    const l=LOCATIONS.find(x=>x.name===n);
    if(l) l.accept.forEach(a=>ownedMuni.add(a));
  });
  let paths='';
  for(const [name,m] of Object.entries(MUNIS)){
    if(ownedMuni.has(name)){
      const c=(REGION_COLORS[m.region]||{}).map||'#9CC8E8';
      paths+=`<path d="${m.d}" fill="${c}" stroke="#FFFFFF" stroke-width=".7"/>`;
    } else {
      paths+=`<path d="${m.d}" fill="#E9F0F4" stroke="#D3DEE6" stroke-width=".5"/>`;
    }
  }
  let borders='';
  for(const p of Object.values(PROVINCES)) borders+=`<path d="${p.d}" fill="none" stroke="#B9C9D4" stroke-width="1"/>`;
  const total=new Set(LOCATIONS.flatMap(l=>l.accept)).size;
  return {svg:`<svg viewBox="-8 -8 776 822" class="conquest-map">${paths}${borders}</svg>`,
          owned:ownedMuni.size, total};
}
function updateGachaUI(){
  if($('coin-cnt')) $('coin-cnt').innerHTML=`🪙 <b>${coins}</b>`;
  if($('coll-progress')) $('coll-progress').textContent=`카드 ${Object.keys(cards).length}/${LOCATIONS.length}장 수집 — 지점 카드 모으기`;
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
  missionProgress({isNew:!dup});
  scheduleSync();
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
    c.onclick=()=>{ if(owned) openCardDetail(l); };
    grid.appendChild(c);
  });
  const ownedCnt=list.filter(l=>cards[l.name]).length;
  $('coll-title-progress').textContent=`${ownedCnt}/${list.length}`;
}
function openCollection(){
  show('screen-cards');
  // 정복 지도
  const cq=conquestMapSVG();
  $('conquest-wrap').innerHTML=
    `<div class="conquest-head">🗺️ 나의 백지도 정복 <b>${cq.owned}</b>/${cq.total} 시·군</div>`+cq.svg+
    `<div class="map-hint" style="text-align:center">지점 카드 ${LOCATIONS.length}장을 모두 모으면 ${cq.total}개 시·군이 채워집니다<br>(한 시·군에 여러 지점이 있어 카드 수와 시·군 수가 다릅니다)</div>`;
  const chipBox=$('coll-chips'); chipBox.innerHTML='';
  ['전체',...MAP_REGIONS].forEach(r=>{
    const b=document.createElement('button');
    b.className='chip'+(r==='전체'?' on':''); b.textContent=regionLabel(r);
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
    const acc = answered? Math.round(G.correctCnt/answered*100):0;
    const earned=Math.max(answered>=3?1:0, Math.round(G.score/100));
    coins+=earned; store.save('geo_coins',coins); updateGachaUI();
    if(G.mode==='boss'){
      const need=Math.ceil(G.queue.length*0.7), win=G.correctCnt>=need;
      const first = win && !titles[G.bossRegion];
      if(win){ titles[G.bossRegion]=true; store.save('geo_titles',titles); }
      $('result-title').textContent = win ? '👹 보스 격파!' : '👹 보스가 버텼습니다';
      $('result-main').textContent = `${G.correctCnt} / ${G.queue.length} 격파`;
      detail.innerHTML =
        (win ? `🏆 칭호 <b style="color:var(--gold)">${bossTitle(G.bossRegion)}</b> ${first?'획득!':'유지'}`
             : `${need}타 이상 명중하면 격파! 한 번 더 도전하세요.`)+
        `<br>🪙 카드 코인 +${earned} (보유 ${coins})`+
        `<br><span style="font-size:.86em">${resultComment(acc)}</span>`;
      xp+=Math.round(G.score/10);
      if(win) confetti(document.querySelector('.result-card'));
    } else {
      $('result-title').textContent=MODE_INFO[G.mode].title+' 결과';
      $('result-main').textContent=G.score+'점';
      detail.innerHTML=`정답 ${G.correctCnt} / ${answered} (정답률 ${acc}%) · 최대 콤보 ${G.maxCombo}🔥`+
        (earned?`<br>🪙 카드 코인 <b style="color:var(--gold)">+${earned}</b> (보유 ${coins}${coins>=DRAW_COST?' — 뽑기 가능!':''})`:'')+
        `<br><span style="font-size:.86em">${resultComment(acc)}</span>`;
      xp+=Math.round(G.score/10);
      if(acc>=70 && answered>=5) confetti(document.querySelector('.result-card'));
      if(G.score>0 && G.mode!=='wanted'){   // 수배 복습은 개인 연습 — 공개 랭킹 등록 생략
        $('name-entry').classList.remove('hidden');
        $('player-name').value=store.load('geo_lastname','');
      }
    }
  }
  store.save('geo_xp',xp);
  scheduleSync();
}

$('btn-save-score').onclick=()=>{
  const name=($('player-name').value.trim()||'무명').slice(0,10);
  const mode=G.mode, score=G.score;
  store.save('geo_lastname',name);
  const list=board[mode]||(board[mode]=[]);
  list.push({name,score,date:new Date().toISOString().slice(0,10)});
  list.sort((a,b)=>b.score-a.score); board[mode]=list.slice(0,10);
  store.save('geo_board',board);                 // 로컬 백업(서버 불가 시 fallback)
  $('name-entry').classList.add('hidden');
  // 서버 공유 명예의 전당 등록 후 갱신
  postServerScore(mode, name, score).then(res=>{ if(res) fetchServerBoard().then(b=>{ if(b) renderHomeBoard(); }); });
};
$('btn-retry').onclick=()=>startGame(G.mode);
$('btn-home').onclick=()=>{ initHome(); show('screen-home'); resetHomeTab(); };
$('btn-quit').onclick=()=>{ stopTimer(); clearMapTap(); $('map-svg').onclick=null;
  ['hud-qnum','hud-combo','hud-score'].forEach(id=>$(id).parentElement.style.visibility='');
  initHome(); show('screen-home'); resetHomeTab();
};

// ---------- 게임 모드 캐러셀: 화살표·드래그·휠 가로 스크롤 ----------
(function initCarousel(){
  const car=$('mode-carousel'); if(!car) return;
  const prev=$('car-prev'), next=$('car-next');
  const step=()=>car.querySelector('.mode-card').offsetWidth+11;
  const updateArrows=()=>{
    if(!prev||!next) return;
    prev.disabled=car.scrollLeft<=2;
    next.disabled=car.scrollLeft>=car.scrollWidth-car.clientWidth-2;
  };
  prev&&(prev.onclick=()=>{ car.scrollBy({left:-step()*1.2, behavior:'smooth'}); });
  next&&(next.onclick=()=>{ car.scrollBy({left:step()*1.2, behavior:'smooth'}); });
  car.addEventListener('scroll', updateArrows, {passive:true});
  // 마우스 드래그(데스크톱)
  let down=false, sx=0, sl=0, moved=false;
  car.addEventListener('mousedown',e=>{ down=true; moved=false; sx=e.pageX; sl=car.scrollLeft; car.classList.add('dragging'); });
  window.addEventListener('mousemove',e=>{ if(!down) return; const dx=e.pageX-sx; if(Math.abs(dx)>4) moved=true; car.scrollLeft=sl-dx; });
  window.addEventListener('mouseup',()=>{ if(down){ down=false; car.classList.remove('dragging'); } });
  // 드래그 직후 카드 클릭 방지
  car.addEventListener('click',e=>{ if(moved){ e.preventDefault(); e.stopPropagation(); moved=false; } }, true);
  // 세로 휠 → 가로 스크롤
  car.addEventListener('wheel',e=>{
    if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){ car.scrollLeft+=e.deltaY; e.preventDefault(); }
  }, {passive:false});
  setTimeout(updateArrows, 100);
})();

// ---------- 카드 뽑기/컬렉션 이벤트 ----------
$('btn-draw').onclick=openGacha;
$('btn-draw-again').onclick=openGacha;
$('btn-gacha-close').onclick=()=>{
  $('gacha-modal').classList.add('hidden');
  $('btn-draw-again').classList.remove('hidden');
  if($('screen-cards').classList.contains('active')) openCollection(); else initHome();
};
$('btn-collection').onclick=openCollection;
$('btn-explore').onclick=()=>startGame('explore');
$('btn-cards-back').onclick=()=>{ initHome(); show('screen-home'); };

// ---------- 로그인 / 동기화 모달 ----------
function openLogin(){
  if(account){
    if(confirm(`${account.nickname}(${account.cls})에서 로그아웃할까요?\n(이 기기의 기록은 그대로 남습니다)`)) logoutAccount();
    return;
  }
  $('login-msg').textContent='';
  $('login-modal').classList.remove('hidden');
}
$('account-chip')?.addEventListener('click', openLogin);
$('login-close')?.addEventListener('click', ()=>$('login-modal').classList.add('hidden'));
$('login-guest')?.addEventListener('click', ()=>$('login-modal').classList.add('hidden'));
$('login-submit')?.addEventListener('click', async ()=>{
  const cls=$('login-class').value.trim(), nick=$('login-nick').value.trim(), pin=$('login-pin').value.trim();
  const msg=$('login-msg');
  if(!cls||!nick||!/^\d{4,8}$/.test(pin)){ msg.textContent='반·닉네임·비밀번호(숫자 4~8자리)를 입력하세요'; return; }
  $('login-submit').disabled=true; msg.textContent='연결 중…';
  const res=await doLogin(cls, nick, pin);
  $('login-submit').disabled=false;
  if(res.error){ msg.textContent=res.error; return; }
  $('login-modal').classList.add('hidden');
  renderAccount();
  alert(res.isNew? `환영해요, ${nick}님! 이제 기록이 저장됩니다.` : `${nick}님 기록을 불러왔어요!`);
});
// ---------- 교사 대시보드 ----------
$('teacher-link')?.addEventListener('click', (e)=>{ e.preventDefault(); $('teacher-result').innerHTML=''; $('teacher-modal').classList.remove('hidden'); });
$('teacher-close')?.addEventListener('click', ()=>$('teacher-modal').classList.add('hidden'));
$('teacher-submit')?.addEventListener('click', async ()=>{
  const cls=$('teacher-class').value.trim(), pw=$('teacher-pw').value;
  const box=$('teacher-result');
  if(!cls||!pw){ box.innerHTML='<div class="t-msg">반과 비밀번호를 입력하세요</div>'; return; }
  box.innerHTML='<div class="t-msg">조회 중…</div>';
  const res=await apiRoster(cls, pw);
  if(res.error){ box.innerHTML=`<div class="t-msg">${res.error}</div>`; return; }
  if(!res.students.length){ box.innerHTML=`<div class="t-msg">‘${cls}’ 반에 저장된 학생이 없습니다</div>`; return; }
  box.innerHTML=`<div class="t-msg">${cls} · ${res.count}명 (XP순)</div>`+
    '<table class="t-table"><tr><th>#</th><th>닉네임</th><th>XP</th><th>최근 접속</th></tr>'+
    res.students.map((s,i)=>`<tr><td>${i+1}</td><td>${s.nickname}</td><td>${s.xp}</td><td>${s.updated||'-'}</td></tr>`).join('')+
    '</table>';
});

// ---------- 하단 탭 네비게이션 ----------
document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click',()=>{
  const t=b.dataset.tab;
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active', p.id==='tab-'+t));
  document.querySelectorAll('.tab-btn').forEach(x=>x.classList.toggle('active', x===b));
  try{ window.scrollTo(0,0); }catch(e){}
}));
// 홈 복귀 시 항상 '플레이' 탭으로
function resetHomeTab(){
  const pb=document.querySelector('.tab-btn[data-tab="play"]');
  if(pb) pb.click();
}

// ---------- 시작 ----------
buildMap();
initMapGestures();
initHome();
syncOnLoad();
