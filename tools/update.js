#!/usr/bin/env node
/* Midcap Research Desk data updater. Node 18+, no dependencies. Needs engine.js beside it or one folder up.
   All modes work in <dir>, reading and writing data.json (fundamentals), prices.json and state.json (last signals).
   node update.js full <dir>      reload every Nifty Midcap 150 company from Screener, end-of-day prices from NSE
   node update.js research <dir>  evening run: reload companies near their expected result date (everything on Sundays), end-of-day prices
   node update.js filings <dir>   quick evening run: new results from NSE filings only, end-of-day prices
   node update.js recompute <dir> no network: rescore the files as they are (used by tools/e2e.js)
   node update.js prices <dir>    market-hours run: live prices only, from Yahoo Finance
   Prints a JSON summary on the last line: alerts, newResults, strongBuy, message. */
"use strict";
const fs=require("fs"),path=require("path");
let E;try{E=require("../engine.js")}catch(e){E=require("./engine.js")}
const N=require("./nse.js"),TG=require("./targets.js");
const UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const SCR="https://www.screener.in";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url,tries=4){
  for(let i=0;i<tries;i++){
    try{const r=await fetch(url,{headers:{"User-Agent":UA,"Accept":"*/*"},redirect:"follow"});
      if(r.status===404)return null;
      if(r.ok)return await r.text();
      if(r.status!==429&&r.status<500)return null}catch(e){}
    await sleep(2000*(i+1)*(i+1));
  }
  return null;
}
const strip=s=>s.replace(/<[^>]*>/g,"").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();
const num=s=>{s=String(s==null?"":s).replace(/[,%₹]/g,"").trim();if(s===""||s==="-")return null;const n=parseFloat(s);return isFinite(n)?n:null};
function table(html,id){
  const s=html.indexOf('<section id="'+id+'"');if(s<0)return null;const e=html.indexOf("</section>",s),sec=html.slice(s,e<0?undefined:e);
  const t=/<table[^>]*data-table[\s\S]*?<\/table>/.exec(sec);if(!t)return null;
  const heads=[...t[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(x=>strip(x[1])).filter(h=>/^[A-Z][a-z]{2} \d{4}$/.test(h));
  const rows={};for(const tr of t[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)){
    const c=[...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x=>strip(x[1]));if(c.length<2)continue;
    rows[c[0].replace(/\s*\+$/,"").trim()]=c.slice(1).map(num)}
  return heads.length?{heads,rows}:null;
}
const ratio=(html,name)=>{const m=new RegExp('<span class="name">\\s*'+name+'\\s*</span>[\\s\\S]*?<span class="number">([\\d,.]+)</span>').exec(html);return m?num(m[1]):null};
const iso=d=>d.toISOString().slice(0,10);

async function company(sym,meta){
  const enc=encodeURIComponent(sym);let cons=true,url=SCR+"/company/"+enc+"/consolidated/",html=await get(url),q=html&&table(html,"quarters");
  if(!q){cons=false;url=SCR+"/company/"+enc+"/";html=await get(url);q=html&&table(html,"quarters")}
  if(!q)return null;
  const cid=(/data-company-id="(\d+)"/.exec(html)||[])[1],bs=table(html,"balance-sheet")||{heads:[],rows:{}},R=q.rows;
  const fin=!!R["Financing Profit"];
  let cash={},medPE=null,dates=[];
  if(cid){
    if(!fin){const t=await get(SCR+"/api/company/"+cid+"/schedules/?parent=Other+Assets&section=balance-sheet&consolidated="+(cons?"true":""));
      try{cash=JSON.parse(t)["Cash Equivalents"]||{}}catch(e){}}
    const c=await get(SCR+"/api/company/"+cid+"/chart/?q=Price+to+Earning-Median+PE-EPS&days=1825&consolidated="+cons);
    try{for(const ds of JSON.parse(c).datasets){if(ds.metric==="Median PE"){const m=/=\s*([\d.]+)/.exec(ds.label||"");if(m)medPE=+m[1]}
      if(ds.metric==="EPS")dates=ds.values.map(v=>v[0])}}catch(e){}
  }
  const B={};bs.heads.forEach((h,i)=>{const ix=E.colIdx(h);if(ix==null)return;const g=k=>bs.rows[k]?bs.rows[k][i]:null,ec=g("Equity Capital"),rs=g("Reserves");
    B[ix]={equity:ec!=null&&rs!=null?ec+rs:null,debt:fin?null:g("Borrowings"),cash:fin?null:num(cash[h])}});
  const pick=(...k)=>{for(const x of k)if(R[x])return R[x];return[]};
  const rev=pick("Sales","Revenue"),op=pick("Operating Profit","Financing Profit"),pat=pick("Net Profit"),eps=pick("EPS in Rs"),int=pick("Interest"),gn=pick("Gross NPA %");
  const quarters=q.heads.map((h,i)=>{const ix=E.colIdx(h),b=B[ix]||{};return{period:E.plabel(ix),idx:ix,revenue:rev[i]??null,ebitda:op[i]??null,pat:pat[i]??null,eps:eps[i]??null,
    interest:int[i]??null,debt:b.debt??null,cash:b.cash??null,equity:b.equity??null,pledge:null,gnpa:gn[i]??null}}).filter(x=>x.idx!=null).slice(-13);
  const pl=/pledged\s+([\d.]+)\s*%/i.exec(html);
  const last=dates.length?dates[dates.length-1]:null;let next=null;
  if(last){const lo=new Date(last).getTime()+45*864e5;for(const d of dates){const t=new Date(d).getTime()+365*864e5;if(t>lo&&(next==null||t<next))next=t}}
  return{id:sym,name:meta.name||strip((/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)||[,sym])[1]),industry:meta.industry||"",sector:fin?"fin":"nonfin",basis:cons?"consolidated":"standalone",
    mcap:ratio(html,"Market Cap"),medPE,pledge:pl?+pl[1]:null,src:url,asof:iso(new Date()),resultDate:last,nextDate:next?iso(new Date(next)):null,quarters};
}
async function midcapList(){
  const t=await get("https://nsearchives.nseindia.com/content/indices/ind_niftymidcap150list.csv");if(!t)throw new Error("Could not load the Nifty Midcap 150 list from NSE");
  const L=t.trim().split(/\r?\n/).slice(1).map(l=>{const c=l.split(",");return{name:c[0].trim(),industry:c[1].trim(),id:c[2].trim()}}).filter(x=>x.id);
  return L.concat(extras().filter(x=>!L.some(y=>y.id===x.id)));
}
/* Companies the user added on top of the index (extra.json in the repository root). */
function extras(){try{return(JSON.parse(fs.readFileSync(path.join(__dirname,"..","extra.json"),"utf8")).companies||[]).filter(x=>x&&x.id).map(x=>({id:String(x.id).trim().toUpperCase(),name:x.name||x.id,industry:x.industry||"",extra:true}))}catch(e){return[]}}
async function prices(){
  for(let back=0;back<8;back++){const d=new Date(Date.now()+5.5*36e5-back*864e5),dd=String(d.getUTCDate()).padStart(2,"0"),mm=String(d.getUTCMonth()+1).padStart(2,"0"),yy=d.getUTCFullYear();
    const t=await get("https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_"+dd+mm+yy+".csv",1);
    if(t&&t.startsWith("SYMBOL")){const p={};for(const l of t.split(/\r?\n/).slice(1)){const c=l.split(",").map(s=>s.trim());if(c[1]==="EQ"||(c[1]==="BE"&&!(c[0] in p)))p[c[0]]=+c[8]}
      /* trust the trade date inside the file, not the file name: NSE can serve the last session's file under a holiday's name */
      const row=(t.split(/\r?\n/)[1]||"").split(",").map(s=>s.trim()),dm=/^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(row[2]||""),MN={Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12"};
      return{date:dm&&MN[dm[2]]?dm[3]+"-"+MN[dm[2]]+"-"+dm[1]:yy+"-"+mm+"-"+dd,p}}}
  return null;
}
/* Live prices. Yahoo first; if Yahoo refuses this machine (it blocks some cloud servers), Google Finance pages instead. */
async function livePrices(list,old){
  const p={},q=list.slice();let t=0,miss=[],yTried=0,yOk=0,gOk=0;
  async function yahoo(id){if(yTried>=10&&!yOk)return false;yTried++;
    const r=await get("https://query1.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(id)+".NS?interval=1d&range=1d",yOk?2:1);
    try{const m=JSON.parse(r).chart.result[0].meta;if(m.regularMarketPrice>0){p[id]=m.regularMarketPrice;t=Math.max(t,m.regularMarketTime||0);yOk++;return true}}catch(e){}
    return false}
  async function google(id){const r=await get("https://www.google.com/finance/quote/"+encodeURIComponent(id)+":NSE",2);if(!r)return false;
    const m=new RegExp('\\["'+id.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+'","NSE"\\],"[^"]*",\\d+,"INR",\\[([\\d.]+),[^\\]]*\\],[^\\[]*\\[(\\d{9,})\\]').exec(r);
    if(m&&+m[1]>0){p[id]=+m[1];t=Math.max(t,+m[2]);gOk++;return true}return false}
  async function w(){while(q.length){const x=q.shift();if(await yahoo(x.id)||await google(x.id))continue;
    miss.push(x.id);if(old&&old.p&&old.p[x.id])p[x.id]=old.p[x.id]}}
  await Promise.all([w(),w(),w(),w(),w()]);
  const d=t?new Date(t*1000+5.5*36e5):null;
  return{date:d?iso(d):(old&&old.date)||null,time:d?d.toISOString().slice(11,16)+" IST":null,src:(gOk>yOk?"Google Finance":"Yahoo Finance")+" (may be delayed)",p,miss};
}
const readJ=(f,d)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch(e){return d}};
(async()=>{
  const [mode,dir]=process.argv.slice(2);if(!["full","research","filings","prices","recompute"].includes(mode)||!dir){console.error("usage: update.js full|research|filings|prices|recompute <dir>");process.exit(2)}
  fs.mkdirSync(dir,{recursive:true});const F=n=>path.join(dir,n);
  let bundle=readJ(F("data.json"),null);const state=readJ(F("state.json"),{signals:{}}),oldPx=readJ(F("prices.json"),null);
  const now=new Date(Date.now()+5.5*36e5),today=iso(now),sunday=now.getUTCDay()===0;
  if(mode!=="full"&&!bundle){console.error("data.json is missing in "+dir+". Run full first.");process.exit(2)}
  const failed=[],newResults=[];let checked=[];
  const isFin=c=>c.sector==="fin"||c.industry==="Financial Services",maxIdx=c=>c&&c.quarters.length?Math.max(...c.quarters.map(q=>q.idx)):-1;
  const old={},oldMax={};(bundle?bundle.companies:[]).forEach(c=>{old[c.id]=c;oldMax[c.id]=maxIdx(c)});
  /* quarter that has most recently ended */
  const m=now.getUTCMonth(),y=now.getUTCFullYear(),ended=E.colIdx(["Dec","Mar","Jun","Sep"][Math.floor(m/3)]+" "+(m<3?y-1:y));
  if(mode==="full"||mode==="research"){
    const list=mode==="full"||sunday||!bundle?await midcapList():bundle.companies.map(c=>({id:c.id,name:c.name,industry:c.industry,extra:c.extra})).concat(extras().filter(x=>!bundle.companies.some(c=>c.id===x.id)));
    const due=c=>{if(!c)return true;const last=maxIdx(c);if(last>=ended)return false;
      if(!c.nextDate)return true;const d=(new Date(today)-new Date(c.nextDate))/864e5;return d>=-7};
    const want=mode==="full"||sunday?list:list.filter(x=>due(old[x.id]));checked=want.map(x=>x.id);
    const out=Object.assign({},old);let i=0;
    async function worker(){while(i<want.length){const x=want[i++];let co=null;try{co=await company(x.id,x)}catch(e){}
      if(!co||!co.quarters.length){failed.push(x.id);continue}
      if(x.extra)co.extra=true;out[x.id]=co;await sleep(350)}}
    await Promise.all([worker(),worker(),worker()]);
    const nx=list.filter(x=>x.extra&&out[x.id]).length;
    bundle={built:today,universe:"Nifty Midcap 150"+(nx?" + "+nx+" added":""),source:"Screener.in company pages, with new results read from NSE filings",failed,companies:list.map(x=>out[x.id]).filter(Boolean)};
  }
  /* NSE filings: read new results at the source, and check Screener's figures against them */
  const nse={ok:false,read:0,failed:[],added:[],held:[],differs:[]};
  const offline=mode==="recompute";   /* no network: files as they are, plus cached filings. Used by tools/e2e.js */
  if(mode!=="prices"){
    const cache=readJ(F("filings.json"),{});cache._failed=cache._failed||{};
    const nonfin=bundle.companies.filter(c=>!isFin(c)),want=new Map(nonfin.map(c=>[c.id,c.basis]));
    if(!offline)try{
      const rows=await N.recent(1500)||[];nse.ok=rows.length>0;
      if(mode==="full"||sunday||Object.keys(cache).length<2){
        const q=nonfin.filter(c=>!(cache[c.id]&&cache[c.id][ended])).map(c=>c.id);
        async function w(){while(q.length){const r=await N.forSymbol(q.shift());if(r){rows.push(...r);nse.ok=true}await sleep(250)}}
        await Promise.all([w(),w()]);
      }
      const picks=N.pick(rows,want).filter(f=>f.idx>=ended-1&&f.idx<=ended&&!cache._failed[f.seq]&&!(cache[f.symbol]&&cache[f.symbol][f.idx]&&cache[f.symbol][f.idx].seq>=f.seq));
      async function r(){while(picks.length){const f=picks.shift();
        try{const xml=await N.get(f.xbrl);if(!xml){nse.failed.push(f.symbol+" "+E.plabel(f.idx)+": file could not be downloaded");continue}
          const v=N.parse(xml,f);(cache[f.symbol]=cache[f.symbol]||{})[f.idx]={...f,...v};nse.read++}
        catch(e){cache._failed[f.seq]=f.symbol+" "+E.plabel(f.idx)+": "+e.message;nse.failed.push(cache._failed[f.seq])}
        await sleep(250)}}
      await Promise.all([r(),r(),r()]);
    }catch(e){nse.failed.push("NSE step stopped: "+e.message)}
    for(const s in cache)if(s!=="_failed")for(const i in cache[s])if(+i<ended-4)delete cache[s][i];
    for(const c of nonfin){const o=N.overlay(c,cache[c.id]);
      if(o.added)nse.added.push(c.id);if(o.held)nse.held.push(c.id+": "+o.held);
      const L=c.quarters.find(q=>q.idx===maxIdx(c));if(L&&L.check&&L.check.length)nse.differs.push(c.id+" "+L.period+": "+L.check.join("; "))}
    bundle.companies.forEach(c=>{if(old[c.id]&&maxIdx(c)>oldMax[c.id])newResults.push(c.id)});
    bundle.filingsChecked=new Date().toISOString();
    fs.writeFileSync(F("filings.json"),JSON.stringify(cache));
    fs.writeFileSync(F("data.json"),JSON.stringify(bundle));
  }
  let px;
  if(offline)px=oldPx;
  else if(mode==="prices")px=await livePrices(bundle.companies,oldPx);
  else{const b=await prices();px=b?{date:b.date,time:"close",src:"NSE end-of-day file",p:{}}:oldPx;if(b)bundle.companies.forEach(c=>{if(b.p[c.id]>0)px.p[c.id]=b.p[c.id]})}
  if(px)fs.writeFileSync(F("prices.json"),JSON.stringify(px));
  /* signals for everyone, compared with the last run */
  const sig={},alerts=[],strong=[],res=[],BUYS=new Set(["STRONG BUY","BUY"]);
  const T=readJ(F("targets.json"),{open:{},closed:[]}),tEvents=[],seeding=!fs.existsSync(F("targets.json"));
  for(const c of bundle.companies){const full={...c,price:px&&px.p[c.id],priceDate:px&&px.date},r=E.resultImpact(full),A=r.A,o=state.signals[c.id];
    sig[c.id]={n:A.newInv,h:A.holder};
    const ev=px&&px.date?TG.step(T,c,A,full.price,px.date):null;let tgt="";
    if(ev&&ev.type==="set"){const e=E.eta(c,A,full.price,ev.t.target);tgt="; target ₹"+ev.t.target+(e.text?", likely in "+e.text:"")}
    else if(ev)tEvents.push({type:ev.type,text:ev.text});
    if(A.strong)strong.push({id:c.id,name:c.name,price:full.price,quality:Math.round(A.quality),mos:Math.round(A.mos)});
    if(newResults.includes(c.id))res.push({id:c.id,name:c.name,quarter:A.latest.period,verdict:A.cls,signal:A.newInv,holder:A.holder,quality:A.quality==null?null:Math.round(A.quality),flags:A.flags,changes:r.changes,
      source:A.latest.src==="NSE"?"NSE filing":"Screener",filing:A.latest.filing||null});
    if(o){if(o.n!==A.newInv&&(BUYS.has(o.n)||BUYS.has(A.newInv)))alerts.push(c.name+" ("+c.id+"): "+o.n+" → "+A.newInv+" at ₹"+full.price+tgt);
      if(o.h!==A.holder&&(o.h==="SELL"||A.holder==="SELL"))alerts.push(c.name+" ("+c.id+") for holders: "+o.h+" → "+A.holder+" at ₹"+full.price)}}
  strong.sort((a,b)=>b.mos-a.mos);
  fs.writeFileSync(F("state.json"),JSON.stringify({updated:new Date().toISOString(),mode,signals:sig}));
  T.updated=px&&px.date||today;fs.writeFileSync(F("targets.json"),JSON.stringify(T));
  const parts=[];if(res.length)parts.push(res.length+" new result"+(res.length>1?"s":"")+": "+res.map(r=>r.id+" "+r.signal).join(", "));
  if(alerts.length)parts.push(alerts.map(a=>a.replace(/^.*?\(([^()]+)\)/,"$1").replace(/; target.*$/,"")).join("; "));
  const hit=tEvents.filter(e=>e.type==="reached");if(hit.length)parts.push(hit.length+" target"+(hit.length>1?"s":"")+" reached");
  console.log(JSON.stringify({mode,today,priceDate:px&&px.date,priceTime:px&&px.time,priceMisses:px&&px.miss||[],checked,failed,nse,newResults:res,alerts,targets:{events:tEvents,seeded:seeding,...TG.record(T)},strongBuy:strong.slice(0,10),
    message:parts.length?("Midcap desk: "+parts.join(" | ")).slice(0,195):""}));
})();
