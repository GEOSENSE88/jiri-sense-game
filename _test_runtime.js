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

console.log('\n=== 줌/팬 ===');
window.eval('zoomAt(380,400,0.5)');
check(window.eval('view.w') < 776, '줌인 시 viewBox 축소');
window.eval('resetView()');
check(window.eval('view.w') === 776, '줌 리셋');

console.log('\n=== 위치 사냥 (시·군 탭) ===');
window.eval("startGame('location')");
check(document.getElementById('screen-game').classList.contains('active'), '게임 화면 전환');
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

console.log('\n=== 마스코트 찾기 ===');
window.eval("startGame('mascot')");
const ms = window.eval('G.queue[0]');
check(document.getElementById('question-box').textContent.includes(ms.name), '마스코트 이름 표시');
check(!document.getElementById('question-box').textContent.includes(ms.accept[0].replace(/[시군]$/,'')), '문제에 정답 지역명 미노출');
document.querySelector(`#map-svg .muni[data-name="${ms.accept[0]}"]`)
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check(window.eval('G.score') > 0, '정답 시·군 탭 → 점수 부여');
check(document.getElementById('feedback-box').textContent.includes(ms.name), '해설에 마스코트 정보 표시');

console.log('\n=== 기후 비교 (매칭형) ===');
// 매칭형 강제 진입
window.eval("startGame('climate'); G.queue=[{kind:'match',set:CLIMATE_SETS[0]},{kind:'order',set:ORDER_SETS[0]}]; G.idx=0; nextQuestion();");
check(document.querySelectorAll('#map-svg .match-mark').length === 3, '지도에 A·B·C 마커 3개');
check(document.querySelector('#question-box svg.climate-graph') !== null, '산점도 SVG 렌더링');
check(document.getElementById('question-box').textContent.includes('(가)'), '(가)~(다) 자료 표기');
check(document.querySelectorAll('#choices-box .choice-btn').length === 5, '순열 보기 5개');
{
  // 정답 보기 클릭 (G의 내부 correct 알 수 없으므로 모든 버튼 텍스트 중 정답 클릭은 dataset.p 비교로)
  const btns=[...document.querySelectorAll('#choices-box .choice-btn')];
  // 정답을 모르는 상태 → 아무거나 클릭 후 correct 클래스가 정확히 1개 버튼에 표시되는지 확인
  btns[0].click();
  const marked=btns.filter(b=>b.classList.contains('correct'));
  check(marked.length === 1, '정답 보기 하이라이트 1개');
  check(document.getElementById('feedback-box').textContent.includes('📌'), '해설에 학습 포인트(point) 표시');
  check(document.querySelectorAll('#map-svg .loc-label').length === 3, '지역명 공개(라벨 3개)');
}
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

console.log('\n=== 통계 비교 (매칭형) ===');
window.eval("startGame('stats')");
const statSet = window.eval('G.queue[0]');
check(document.querySelectorAll('#map-svg .match-mark').length === 3, '시·도 마커 3개');
check(document.querySelector('#question-box svg.climate-graph') !== null, '통계 산점도 렌더링');
check(document.querySelectorAll('#map-svg .muni.dim-region').length > 0, '비대상 시·도 흐림 처리');
{
  const btns=[...document.querySelectorAll('#choices-box .choice-btn')];
  check(btns.length === 5, '순열 보기 5개');
  btns[0].click();
  check(btns.filter(b=>b.classList.contains('correct')).length === 1, '정답 보기 표시');
  check(document.getElementById('feedback-box').textContent.includes('📌'), '학습 포인트 표시');
}

console.log('\n=== 시·도 클릭 (시·군 탭 방식) ===');
window.eval("startGame('province')");
const pq = window.eval('G.queue[0]');
const anyMuni = document.querySelector(`#map-svg .muni[data-prov="${pq.answer}"]`);
anyMuni.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check(window.eval('G.score') > 0, '해당 시·도의 시·군 탭 → 정답');
const allHi = [...document.querySelectorAll(`#map-svg .muni[data-prov="${pq.answer}"]`)].every(m => m.classList.contains('correct'));
check(allHi, '정답 시·도 전체 하이라이트');

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

console.log('\n=== 탐색 모드 (탭 기반) ===');
window.eval("startGame('explore')");
const locCount = window.eval('LOCATIONS.length');
check(document.querySelectorAll('#map-svg .loc-dot').length === locCount, `지점 ${locCount}개 표시`);
// 시·군 탭 → 정보 표시
const seosan = document.querySelector('#map-svg .muni[data-name="서산시"]');
seosan.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check(document.getElementById('exp-info').textContent.includes('서산'), '시·군 탭 → 정보 패널 표시');
check(document.getElementById('exp-info').textContent.includes('석유 화학'), '시·군 내 수능 포인트 연동');

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
