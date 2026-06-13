// 런타임 시뮬레이션 테스트 v2 (jsdom) — 시·군 백지도 버전
// 실행: node _test_runtime.js   (jsdom은 %TEMP%\geo_test 에 설치됨)
const path = require('path');
const fs = require('fs');
const { JSDOM } = require(path.join(process.env.TEMP, 'geo_test', 'node_modules', 'jsdom'));

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

const dom = new JSDOM(html, {
  url: 'https://localhost/geo/index.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;

// jsdom 미구현 API 스텁
window.SVGElement.prototype.getScreenCTM = function(){
  return { inverse(){ return { a:1 }; } };
};
window.SVGSVGElement.prototype.createSVGPoint = function(){
  return { x:0, y:0, matrixTransform(){ return { x: this.x, y: this.y }; } };
};
window.SVGElement.prototype.getBoundingClientRect = function(){
  return { width: 400, height: 420, left: 0, top: 0 };
};
window.prompt = (msg, def) => def || 'T';
window.confirm = () => true;
window.matchMedia = window.matchMedia || (q => ({ matches: false }));

let failures = 0;
const check = (cond, name) => {
  console.log((cond ? '  ✅' : '  ❌') + ' ' + name);
  if (!cond) failures++;
};

// jsdom의 window.eval은 호출마다 별도 스코프 → const/let을 var로 치환해 전역 공유 재현
{
  const all = ['map-data.js', 'stats-data.js', 'freq-data.js', 'match-sets.js', 'questions.js', 'game.js']
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n;\n')
    .replace(/^const /gm, 'var ')
    .replace(/^let /gm, 'var ')
    .replace(/'use strict';/g, '');
  try { window.eval(all); } catch (e) {
    console.log(`❌ 스크립트 로드 중 예외: ${e.message}\n${e.stack}`);
    process.exit(1);
  }
}
console.log('✅ 모든 스크립트 로드 성공 (런타임 예외 없음)');

const muniCount = Object.keys(window.eval('MUNIS')).length;

console.log('\n=== 홈 화면 / 지도 ===');
check(document.querySelectorAll('#map-svg .muni').length === muniCount, `시·군 path ${muniCount}개 렌더링`);
check(document.querySelectorAll('#map-svg .prov-border').length === 17, '시·도 외곽선 17개 오버레이');
check(document.querySelectorAll('#region-chips .chip').length === 9, '출제 범위 칩 9개');
check([...document.querySelectorAll('#region-chips .chip')].some(c=>c.textContent==='충청권'), "홈 칩 '충청권' 표기");
check(window.eval('LOCATIONS.every(l=>Array.isArray(l.accept)&&l.accept.every(a=>MUNIS[a]))'), '모든 지점이 유효한 시·군에 매핑');

console.log('\n=== 빈출 빈도 연동 ===');
check(document.querySelectorAll('#freq-list .freq-row').length === 12, '홈 빈출 TOP 12 표시');
check(document.getElementById('freq-span').textContent.includes('회분'), '분석 회분 표기');
check(window.eval("freqOf('울산광역시')") > 30, '울산 빈도 로드: ' + window.eval("freqOf('울산광역시')"));
check(window.eval("freqOf('태백')") > 10, "접미사 보정(태백→태백시): " + window.eval("freqOf('태백')"));
const ws = window.eval("weightedSample(LOCATIONS, 12, l=>l.name).length");
check(ws === 12, '가중 추출 12개 정상');
check(window.eval("studyExtra('태백')").includes('이미지 자료'), 'studyExtra에 이미지 검색 링크 포함');
check(window.eval("studyExtra('태백')").includes('기출'), 'studyExtra에 기출 빈도 포함');
{
  const names=[...document.querySelectorAll('#freq-list .f-name')].map(n=>n.textContent);
  check(names.length===12 && names.every(n=>!/^(서울|부산|대구|인천|광주|대전|울산|세종)$/.test(n)), `빈출 TOP은 시·군만 (1위: ${names[0]})`);
}

console.log('\n=== 줌/팬 ===');
window.eval('VIEW_ANIM_MS=0');   // 테스트에서는 애니메이션 즉시 적용
window.eval('zoomAt(380,400,0.5)');
check(window.eval('view.w') < 776, '줌인 시 viewBox 축소');
window.eval('resetView()');
check(window.eval('view.w') === 776, '줌 리셋');
// 문제 전환 시 지도 원위치
window.eval("startGame('mcq'); zoomAt(380,400,0.4);");
check(window.eval('view.w') < 776, '문제 중 확대 상태');
window.eval('G.idx=0; nextQuestion();');
check(window.eval('view.w') === 776, '문제 전환 시 지도 자동 원위치');

console.log('\n=== 홈 재배치 (캐러셀·학습 분리) ===');
check(document.getElementById('mode-carousel') !== null, '게임 모드 캐러셀 존재');
check(document.querySelectorAll('#mode-carousel .mode-card').length === 8, '캐러셀에 게임 8종');
check(document.getElementById('btn-explore') !== null, '백지도 탐색이 학습 영역으로 분리');
check(document.querySelector('#mode-carousel [data-mode="explore"]') === null, '캐러셀에 탐색 모드 없음');
check(document.querySelector('.hero-stats #rank-badge') !== null, '히어로 스탯 바(계급)');
check(document.querySelector('.hero-stats #coin-cnt') !== null, '히어로 스탯 바(코인)');

console.log('\n=== 위치 사냥 (시·군 탭) ===');
window.eval("startGame('location')");
check(document.getElementById('screen-game').classList.contains('active'), '게임 화면 전환');
check(window.eval('view.w') < 776, '출제 권역으로 자동 확대');
let loc = window.eval('G.queue[0]');
// 정답 시·군 탭 시뮬레이션
let target = document.querySelector(`#map-svg .muni[data-name="${loc.accept[0]}"]`);
check(!!target, '정답 시·군 path 존재: ' + loc.accept[0]);
target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check(window.eval('G.score') > 0, '정답 탭 → 점수 부여: ' + window.eval('G.score'));
check(target.classList.contains('correct'), '정답 시·군 하이라이트');
check(document.querySelector('#map-svg .loc-label') !== null, '지점 라벨 표시');
document.getElementById('btn-next').click();
// 오답 탭 (정답에서 먼 시·군 선택)
loc = window.eval('G.queue[1]');
const farName = Object.entries(window.eval('MUNIS')).reduce((best,[n,m])=>{
  const d = Math.hypot(m.cx-loc.x, m.cy-loc.y);
  return d > best.d ? {n, d} : best;
}, {n:null,d:-1}).n;
document.querySelector(`#map-svg .muni[data-name="${farName}"]`)
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check(window.eval('G.combo') === 0, '먼 시·군 탭 → 오답 처리(콤보 0)');
{
  const badLabels=[...document.querySelectorAll('#map-svg .loc-label.bad')];
  check(badLabels.length===1 && badLabels[0].textContent===farName.replace(/\(.+\)$/,''), '오답 시 탭한 시·군 이름 라벨 표시');
}

console.log('\n=== 지역 판독 ===');
window.eval("startGame('muniname')");
const mq = window.eval('G.queue[0]');
check(document.querySelector('#map-svg .muni.flash.pulse') !== null, '출제 시·군 깜빡임 표시');
check(document.querySelectorAll('#choices-box .choice-btn').length === 4, '보기 4개');
let btn = [...document.querySelectorAll('#choices-box .choice-btn')].find(b => b.dataset.n === mq);
btn.click();
check(window.eval('G.score') > 0, '정답 → 점수 부여');
const sameProv = window.eval(`(function(){
  const m=MUNIS[${JSON.stringify(mq)}];
  return [...document.querySelectorAll('#choices-box .choice-btn')].every(b=>MUNIS[b.dataset.n]);
})()`);
check(sameProv, '보기가 모두 실제 시·군');

console.log('\n=== 위치 사냥 (설명형) ===');
window.eval("Math._rl=Math.random; Math.random=()=>0;");   // descForm 강제
window.eval("startGame('location')");
const dloc = window.eval('G.queue[0]');
check(document.getElementById('question-box').textContent.includes('설명에 해당하는'), '설명형 발문');
check(document.querySelector('#question-box .stat-card') !== null, '설명 카드 표시');
{
  const stem = dloc.name.replace(/\(.+\)$/,'').replace(/[시군구]$/,'');
  check(stem.length<2 || !document.querySelector('#question-box .stat-card').textContent.includes(stem), '설명에서 지역명 가림(◯◯)');
}
document.querySelector(`#map-svg .muni[data-name="${dloc.accept[0]}"]`)
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check(window.eval('G.score') > 0, '정답 탭 → 점수(설명형 가산)');
check(document.getElementById('feedback-box').textContent.includes(dloc.name.replace(/\(.+\)$/,'')), '해설에 정답 지역명 공개');
window.eval("Math.random=Math._rl;");

console.log('\n=== 기후 비교 (2지역 탭형) ===');
// Math.random=0 → qtype 'tap', 차트 'dual'
window.eval("Math._r=Math.random; Math.random=()=>0;");
window.eval("startGame('climate'); G.queue=[{kind:'match',set:CLIMATE_SETS[0]},{kind:'order',set:ORDER_SETS[0]}]; G.idx=0; nextQuestion();");
check(document.querySelectorAll('#map-svg .match-mark').length === 2, '지도에 A·B 마커 2개');
check(document.querySelector('#question-box .dual-climate') !== null, '기후 그래프 2개 나란히(dual) 렌더링');
check(document.getElementById('question-box').textContent.includes('(가)'), '(가) 탭 발문');
{
  const marks=[...document.querySelectorAll('#map-svg .match-mark circle')]
    .map(c=>({x:+c.getAttribute('cx'), y:+c.getAttribute('cy')}));
  const ordered = Math.abs(marks[0].x-marks[1].x)>=45 ? marks[0].x<=marks[1].x : marks[0].y<=marks[1].y;
  check(ordered, 'A·B 마커가 좌상단→우상단 순서');
}
// 지도 탭 → 즉시 채점
document.getElementById('map-svg').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check(!document.getElementById('feedback-box').classList.contains('hidden'), '탭 후 즉시 피드백');
check(document.getElementById('feedback-box').textContent.includes('📌'), '학습 포인트 표시');
check(document.querySelectorAll('#map-svg .loc-label').length === 2, '두 지역명 공개');
document.getElementById('btn-next').click();
console.log('--- 순서형 ---');
check(document.getElementById('game-body').classList.contains('no-map'), '순서형은 지도 숨김');
check(document.getElementById('question-box').textContent.includes('순서대로'), '순서형 발문');
{
  const btns=[...document.querySelectorAll('#choices-box .choice-btn')];
  check(btns.length === 5, '순서형 보기 5개');
  btns[0].click();
  check(btns.filter(b=>b.classList.contains('correct')).length === 1, '순서형 정답 표시');
  check(document.getElementById('feedback-box').textContent.includes('>'), '해설에 값 순서 표시');
}
console.log('--- 진술형 ---');
window.eval("Math.random=()=>0.9;");   // qtype 'stmt', 차트 scatter
window.eval("startGame('climate'); G.queue=[{kind:'match',set:CLIMATE_SETS[1]}]; G.idx=0; nextQuestion();");
check(document.getElementById('question-box').textContent.includes('옳은 것'), '진술형 발문');
{
  const btns=[...document.querySelectorAll('#choices-box .choice-btn')];
  check(btns.length === 4, '진술 보기 4개');
  check(btns.every(b=>b.textContent.includes('보다')), '모든 보기가 A·B 비교 진술');
  check(btns.filter(b=>b.dataset.t==='1').length === 1, '옳은 진술 정확히 1개');
  btns.find(b=>b.dataset.t==='1').click();
  check(window.eval('G.score') > 0, '진술형 정답 → 점수');
}
window.eval("Math.random=Math._r;");

console.log('\n=== 통계 비교 (2지역) ===');
window.eval("Math._r2=Math.random; Math.random=()=>0;");   // tap형 + table 차트
window.eval("startGame('stats')");
check(document.querySelectorAll('#map-svg .match-mark').length === 2, '시·도 마커 2개');
check(document.querySelector('#question-box .pair-table') !== null, '도표(pair-table) 렌더링');
check(document.querySelectorAll('#map-svg .muni.dim-region').length > 0, '비대상 시·도 흐림 처리');
{
  // A·B 외 시·도 탭은 무시되어야 함
  const other=[...document.querySelectorAll('#map-svg .muni')].find(m=>m.classList.contains('dim-region'));
  other.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check(document.getElementById('feedback-box').classList.contains('hidden'), 'A·B 외 시·도 탭 무시');
  const bright=[...document.querySelectorAll('#map-svg .muni')].find(m=>!m.classList.contains('dim-region'));
  bright.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check(!document.getElementById('feedback-box').classList.contains('hidden'), 'A·B 탭 → 채점');
  check(document.getElementById('feedback-box').textContent.includes('📌'), '학습 포인트 표시');
}
window.eval("Math.random=Math._r2;");

console.log('\n=== 지역 추리 (힌트 게임) ===');
window.eval("startGame('detective')");
const det = window.eval('G.queue[0]');
check(document.querySelectorAll('#question-box .hint-list li').length === 1, '시작 시 힌트 1개');
const hintBtn = document.querySelector('#choices-box .hint-btn');
check(hintBtn !== null, '힌트 열기 버튼 표시');
hintBtn.click();
check(document.querySelectorAll('#question-box .hint-list li').length === 2, '힌트 버튼 → 힌트 2개');
document.querySelector(`#map-svg .muni[data-name="${det.accept[0]}"]`)
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check(window.eval('G.score') > 0, '정답 탭 → 점수(힌트 수만큼 차감)');
check(document.getElementById('feedback-box').textContent.includes('힌트 2개') || document.getElementById('feedback-box').textContent.includes('명추리'), '명추리 피드백');
// 말줄임 잘림 검사: 쉼표 없는 설명(마스코트형)도 단어 중간에서 잘리지 않아야 함
{
  const noComma = window.eval(`(function(){
    const l=locPool().find(x=>x.descOnly && !(x.desc||'').includes(','));
    if(!l) return null;
    return buildHints(l);
  })()`);
  if(noComma){
    check(!/[가-힣]…/.test(noComma[1]), '힌트가 단어 중간에서 잘리지 않음 (공백 경계 분할)');
  } else {
    check(true, '쉼표 없는 설명 항목 없음(검사 생략)');
  }
}

console.log('\n=== 개념 퀴즈 / OX ===');
window.eval("startGame('mcq')");
check(document.getElementById('game-body').classList.contains('no-map'), 'MCQ에서 지도 숨김(no-map)');
let q = window.eval('G.queue[0]');
btn = [...document.querySelectorAll('#choices-box .choice-btn')].find(b => b.dataset.i == q.answer);
btn.click();
check(window.eval('G.score') > 0, 'MCQ 정답 처리');
window.eval("startGame('ox')");
q = window.eval('G.queue[0]');
btn = [...document.querySelectorAll('#choices-box .choice-btn')][q.answer ? 0 : 1];
btn.click();
check(window.eval('G.correctCnt') === 1, 'OX 정답 처리');

console.log('\n=== 1:1 배틀 ===');
window.eval("startGame('battle')");
const b2 = window.eval('G.battle');
check(b2 && b2.turn === 1 && window.eval('G.queue.length') === 16, '배틀 초기화 (16라운드, P1 차례)');
check(!document.getElementById('turn-indicator').classList.contains('hidden'), '차례 표시');

console.log('\n=== 탐색 모드 (넘기기 탐색) ===');
window.eval("startGame('explore')");
const locCount = window.eval('LOCATIONS.length');
check(document.querySelectorAll('#map-svg .loc-dot').length === locCount, `지점 ${locCount}개 표시`);
// 시·군 탭 → 해당 지역으로 이동 + 확대
const seosan = document.querySelector('#map-svg .muni[data-name="서산시"]');
seosan.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check(document.getElementById('exp-info').textContent.includes('서산'), '시·군 탭 → 정보 패널 표시');
check(window.eval('view.w') < 776, '선택 지역으로 지도 확대');
check(document.querySelector('#exp-info .exp-badge') === null && document.querySelector('#exp-info .exp-text') !== null, '서산: 핵심 8종 외 내용은 뱃지 없이 서술식');
// 수원: 도청 소재지 + 특례시 + 2기(광교) 뱃지
window.eval(`expShow(EXP.list.findIndex(l=>l.name==='수원'))`);
{
  const b=[...document.querySelectorAll('#exp-info .exp-badge')].map(x=>x.textContent);
  check(b.some(t=>t.includes('특례시')) && b.some(t=>t.includes('도청 소재지')) && b.some(t=>t.includes('2기 신도시')), `수원 뱃지: ${b.join(' · ')}`);
  const classes=[...document.querySelectorAll('#exp-info .exp-badge')].map(x=>x.className);
  check(new Set(classes).size === classes.length, '뱃지 종류별 색상 클래스 상이');
}
// 성남: 1기(분당) + 2기(판교) 동시 뱃지
window.eval(`expShow(EXP.list.findIndex(l=>l.name==='성남'))`);
{
  const b=[...document.querySelectorAll('#exp-info .exp-badge')].map(x=>x.textContent);
  check(b.some(t=>t.includes('1기 신도시')) && b.some(t=>t.includes('2기 신도시')), `성남 뱃지(1기+2기): ${b.join(' · ')}`);
}
// 권역 칩 '~권' 표기 (학습 모드)
check([...document.querySelectorAll('#exp-chips .chip')].some(c=>c.textContent==='강원권'), "선택 칩 '강원권' 표기");
window.eval(`expShow(EXP.list.findIndex(l=>l.name==='상주'))`);
check([...document.querySelectorAll('#exp-info .exp-badge')].some(x=>x.textContent.includes('명칭 유래')), '상주: 도(道) 명칭 유래 뱃지');
window.eval(`expShow(EXP.list.findIndex(l=>l.name==='서산'))`);
check(document.getElementById('exp-info').textContent.includes('👥'), '인구 표시');
check(document.getElementById('exp-info').textContent.includes('전국') && /권 \d+위/.test(document.getElementById('exp-info').textContent), '전국·권역 인구 순위 표시');
check(document.querySelector('#exp-info .reg-chip').textContent === '충청권', "권역 표기 '충청권' 통일");
// 뱃지 분리 품질: 괄호·숫자 보호
{
  const ic = window.eval(`JSON.stringify(factBadges(LOCATIONS.find(l=>l.name==='인천').fact))`);
  check(!ic.includes('"인천 국제공항(2001"'), '괄호 안 쉼표에서 분리되지 않음');
  const sm = window.eval(`JSON.stringify(splitFact('방조제(33.9km), 완공'))`);
  check(JSON.parse(sm)[0]==='방조제(33.9km)', '숫자 소수점에서 분리되지 않음');
}
check(document.querySelector('#exp-info .exp-count') !== null, '넘기기 내비게이션(n/total)');
{
  const before = document.querySelector('#exp-info .exp-count').textContent;
  document.querySelector('#exp-info .exp-next').click();
  const after = document.querySelector('#exp-info .exp-count').textContent;
  check(before !== after, `다음 ▶ 버튼으로 지역 넘기기 (${before.trim()} → ${after.trim()})`);
}

console.log('\n=== 위치 사냥 중복 방지 ===');
{
  window.eval("localStorage.removeItem('geo_recent_locs')");
  window.eval("startGame('location')");
  const accepts = window.eval("JSON.stringify(G.queue.map(l=>l.accept[0]))");
  const arr = JSON.parse(accepts);
  check(new Set(arr).size === arr.length, `런 내 시·군 중복 없음 (${arr.length}문항)`);
  check(arr.length >= 14, '문항 수 14개로 확대');
  // 같은 설정으로 한 번 더 → 직전 시·군 회피 (전부 같을 수 없음)
  window.eval("startGame('location')");
  const arr2 = JSON.parse(window.eval("JSON.stringify(G.queue.map(l=>l.accept[0]))"));
  const overlap = arr2.filter(a=>arr.includes(a)).length;
  check(overlap <= 4, `직전 런과 겹침 최소화 (겹침 ${overlap}/${arr2.length})`);
}

console.log('\n=== 카드 컬렉션 ===');
{
  window.eval('coins=20; store.save("geo_coins",coins); cards={}; store.save("geo_cards",cards);');
  const res = window.eval('JSON.stringify(drawCard())');
  const r = JSON.parse(res);
  check(r && r.loc && r.loc.name, '카드 뽑기 → 카드 획득: ' + r.loc.name + ` (${r.rar})`);
  check(window.eval('coins') === 15, '뽑기 비용 5🪙 차감');
  check(window.eval(`cards[${JSON.stringify(r.loc.name)}]`) === 1, '보유 카드 기록');
  // 중복 환급
  window.eval(`Math._g=Math.random; Math.random=()=>0.99;`); // 일반 카드 고정 시도
  const before = window.eval('coins');
  window.eval('cards={}; LOCATIONS.slice(0,200).forEach(l=>cards[l.name]=1); store.save("geo_cards",cards);'); // 전부 보유 → 무조건 중복
  window.eval('drawCard()');
  check(window.eval('coins') === before - 5 + 2, '중복 카드 → +2🪙 환급');
  window.eval('Math.random=Math._g;');
  const html = window.eval(`cardHTML(LOCATIONS.find(l=>l.name==='울산'), true, 1)`);
  check(html.includes('card-sil') && html.includes('legend'), '울산 카드 = 전설 등급 + 실루엣 포함');
  check(html.includes('land-face'), '카드에 귀여운 얼굴(눈·볼·미소) 포함');
  check(html.includes('vector-effect="non-scaling-stroke"'), '외곽선 두께 균일(non-scaling-stroke)');
  check(html.includes('rcard-reg') && html.includes('영남'), '권역 칩 표시');
  check(html.includes('rcard-pop') && html.includes('👥'), '인구 뱃지 표시');
  const gm = window.eval(`cardHTML(LOCATIONS.find(l=>l.name==='구미'), true, 1)`);
  check(gm.includes('경북 구미'), '도 이름 병기(경북 구미)');
  const popCover = window.eval(`Object.values(MUNIS).filter(m=>m.pop>0).length`);
  check(popCover === 161, `시·군 인구 데이터 ${popCover}/161 주입`);
  check(html.includes('--regbg'), '권역별 배경색 변수 적용');
  // 지역성 스탬프 일러스트
  const bs = window.eval(`cardHTML(LOCATIONS.find(l=>l.name==='보성'), true, 1)`);
  check(bs.includes('data-stamp="tea"'), '보성 카드에 찻잎 일러스트');
  const hs = window.eval(`cardHTML(LOCATIONS.find(l=>l.name==='횡성'), true, 1)`);
  check(hs.includes('data-stamp="cow"'), '횡성 카드에 소 일러스트');
  const gj = window.eval(`cardHTML(LOCATIONS.find(l=>l.name==='거제'), true, 1)`);
  check(gj.includes('data-stamp="ship"'), '거제 카드에 배 일러스트');
  check(window.eval('Object.keys(STAMP_ART).length') >= 20, '스탬프 라이브러리 20종 이상');
  // 전체 카드가 스탬프를 갖는지(기본 mountain 폴백 포함)
  const noStamp = window.eval(`LOCATIONS.filter(l=>!cardHTML(l,true,1).includes('data-stamp')).length`);
  check(noStamp === 0, '모든 카드에 테마 일러스트 부여');
  check(window.eval(`cardHTML(LOCATIONS[5], false, 0)`).includes('???'), '미보유 카드는 ??? 처리');
  // 정복 지도
  window.eval(`cards={'보성':1,'울산':1}; store.save('geo_cards',cards);`);
  const cq = JSON.parse(window.eval('const _c=conquestMapSVG(); JSON.stringify({owned:_c.owned,total:_c.total,hasFill:_c.svg.includes("#A795E0")||_c.svg.includes("#F08A80")})'));
  check(cq.owned === 2 && cq.total > 100, `정복 지도: 보유 시·군 ${cq.owned}/${cq.total} 채움`);
  check(cq.hasFill, '정복 지도에 권역 색 채움');
  // 결과 화면 코인 적립
  window.eval("G.mode='mcq'; G.battle=null; G.idx=5; G.correctCnt=4; G.score=620; G.maxCombo=3; coins=0; endGame()");
  check(window.eval('coins') === 6, '결과: 620점 → 6🪙 적립');
  check(document.getElementById('result-detail').textContent.includes('카드 코인'), '결과 화면에 코인 표시');
  document.getElementById('btn-home').click();
}

console.log('\n=== 결과/랭킹 ===');
window.eval("G.mode='mcq'; G.battle=null; G.idx=5; G.correctCnt=4; G.score=620; G.maxCombo=3; endGame()");
check(document.getElementById('screen-result').classList.contains('active'), '결과 화면 전환');
document.getElementById('player-name').value = '테스터';
document.getElementById('btn-save-score').click();
const bd = JSON.parse(window.localStorage.getItem('geo_board'));
check(bd.mcq && bd.mcq[0].name === '테스터', '랭킹 저장');
document.getElementById('btn-home').click();
check(document.getElementById('screen-home').classList.contains('active'), '홈 복귀');
check(window.eval('xp') > 0, 'XP 적립: ' + window.eval('xp'));

console.log(failures ? `\n❌ ${failures}개 실패` : '\n🎉 전체 시나리오 통과');
process.exit(failures ? 1 : 0);
