import { fbm, mulberry32 } from '../.mirror/rng.mjs';
const N=500, seed=12345;
// raw fbm distribution
const vals=[];
for(let y=0;y<N;y+=2) for(let x=0;x<N;x+=2) vals.push(fbm(seed,x/62,y/62,5));
vals.sort((a,b)=>a-b);
const pct=p=>vals[Math.floor(p*(vals.length-1))].toFixed(3);
console.log('fbm percentiles  min',pct(0),'p10',pct(.1),'p25',pct(.25),'p50',pct(.5),'p75',pct(.75),'p90',pct(.9),'p99',pct(.99),'max',pct(1));
