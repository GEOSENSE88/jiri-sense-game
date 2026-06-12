// 모바일(390x844) 실제 렌더링 스크린샷
const path=require('path');
const {chromium, devices}=require(path.join(process.env.TEMP,'geo_test','node_modules','playwright'));
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.LOCALAPPDATA+'\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe'});
  const ctx=await browser.newContext({...devices['iPhone 13'], locale:'ko-KR'});
  const page=await ctx.newPage();
  const out=path.join(__dirname,'..','_extract');
  await page.goto('https://geosense88.github.io/jiri-sense-game/', {waitUntil:'networkidle'});
  await page.waitForTimeout(800);
  await page.screenshot({path:path.join(out,'m_home_top.png')});
  await page.evaluate(()=>window.scrollTo(0, document.body.scrollHeight*0.45));
  await page.waitForTimeout(300);
  await page.screenshot({path:path.join(out,'m_home_mid.png')});
  // 위치 사냥 진입
  await page.evaluate(()=>{ window.scrollTo(0,0); startGame('location'); });
  await page.waitForTimeout(900);
  await page.screenshot({path:path.join(out,'m_game_loc.png')});
  // 기후 비교
  await page.evaluate(()=>startGame('climate'));
  await page.waitForTimeout(900);
  await page.screenshot({path:path.join(out,'m_game_climate.png')});
  await browser.close();
  console.log('saved 4 screenshots');
})();
