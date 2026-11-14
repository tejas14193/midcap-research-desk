/* Midcap Research Desk scoring engine. Shared by the page (browser) and tools/update.js (node). Deterministic: no LLM involved. */
(function(root){
"use strict";
const RULES={version:"0.2",
  weights:{growth:35,profit:25,strength:25,gov:15},
  buyQuality:65,watchQuality:55,sellQuality:40,mos:15,overBull:50,
  strongQuality:80,strongMos:20,strongGrowth:60,bearMult:0.75,bullMult:1.25,maxMult:40,strongQuarters:8,
  minQuarters:5,priceStaleDays:10,resultStaleDays:200,clsBand:5,marginBand:0.5};
const LABEL={growth:"Growth",profit:"Profitability",strength:"Financial strength",gov:"Governance"};
const MON={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
/* Quarter index on the Indian April-March year: idx = FY*4 + (quarter-1). "Sep 2026" is Q2 FY27. */
function colIdx(s){const m=/^([A-Z][a-z]{2}) (\d{4})$/.exec(String(s).trim());if(!m||MON[m[1]]==null)return null;const mo=MON[m[1]],y=+m[2];
  const q=mo<=2?3:mo<=5?0:mo<=8?1:2,fy=mo<=2?y:y+1;return fy*4+q}
function pidx(s){const m=/Q\s*([1-4])\s*FY\s*'?(\d{2,4})/i.exec(String(s||""));if(!m)return null;let fy=+m[2];if(fy<100)fy+=2000;return fy*4+(+m[1]-1)}
function plabel(i){return "Q"+(i%4+1)+" FY"+String(Math.floor(i/4)).slice(2)}
function qEnd(i){const fy=Math.floor(i/4),q=i%4;return [new Date(fy-1,5,30),new Date(fy-1,8,30),new Date(fy-1,11,31),new Date(fy,2,31)][q]}
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const lin=(x,lo,hi)=>x==null?null:clamp((x-lo)/(hi-lo),0,1)*100;
const avg=a=>{a=a.filter(v=>v!=null);return a.length?a.reduce((s,v)=>s+v,0)/a.length:null};
const growth=(a,b)=>(a==null||b==null||b<=0)?null:(a/b-1)*100;
const days=(a,b)=>Math.floor((a-b)/864e5);
const f1=x=>x.toFixed(1);

function analyse(co,now){
  now=now||new Date();const fin=co.sector==="fin"||co.industry==="Financial Services";
  const qs=[...co.quarters].sort((a,b)=>a.idx-b.idx),m={};qs.forEach(q=>m[q.idx]=q);
  const ttm=(f,e)=>{let s=0;for(let i=e-3;i<=e;i++){const v=m[i]&&m[i][f];if(v==null)return null;s+=v}return s};
  const A={qs,fin,blocks:[],flags:[],reasons:[],risks:[],scores:{},rows:[]};
  A.rows=qs.map(q=>{const y=m[q.idx-4],p=m[q.idx-1],mg=q.revenue>0&&q.ebitda!=null?q.ebitda/q.revenue*100:null,
    ymg=y&&y.revenue>0&&y.ebitda!=null?y.ebitda/y.revenue*100:null;
    return{q,margin:mg,revYoY:growth(q.revenue,y&&y.revenue),patYoY:growth(q.pat,y&&y.pat),revQoQ:growth(q.revenue,p&&p.revenue),
      marginYoY:mg!=null&&ymg!=null?mg-ymg:null,netDebt:q.debt!=null?q.debt-(q.cash||0):null}});
  if(qs.length<RULES.minQuarters)A.blocks.push("Only "+qs.length+" quarter(s) on file; at least "+RULES.minQuarters+" are needed");
  if(!(co.price>0))A.blocks.push("No current price on file");
  else if(co.priceDate&&days(now,new Date(co.priceDate))>RULES.priceStaleDays)A.blocks.push("Price is older than "+RULES.priceStaleDays+" days");
  if(qs.length){
    const L=qs[qs.length-1],li=L.idx,R=A.rows[A.rows.length-1];A.latest=L;A.row=R;
    if(days(now,qEnd(li))>RULES.resultStaleDays)A.blocks.push("Latest result ("+L.period+") is more than "+RULES.resultStaleDays+" days old");
    let bs=null,pbs=null;for(let i=qs.length-1;i>=0;i--){const q=qs[i];if(q.equity==null)continue;if(!bs){if(q.idx>=li-3)bs=q;else break}else{pbs=q;break}}
    A.bs=bs;A.gross=!bs||bs.cash==null;
    const T={rev:ttm("revenue",li),ebitda:ttm("ebitda",li),pat:ttm("pat",li),int:ttm("interest",li),eps:ttm("eps",li),
      rev0:ttm("revenue",li-4),ebitda0:ttm("ebitda",li-4),pat0:ttm("pat",li-4)};A.T=T;
    let pos=0,neg=0;
    [[R.revYoY,RULES.clsBand],[R.patYoY,RULES.clsBand],[R.marginYoY,RULES.marginBand]].forEach(([v,band])=>{if(v==null)return;if(v>band)pos++;else if(v<-band)neg++});
    A.cls=R.revYoY==null&&R.patYoY==null?"none":pos>=2&&!neg?"improving":neg>=2&&!pos?"weakening":pos&&neg?"mixed":"stable";
    const gRev=growth(T.rev,T.rev0),gPat=growth(T.pat,T.pat0);
    const nd=bs&&bs.debt!=null?bs.debt-(bs.cash||0):null;
    let gn=null;for(let i=qs.length-1;i>=Math.max(0,qs.length-3);i--)if(qs[i].gnpa!=null){gn=qs[i].gnpa;break}
    const M=A.m={revG:gRev!=null?gRev:R.revYoY,patG:gPat!=null?gPat:R.patYoY,ttmBasis:gRev!=null,
      roe:T.pat!=null&&bs&&bs.equity>0?T.pat/bs.equity*100:null,
      mTtm:T.rev>0&&T.ebitda!=null?T.ebitda/T.rev*100:null,mTtm0:T.rev0>0&&T.ebitda0!=null?T.ebitda0/T.rev0*100:null,
      netDebt:nd,ndE:nd!=null&&T.ebitda>0?nd/T.ebitda:null,cov:T.int>0&&T.ebitda!=null?T.ebitda/T.int:null,
      pledge:L.pledge!=null?L.pledge:(co.pledge!=null?co.pledge:null),epsTtm:T.eps,gnpa:gn};
    M.mDelta=M.mTtm!=null&&M.mTtm0!=null?M.mTtm-M.mTtm0:null;
    A.scores.growth=avg([lin(M.revG,0,15),lin(M.patG,0,20)]);
    if(fin){A.scores.profit=lin(M.roe,8,18);A.scores.strength=M.gnpa==null?null:100-lin(M.gnpa,1.5,6)}
    else{A.scores.profit=avg([lin(M.roe,8,18),lin(M.mDelta,-2,1)]);
      const lev=nd==null?null:nd<=0?100:M.ndE==null?null:100-lin(M.ndE,0.5,3);
      const cov=M.cov!=null?lin(M.cov,2,8):(T.int===0?100:null);
      A.scores.strength=avg([lev,cov])}
    A.scores.gov=M.pledge==null?null:100-lin(M.pledge,0,25);
    let w=0,s=0,n=0;for(const k in RULES.weights){const v=A.scores[k];if(v!=null){w+=RULES.weights[k];s+=RULES.weights[k]*v;n++}}
    A.pillars=n;A.quality=n>=(fin?2:3)?s/w:null;
    if(A.quality==null)A.blocks.push("Too few quality pillars can be scored from the data on file");
    /* valuation: trailing EPS x multiple. Default multiples come from the stock's own 5-year median P/E. */
    const bm=co.medPE>0?Math.min(co.medPE,RULES.maxMult):null;
    const mult=co.pe||(bm?{bear:bm*RULES.bearMult,base:bm,bull:bm*RULES.bullMult}:null);
    A.mult=mult;A.multSrc=co.pe?"your own multiples":co.medPE>RULES.maxMult?"a "+RULES.maxMult+"x cap (its 5-year median P/E is "+co.medPE+"x)":"its own 5-year median P/E";
    if(M.epsTtm==null)A.valNote="Trailing EPS needs four consecutive quarters of EPS";
    else if(M.epsTtm<=0)A.valNote="Trailing EPS is zero or negative, so a P/E fair value is unsuitable";
    else if(co.price>0){A.pe=co.price/M.epsTtm;
      if(mult){A.fv={bear:M.epsTtm*mult.bear,base:M.epsTtm*mult.base,bull:M.epsTtm*mult.bull};A.upside=(A.fv.base/co.price-1)*100;A.mos=(1-co.price/A.fv.base)*100}
      else A.valNote="No median P/E is on file, so there is no fair-value range and BUY cannot be issued"}
    const say=(k,txt)=>{const v=A.scores[k];if(v==null)return;if(v>=65)A.reasons.push(txt);else if(v<=40)A.risks.push(txt)};
    if(M.revG!=null)say("growth",(M.ttmBasis?"Trailing 12-month":"Latest-quarter")+" revenue "+(M.revG>=0?"up ":"down ")+f1(Math.abs(M.revG))+"% and profit "+(M.patG==null?"n/a":(M.patG>=0?"up ":"down ")+f1(Math.abs(M.patG))+"%")+" year on year");
    if(M.roe!=null)say("profit","ROE "+f1(M.roe)+"%"+(fin||M.mDelta==null?"":"; EBITDA margin "+(M.mDelta>=0?"up ":"down ")+f1(Math.abs(M.mDelta))+" pts vs a year ago"));
    if(fin){if(M.gnpa!=null)say("strength","Gross NPA "+f1(M.gnpa)+"%")}
    else if(nd!=null)say("strength",nd<=0?(A.gross?"No debt":"Net cash balance sheet"):(A.gross?"Gross debt ":"Net debt ")+f1(M.ndE||0)+"x trailing EBITDA; interest cover "+(M.cov==null?"n/a":f1(M.cov)+"x"));
    if(M.pledge!=null)say("gov","Promoter pledge "+f1(M.pledge)+"%");
    const y=m[li-4];
    if(y&&y.pledge!=null&&L.pledge!=null&&L.pledge>y.pledge+2)A.flags.push("Promoter pledge rose from "+y.pledge+"% to "+L.pledge+"% in a year");
    if(M.pledge!=null&&M.pledge>=10)A.flags.push("Promoters have pledged "+f1(M.pledge)+"% of their holding");
    if(!fin&&pbs&&pbs.debt!=null&&nd!=null&&M.ndE>0.5){const a=pbs.debt-(pbs.cash||0);if(nd>a*1.2)A.flags.push(a<=0?"Balance sheet moved from net cash in "+pbs.period+" to net debt of ₹"+nd.toFixed(0)+" cr in "+bs.period:(A.gross?"Debt":"Net debt")+" rose from ₹"+a.toFixed(0)+" cr in "+pbs.period+" to ₹"+nd.toFixed(0)+" cr in "+bs.period)}
    if(!fin&&R.marginYoY!=null&&R.marginYoY<-2)A.flags.push("EBITDA margin down "+f1(-R.marginYoY)+" pts year on year");
    if(R.patYoY!=null&&R.patYoY<-20)A.flags.push("Net profit down "+f1(-R.patYoY)+"% year on year");
    if(L.pat!=null&&L.pat<0)A.flags.push("Net loss in "+L.period);
    if(!fin&&M.cov!=null&&M.cov<3)A.flags.push("Interest cover below 3x");
    if(fin&&M.gnpa!=null&&M.gnpa>5)A.flags.push("Gross NPA above 5%");
    if(A.mos!=null){if(A.mos>=RULES.mos)A.reasons.push("Price is "+f1(A.mos)+"% below base fair value");else if(A.mos<0)A.risks.push("Price is "+f1(-A.mos)+"% above base fair value")}
  }
  const R_=RULES,q=A.quality;
  if(A.blocks.length){A.newInv=A.holder=A.headline="INSUFFICIENT DATA";A.change=["Resolve the data gaps listed above"]}
  else{
    const buy=q>=R_.buyQuality&&A.mos!=null&&A.mos>=R_.mos;
    A.strong=buy&&q>=R_.strongQuality&&A.mos>=R_.strongMos&&!A.flags.length&&(A.cls==="improving"||A.cls==="stable")&&A.scores.growth>=R_.strongGrowth&&!fin&&qs.length>=R_.strongQuarters;
    const rich=A.fv&&co.price>A.fv.bull*(1+R_.overBull/100);
    A.newInv=A.strong?"STRONG BUY":buy?"BUY":q>=R_.watchQuality?"WATCHLIST":"AVOID";
    A.holder=q<R_.sellQuality||rich?"SELL":buy?"ADD":"HOLD";
    A.headline=co.held?(A.holder==="ADD"?A.newInv:A.holder):A.newInv;
    const px=A.fv?A.fv.base*(1-R_.mos/100):null,c=[];
    if(buy)c.push("Drops to WATCHLIST if price rises above ₹"+px.toFixed(0)+" or quality falls below "+R_.buyQuality);
    else if(!A.fv)c.push("BUY needs a fair-value range. "+(A.valNote||""));
    else if(q>=R_.buyQuality)c.push("Becomes BUY if price falls to ₹"+px.toFixed(0)+" or lower with quality still at "+R_.buyQuality+"+");
    else if(q>=R_.sellQuality)c.push("Becomes BUY only if quality reaches "+R_.buyQuality+" (now "+q.toFixed(0)+") and price offers a "+R_.mos+"% margin of safety");
    if(q>=R_.sellQuality&&!rich)c.push("Becomes SELL for holders if quality falls below "+R_.sellQuality+(A.fv?" or price exceeds ₹"+(A.fv.bull*(1+R_.overBull/100)).toFixed(0):""));
    else c.push("SELL lifts if quality recovers to "+R_.sellQuality+"+"+(A.fv?" and price is within "+R_.overBull+"% of bull fair value":""));
    A.change=c;
  }
  A.confidence=A.blocks.length?"Low":fin?"Low (simplified model)":qs.length>=8&&A.pillars===4?"High":"Medium";
  return A;
}
function snap(A){return{period:A.latest?A.latest.period:null,signal:A.headline,quality:A.quality==null?null:Math.round(A.quality),
  scores:Object.fromEntries(Object.entries(A.scores).map(([k,v])=>[k,v==null?null:Math.round(v)])),fvBase:A.fv?Math.round(A.fv.base):null,cls:A.cls||null,flags:A.flags.slice()}}
/* What the latest result changed: compare the analysis with and without the newest quarter, at the same price. */
function resultImpact(co,now){
  const A=analyse(co,now);if(co.quarters.length<RULES.minQuarters+1)return{A,changes:[]};
  const qs=[...co.quarters].sort((a,b)=>a.idx-b.idx),B=analyse({...co,quarters:qs.slice(0,-1)},qEnd(qs[qs.length-1].idx));
  const a=snap(B),b=snap(A),o=[];
  if(a.signal!==b.signal)o.push("Signal moved from "+a.signal+" to "+b.signal);
  if(a.quality!=null&&b.quality!=null&&a.quality!==b.quality)o.push("Quality score "+a.quality+" → "+b.quality);
  for(const k in LABEL)if(a.scores[k]!=null&&b.scores[k]!=null&&Math.abs(a.scores[k]-b.scores[k])>=5)o.push(LABEL[k]+" "+a.scores[k]+" → "+b.scores[k]);
  if(a.cls!==b.cls&&b.cls)o.push("Quarter verdict: "+(a.cls||"none")+" → "+b.cls);
  if(a.fvBase!==b.fvBase&&b.fvBase&&a.fvBase)o.push("Base fair value ₹"+a.fvBase+" → ₹"+b.fvBase);
  b.flags.filter(f=>!a.flags.includes(f)).forEach(f=>o.push("New red flag: "+f));
  return{A,changes:o,prev:a};
}
const api={RULES,LABEL,colIdx,pidx,plabel,qEnd,analyse,snap,resultImpact};
if(typeof module!=="undefined"&&module.exports)module.exports=api;else root.Engine=api;
})(typeof globalThis!=="undefined"?globalThis:this);
