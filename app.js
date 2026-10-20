const { createClient } = window.supabase || {};
const cfg = window.SOCCER_CONFIG || {};
const configured = cfg.SUPABASE_URL?.startsWith('https://') && !cfg.SUPABASE_URL.includes('YOUR_PROJECT') && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes('YOUR_');
const db = configured && createClient ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {auth:{persistSession:true,autoRefreshToken:true}}) : null;
const $ = id => document.getElementById(id);
const zone = 'America/Chicago';
let settings = {price_cents:1000,currency:'usd',zelle_recipient:'Not configured',venue:'Location to be announced',game_time:'Weekly pickup soccer',stripe_enabled:false};
let session=null, myEntry=null, admin=false, busy=false;
let cycleId=null;
const formatter = new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function chicagoParts(date=new Date()){const p=Object.fromEntries(formatter.formatToParts(date).map(x=>[x.type,x.value]));return {year:+p.year,month:+p.month,day:+p.day,weekday:p.weekday,hour:+p.hour,minute:+p.minute,second:+p.second};}
function pad(n){return String(n).padStart(2,'0')}
function isoDateUTC(y,m,d){return new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10)}
function week(){const p=chicagoParts();const d=new Date(Date.UTC(p.year,p.month-1,p.day));const day=d.getUTCDay();d.setUTCDate(d.getUTCDate()-(day+6)%7);return d.toISOString().slice(0,10)}
function openNow(){const p=chicagoParts();return p.weekday !== 'Mon' || p.hour >= 21 ? true : false;}
// Tuesday-Sunday registration is open for the current Monday's session; next Monday resets and locks until 9 PM.
function openingText(){const p=chicagoParts();const d=new Date(Date.UTC(p.year,p.month-1,p.day));const wd=d.getUTCDay();let delta=(8-wd)%7;if(wd===1&&p.hour<21)delta=0;else if(wd===1)delta=7;d.setUTCDate(d.getUTCDate()+delta);return d.toISOString().slice(0,10)}
function timeUntilOpening(){const p=chicagoParts();const target=openingText();const date=new Date(target+'T00:00:00Z');const today=new Date(Date.UTC(p.year,p.month-1,p.day));let seconds=Math.round((date-today)/1000)+21*3600-(p.hour*3600+p.minute*60+p.second);if(seconds<0)seconds=0;return `${pad(Math.floor(seconds/3600))} : ${pad(Math.floor((seconds%3600)/60))} : ${pad(seconds%60)}`}
function money(cents=settings.price_cents){return new Intl.NumberFormat('en-US',{style:'currency',currency:settings.currency.toUpperCase()}).format(cents/100)}
function prettyDate(s){return new Date(s+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',month:'long',day:'numeric',year:'numeric'}).toUpperCase()}
function toast(message,error=false){$('toast').textContent=message;$('toast').className='toast show'+(error?' error':'');clearTimeout(window.__toast);window.__toast=setTimeout(()=>$('toast').className='toast',4200)}
function setStatus(){const opened=openNow();$('status-chip').textContent=opened?'● SIGNUPS OPEN':'● CLOSED';$('countdown-title').textContent=opened?'REGISTRATION STATUS':'OPENING IN';$('countdown').textContent=opened?'OPEN NOW':timeUntilOpening();$('opening-label').textContent=opened?'OPEN NOW · MONDAY 9:00 PM CT':'MONDAY · 9:00 PM CT';$('week-label').textContent=prettyDate(week());$('join-button').disabled=!configured||!opened||!!myEntry||busy;$('join-button').innerHTML=!configured?'CONNECT SUPABASE FIRST <span>↗</span>':!opened?'REGISTRATION OPENS MONDAY 9PM <span>↗</span>':myEntry?'YOU ARE SIGNED UP ✓':'JOIN THE SQUAD <span>↗</span>';}
function el(tag,className,textContent){const x=document.createElement(tag);if(className)x.className=className;if(textContent!=null)x.textContent=textContent;return x}
function playerRow(item,i,placeholder=false){const r=el('div','player'+(placeholder?' empty-slot':''));r.appendChild(el('span','num',pad(i+1)));r.appendChild(el('span','pname',placeholder?'AVAILABLE SPOT':item.player_name));if(!placeholder)r.appendChild(el('span','tag'+(item.paid||item.is_permanent?' paid':''),item.is_permanent?'★ RESERVED':item.paid?'✓ PAID':'◌ PENDING'));return r}
async function refresh(){if(!db)return;try{const boot=await db.rpc('bootstrap_current_cycle');if(boot.error)throw boot.error;cycleId=boot.data;const [r,m]=await Promise.all([db.rpc('get_current_roster'),session?db.rpc('my_current_signup'):Promise.resolve({data:[]})]);if(r.error)throw r.error;if(m.error)throw m.error;myEntry=m.data?.[0]||null;const roster=(r.data||[]).filter(x=>x.status==='roster');const wait=(r.data||[]).filter(x=>x.status==='waitlist');$('roster-count').textContent=roster.length;$('wait-count').textContent=wait.length;$('progress-bar').style.width=(100*roster.length/12)+'%';const rb=$('roster-box');rb.replaceChildren();roster.forEach((p,i)=>rb.appendChild(playerRow(p,i)));for(let i=roster.length;i<12;i++)rb.appendChild(playerRow(null,i,true));const wb=$('wait-box');wb.replaceChildren();if(!wait.length)wb.appendChild(el('div','empty-note','No players waiting yet.'));else wait.forEach((p,i)=>wb.appendChild(playerRow(p,i)));
$('personal-status').hidden=!myEntry;$('payment-panel').hidden=!myEntry||myEntry.paid;if(myEntry){$('personal-status').textContent=myEntry.paid?`✓ PAYMENT CONFIRMED — ${myEntry.status==='roster'?'YOUR SPOT IS LOCKED':'YOU ARE ON THE PAID WAITLIST; ALL 12 ROSTER SPOTS ARE PAID.'}`:`◌ ${myEntry.status==='roster'?'PROVISIONAL SQUAD SPOT':'WAITLIST'} — SEND PAYMENT TO LOCK IN YOUR POSITION.`;}
setStatus();}catch(err){console.error(err);toast(err.message||'Could not load the roster',true)}}
async function join(e){e.preventDefault();if(!db)return toast('Configure Supabase first',true);if(!openNow())return toast('Registration has not opened yet',true);if(busy)return;busy=true;setStatus();try{let {data:{session:s}}=await db.auth.getSession();if(!s){const result=await db.auth.signInAnonymously();if(result.error)throw result.error;s=result.data.session;}session=s;const {error}=await db.rpc('join_current',{p_name:$('name').value.trim()});if(error)throw error;toast('Name added! Pay to secure your spot.');await refresh();}catch(err){toast(err.message||'Could not register',true)}finally{busy=false;setStatus()}}
async function checkout(){if(!myEntry)return;try{const {data:{session:s}}=await db.auth.getSession();if(!s)throw Error('Please refresh and try again');$('apple-button').disabled=true;const resp=await fetch(`${cfg.SUPABASE_URL}/functions/v1/create-checkout`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${s.access_token}`,'apikey':cfg.SUPABASE_ANON_KEY},body:JSON.stringify({signup_id:myEntry.id})});const data=await resp.json();if(!resp.ok)throw Error(data.error||'Checkout unavailable');location.assign(data.url);}catch(err){toast(err.message,true);$('apple-button').disabled=false}}
async function checkAdmin(){const {data,error}=await db.rpc('is_admin');admin=!error&&data===true;$('admin-controls').hidden=!admin;$('admin-login').hidden=admin;if(admin){await Promise.all([adminRefresh(),loadPermanentNames()]);}}
async function adminRefresh(){if(!admin)return;const {data,error}=await db.rpc('admin_current_signups');if(error)return toast(error.message,true);const list=$('admin-list');list.replaceChildren();for(const item of data){const row=el('div','admin-row');const left=el('div');left.appendChild(el('b','',item.player_name));left.appendChild(el('div','',`${item.status.toUpperCase()} · ${item.is_permanent?'PERMANENT':item.paid?'PAID':'UNPAID'}`));row.appendChild(left);if(!item.paid && !item.is_permanent){const b=el('button','confirm-button','CONFIRM ZELLE');b.addEventListener('click',async()=>{if(!confirm(`Have you verified actual Zelle receipt from ${item.player_name}?`))return;b.disabled=true;const {error}=await db.rpc('confirm_payment',{p_signup:item.id,p_method:'zelle'});if(error)toast(error.message,true);else toast('Payment confirmed; roster updated');await Promise.all([adminRefresh(),refresh()]);});row.appendChild(b)}list.appendChild(row)}if(!data.length)list.appendChild(el('p','muted','No registrations yet.'))}
async function init(){document.title=(cfg.SITE_NAME||'BILLIONAIRE BOYS')+' — Pickup Soccer';$('site-title').textContent=cfg.SITE_NAME||'BILLIONAIRE BOYS';$('year').textContent=new Date().getFullYear();$('opening-label').textContent='MONDAY · 9:00 PM CT';$('signup-form').addEventListener('submit',join);$('zelle-copier').addEventListener('click',()=>{navigator.clipboard.writeText(settings.zelle_recipient).then(()=>toast('Zelle recipient copied')).catch(()=>toast('Clipboard access unavailable',true))});$('apple-button').addEventListener('click',checkout);$('admin-toggle').addEventListener('click',async()=>{$('admin-modal').hidden=false;if(db){await checkAdmin()}});$('close-admin').addEventListener('click',()=>$('admin-modal').hidden=true);$('admin-modal').addEventListener('click',e=>{if(e.target===$('admin-modal'))$('admin-modal').hidden=true});$('admin-login').addEventListener('submit',async e=>{e.preventDefault();if(!db)return;const {error}=await db.auth.signInWithPassword({email:$('admin-email').value,password:$('admin-password').value});if(error)return toast(error.message,true);const {data:{session:s}}=await db.auth.getSession();session=s;await checkAdmin();await refresh();if(!admin)toast('This account does not have admin privileges',true)});$('admin-refresh').addEventListener('click',adminRefresh);$('permanent-form').addEventListener('submit',savePermanents);$('featured-form').addEventListener('submit',uploadFeatured);$('reset-roster').addEventListener('click',resetRoster);$('admin-logout').addEventListener('click',async()=>{await db.auth.signOut();session=null;admin=false;$('admin-controls').hidden=true;$('admin-login').hidden=false;await refresh()});setStatus();setInterval(()=>{setStatus();if(week()!==window.__week){window.__week=week();refresh();loadSettings()}},1000);if(!configured){$('roster-box').innerHTML='<div class="loading">Setup required: add Supabase URL and publishable key to config.js.</div>';return}try{const result=await db.auth.getSession();session=result.data.session;const {data,error}=await db.from('site_settings').select('*').eq('id',1).single();if(error)throw error;settings=data;$('price').textContent=money();$('zelle-price').textContent=money();$('zelle-recipient').textContent=settings.zelle_recipient;$('venue').textContent=settings.venue;$('game-time').textContent=settings.game_time;$('apple-option').hidden=!settings.stripe_enabled;renderFeatured();window.__week=week();await refresh();}catch(err){toast('Initialization failed: '+err.message,true)}}
init();setInterval(()=>{if(!document.hidden)refresh()},10000);

async function loadSettings(){
 if(!db)return;
 const {data,error}=await db.from('site_settings').select('*').eq('id',1).single();
 if(!error&&data){settings=data;renderFeatured();}
}
function renderFeatured(){
 const featured=$('featured-player');
 const name=(settings.player_of_week_name||'').trim();
 const url=settings.player_of_week_image||'';
 featured.hidden=!name&&!url;
 $('featured-name').textContent=name||'PLAYER OF THE WEEK';
 const photo=$('featured-image');
 if(url){photo.src=url+(url.includes('?')?'&':'?')+'v='+encodeURIComponent(settings.player_of_week_updated_at||'1');photo.hidden=false;}
 else{photo.hidden=true;photo.removeAttribute('src');}
}
async function loadPermanentNames(){
 const {data,error}=await db.rpc('admin_get_permanents');if(error)return toast(error.message,true);
 $('permanent-one').value=data?.find(p=>p.slot===1)?.player_name||'';
 $('permanent-two').value=data?.find(p=>p.slot===2)?.player_name||'';
 $('featured-player-name').value=settings.player_of_week_name||'';
}
async function savePermanents(e){
 e.preventDefault(); const {error}=await db.rpc('admin_set_permanents',{p_first:$('permanent-one').value.trim(),p_second:$('permanent-two').value.trim()});
 if(error)return toast(error.message,true);
 toast('Permanent names saved for the NEXT roster reset.');
}
async function resetRoster(){
 if(!confirm('Start a NEW empty roster now? All current signups will move to history. Your 2 permanent players will remain. This cannot be undone.'))return;
 const button=$('reset-roster');button.disabled=true;
 try{
  const {error}=await db.rpc('admin_reset_current');if(error)throw error;
  myEntry=null;await Promise.all([refresh(),adminRefresh()]);toast('New roster created with permanent players.');
 }catch(err){toast(err.message,true)}finally{button.disabled=false}
}
async function uploadFeatured(e){
 e.preventDefault();const name=$('featured-player-name').value.trim();const file=$('featured-file').files[0];
 if(!name)return toast('Enter the featured player name.',true);
 if(!file && !settings.player_of_week_image)return toast('Choose a player photo.',true);
 const button=$('save-featured');button.disabled=true;
 try{
  let url=settings.player_of_week_image||'';
  if(file){
   if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('Use JPEG, PNG or WebP under 5 MB.');
   const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type];
   const path=`featured/player-of-week-${crypto.randomUUID()}.${ext}`;
   const {error}=await db.storage.from('player-of-week').upload(path,file,{contentType:file.type,upsert:false});
   if(error)throw error;
   url=db.storage.from('player-of-week').getPublicUrl(path).data.publicUrl;
  }
  const {error}=await db.rpc('admin_set_player_of_week',{p_name:name,p_image:url});if(error)throw error;
  await loadSettings();$('featured-file').value='';toast('Player of the Week updated!');
 }catch(err){toast(err.message,true)}finally{button.disabled=false}
}
