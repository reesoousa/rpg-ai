const hex=h=>{h=h.replace('#','');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16));};
const lin=c=>{c/=255;return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4;};
const L=r=>0.2126*lin(r[0])+0.7152*lin(r[1])+0.0722*lin(r[2]);
const ratio=(a,b)=>{const l1=L(hex(a)),l2=L(hex(b));const[hi,lo]=l1>l2?[l1,l2]:[l2,l1];return(hi+0.05)/(lo+0.05);};
const over=(fg,a,bg)=>{const f=hex(fg),b=hex(bg);return '#'+f.map((c,i)=>Math.round(c*a+b[i]*(1-a)).toString(16).padStart(2,'0')).join('');};

console.log('=== DARK: separacao surface vs fundo, SEM borda ===');
console.log('fundo #0B0613. Alvo pratico: ratio 1.25-1.6 (perceptivel, nao gritante)\n');
const dBg='#0B0613';
for (const a of [0.03,0.04,0.05,0.06,0.08,0.10,0.12]) {
  const s = over('#FFFFFF', a, dBg);
  const s2 = over('#FFFFFF', a*2, dBg);
  console.log(`white ${String(a*100).padStart(2)}%  surface=${s}  ratio_vs_bg=${ratio(s,dBg).toFixed(2)}   |  elevado(${(a*200).toFixed(0)}%)=${s2} ratio=${ratio(s2,dBg).toFixed(2)} delta=${ratio(s2,s).toFixed(2)}`);
}
console.log('\n=== com tinta violeta (mantem identidade) ===');
for (const [c,a] of [['#B688FF',0.05],['#B688FF',0.07],['#B688FF',0.09],['#8342EB',0.10],['#8342EB',0.14]]) {
  const s=over(c,a,dBg);
  console.log(`${c} ${String(a*100).padStart(2)}%  surface=${s}  ratio_vs_bg=${ratio(s,dBg).toFixed(2)}  texto#F4F2F8=${ratio('#F4F2F8',s).toFixed(2)}  muted#AEADC3=${ratio('#AEADC3',s).toFixed(2)}`);
}
console.log('\n=== LIGHT: surface vs fundo #FAF8FC, SEM borda ===');
const lBg='#FAF8FC';
for (const c of ['#FFFFFF','#F4F1F8','#EFEBF5','#E9E4F1']) {
  console.log(`surface=${c}  ratio_vs_bg=${ratio(c,lBg).toFixed(2)}  texto#14101F=${ratio('#14101F',c).toFixed(2)}  muted#5B5670=${ratio('#5B5670',c).toFixed(2)}`);
}
console.log('\nNota: em light o card BRANCO sobre fundo levemente tintado da ratio ~1.03 —');
console.log('imperceptivel. Sem borda, a separacao em light TEM de vir de sombra.');

console.log('\n=== INPUT sem borda: superficie recuada ===');
console.log(`dark  input #060310 sobre surface #1A1425 -> ratio ${ratio('#060310','#1A1425').toFixed(2)}`);
console.log(`light input #EFEBF5 sobre surface #FFFFFF -> ratio ${ratio('#EFEBF5','#FFFFFF').toFixed(2)}`);
console.log('\n=== focus ring (WCAG 2.4.11 exige >=3:1 vs adjacente) ===');
console.log(`dark  ring #B688FF vs surface #1A1425 -> ${ratio('#B688FF','#1A1425').toFixed(2)}`);
console.log(`light ring #6E28D9 vs surface #FFFFFF -> ${ratio('#6E28D9','#FFFFFF').toFixed(2)}`);
