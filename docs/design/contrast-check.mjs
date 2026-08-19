const hex = h => { h=h.replace('#',''); if(h.length===3) h=[...h].map(c=>c+c).join(''); return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)); };
const lin = c => { c/=255; return c<=0.03928 ? c/12.92 : ((c+0.055)/1.055)**2.4; };
const L = rgb => 0.2126*lin(rgb[0])+0.7152*lin(rgb[1])+0.0722*lin(rgb[2]);
const ratio = (a,b) => { const l1=L(hex(a)), l2=L(hex(b)); const [hi,lo]=l1>l2?[l1,l2]:[l2,l1]; return (hi+0.05)/(lo+0.05); };
const over = (fg, alpha, bg) => { const f=hex(fg), b=hex(bg); return '#'+f.map((c,i)=>Math.round(c*alpha+b[i]*(1-alpha)).toString(16).padStart(2,'0')).join(''); };
const fix = (fg, bg, target=4.5) => {
  if (ratio(fg,bg) >= target) return {hex:fg, moved:0};
  const towards = L(hex(bg)) > 0.18 ? '#000000' : '#ffffff';
  for (let p=1; p<=100; p++) {
    const c = over(towards, p/100, fg);
    if (ratio(c,bg) >= target) return {hex:c, moved:p};
  }
  return {hex:towards, moved:100};
};
const AA=4.5, UI=3.0;
const rows=[];
const check=(label,fg,bg,target)=>{ const r=ratio(fg,bg); const ok=r>=target;
  const f = ok?null:fix(fg,bg,target);
  rows.push({label,fg,bg,ratio:+r.toFixed(2),alvo:target,ok, sugerido: f?f.hex:''}); };

const dBg='#0B0613';
const dSurf = over('#120E1C',0.55,dBg);
console.log('surface dark resolvida :', dSurf);
check('dark texto',          '#F4F2F8', dBg, AA);
check('dark muted',          '#AEADC3', dBg, AA);
check('dark accent-text',    '#B688FF', dBg, AA);
check('dark texto/surface',  '#F4F2F8', dSurf, AA);
check('dark muted/surface',  '#AEADC3', dSurf, AA);
check('branco/primary',      '#FFFFFF', '#8342EB', AA);
check('dark dano',           '#FF4A57', dBg, AA);
check('dark cura',           '#31EE64', dBg, AA);
check('dark alerta',         '#FF6333', dBg, AA);
check('dark magico',         '#EA78E2', dBg, AA);
check('dark primary/bg (UI)','#8342EB', dBg, UI);

const lBg='#FAF8FC';
const lSurf = over('#FFFFFF',0.65,lBg);
console.log('surface light resolvida:', lSurf);
check('light texto',         '#14101F', lBg, AA);
check('light muted',         '#5B5670', lBg, AA);
check('light accent-text',   '#6E28D9', lBg, AA);
check('branco/primary-lt',   '#FFFFFF', '#6E28D9', AA);
check('light dano',          '#FF4A57', lBg, AA);
check('light cura',          '#31EE64', lBg, AA);
check('light alerta',        '#FF6333', lBg, AA);
check('light magico',        '#EA78E2', lBg, AA);

const w=[24,10,10,8,6,6,10];
const head=['par','fg','bg','ratio','alvo','ok','sugerido'];
console.log('\n'+head.map((h,i)=>h.padEnd(w[i])).join(''));
console.log('-'.repeat(w.reduce((a,b)=>a+b)));
for(const r of rows) console.log([r.label,r.fg,r.bg,r.ratio,r.alvo,r.ok?'PASS':'FAIL',r.sugerido].map((c,i)=>String(c).padEnd(w[i])).join(''));
const fails=rows.filter(r=>!r.ok);
console.log(`\n${rows.length-fails.length}/${rows.length} passam. ${fails.length} precisam de ajuste.`);
