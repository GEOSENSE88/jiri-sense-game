// 기후 그래프 생성 수치 점검 (node _test_climate.js)
const fs = require('fs');
const path = require('path');
const dir = __dirname;
let code = ['map-data.js', 'stats-data.js'].map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n').replace(/^const /gm, 'var ');
eval(code);
const game = fs.readFileSync(path.join(dir, 'game.js'), 'utf8');
const m1 = game.match(/function climateIndicators[\s\S]*?\n\}/)[0];
const m2 = game.match(/function renderClimateSVG[\s\S]*?<\/svg>`;\n\}/)[0];
eval(m1 + '\n' + m2);

let bad = 0;
for (const st of CLIMATE) {
  const svg = renderClimateSVG(st);
  if (svg.includes('NaN') || svg.includes('Infinity')) { console.log('SVG 이상:', st.name); bad++; }
  const ind = climateIndicators(st);
  if (!(ind.sRate > 0 && ind.sRate < 100 && ind.total > 300)) { console.log('지표 이상:', st.name, JSON.stringify(ind)); bad++; }
}
console.log('중강:', JSON.stringify(climateIndicators(CLIMATE.find(c => c.name === '중강'))));
console.log('서귀포:', JSON.stringify(climateIndicators(CLIMATE.find(c => c.name === '서귀포'))));
console.log('대관령:', JSON.stringify(climateIndicators(CLIMATE.find(c => c.name === '대관령'))));
console.log(bad ? `❌ ${bad}건 이상` : '✅ 51개 관측소 그래프·지표 모두 정상');
process.exit(bad ? 1 : 0);
