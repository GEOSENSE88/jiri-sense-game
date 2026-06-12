// 카드 SVG 시각 검증: 실제 cuteLandSVG 출력을 PNG로 래스터화
const path=require('path'); const fs=require('fs');
const {Resvg}=require(path.join(process.env.TEMP,'geo_test','node_modules','@resvg/resvg-js'));
const dir=__dirname;
const code=['map-data.js','stats-data.js','freq-data.js','questions.js']
  .map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('\n').replace(/^const /gm,'var ').replace(/^let /gm,'var ');
eval(code);
// game.js에서 필요한 함수만 추출
const game=fs.readFileSync(path.join(dir,'game.js'),'utf8');
function grab(name, end){
  const i=game.indexOf(name);
  const j=game.indexOf(end, i);
  return game.slice(i, j+end.length);
}
const dvar = s => s.replace(/^const /,'var ').replace(/^let /,'var ');
eval(dvar(grab('const STAMP_ART','\n};')));
eval(dvar(grab('const STAMP_RULES','\n];')));
eval(grab('function stampsOf','\n}'));
eval(grab('function stampSVG','\n}'));
eval(dvar(grab('let MUNI_BBOX','return MUNI_BBOX[name]={x:minx-pad,y:miny-pad,w:maxx-minx+pad*2,h:maxy-miny+pad*2};\n}')));
eval(grab('function cuteLandSVG','${face}${stampG}</svg>`;\n}'));
const freqOf=(n)=>{ const f=FREQ[n]||FREQ[n+'시']||FREQ[n+'군']; return f?f.count:0; };

const REGION_BG={'수도권':'#D9EFFD','강원':'#DDF3E1','충청':'#FFF3C9','호남':'#FFE5E1','영남':'#EAE4FB','제주':'#FFE9D4'};
const names=['보성','횡성','거제','제주시','울산','단양','함평','금산','영동(충북)','당진','임실','순천'];
const cells=names.map(n=>{
  const l=LOCATIONS.find(x=>x.name===n);
  const inner=cuteLandSVG(l.accept[0],true,l);
  const vb=inner.match(/viewBox="([^"]+)"/)[1];
  return {name:n, region:l.region, inner:inner.replace(/<svg[^>]*>/,'').replace('</svg>',''), vb};
});
// 카드형 합성: 4×3 그리드
const CW=240, CH=320, COLS=4;
let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${CW*COLS}" height="${CH*Math.ceil(cells.length/COLS)}">`;
svg+=`<style>.land{fill:#A8D158;stroke:#fff;stroke-width:2.6}.land-shadow{fill:#3E7C2A55}.nm{font:900 20px sans-serif;fill:#1B4F8F}</style>`;
cells.forEach((c,i)=>{
  const gx=(i%COLS)*CW, gy=Math.floor(i/COLS)*CH;
  const [bx,by,bw,bh]=c.vb.split(' ').map(Number);
  const s=Math.min((CW-50)/bw,(CH-110)/bh);
  svg+=`<g transform="translate(${gx},${gy})">`+
    `<rect x="6" y="6" width="${CW-12}" height="${CH-12}" rx="18" fill="${REGION_BG[c.region]}" stroke="#9CC8E8" stroke-width="4"/>`+
    `<g transform="translate(${CW/2},${(CH-60)/2+14}) scale(${s.toFixed(3)}) translate(${(-bx-bw/2).toFixed(1)},${(-by-bh/2).toFixed(1)})">${c.inner}</g>`+
    `<text x="${CW/2}" y="${CH-30}" text-anchor="middle" class="nm">${c.name} · ${c.region}</text></g>`;
});
svg+='</svg>';
const png=new Resvg(svg,{font:{loadSystemFonts:true}}).render().asPng();
fs.writeFileSync(path.join(dir,'..','_extract','cards_render.png'), png);
console.log('saved cards_render.png');
