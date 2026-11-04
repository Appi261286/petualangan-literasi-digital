/* Synchronized Battle engine for Petualangan Literasi Digital.
   The host publishes one shared question set; every participant advances independently. */
(function(){
 'use strict';
 let activeCode=null,liveRef=null,lastRoom=null,lastLive=null,renderTimer=null;
 const $=id=>document.getElementById(id);
 const escapeText=v=>String(v==null?'':v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const shuffle=a=>{const x=a.slice();for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]];}return x;};
 const levelRank=v=>({'Mudah':1,'Sedang':2,'Menantang':3,'Sulit':3,'Sangat Sulit':4}[v]||1);
 function questionPool(room){
  let source=(typeof gameQuestionBanks!=='undefined'&&gameQuestionBanks[room.game])||[];
  if(!Array.isArray(source)||!source.length){
   source=(typeof contentBank!=='undefined'&&contentBank.questions)||[];
  }
  const raw=source.filter(q=>q&&typeof q.q==='string'&&Array.isArray(q.a)&&q.a.length>0);
  const answerPool=[...new Set(raw.flatMap(q=>q.a.map(v=>String(v))).filter(Boolean))];
  let valid=raw.map(q=>{
   if(q.a.length>=2&&Number.isInteger(Number(q.c))&&Number(q.c)>=0&&Number(q.c)<q.a.length)return q;
   const answer=String(q.a[0]),distractors=shuffle(answerPool.filter(v=>v!==answer)).slice(0,3);
   if(!distractors.length)return null;
   const choices=shuffle([answer,...distractors.slice(0,2)]);
   return {...q,a:choices,c:choices.indexOf(answer)};
  }).filter(Boolean);
  if(!valid.length&&typeof contentBank!=='undefined'){
   const fallback=(contentBank.questions||[]).filter(q=>q&&typeof q.q==='string'&&Array.isArray(q.a)&&q.a.length>=2&&Number.isInteger(Number(q.c)));
   valid=fallback;
  }
  const requested=levelRank(room.level);
  if(room.mode==='team'){
   let harder=valid.filter(q=>levelRank(q.level)>=Math.max(2,requested));
   if(harder.length<6)harder=harder.concat(valid.filter(q=>levelRank(q.level)<Math.max(2,requested)));
   valid=harder;
  }else{
   const exact=valid.filter(q=>levelRank(q.level)===requested);
   if(exact.length>=3)valid=exact;
  }
  return shuffle(valid).slice(0,Math.min(room.mode==='team'?12:10,valid.length)).map((q,i)=>({
   id:'q'+i,q:q.q,a:q.a.slice(),c:Number(q.c),why:q.why||'',level:q.level||room.level
  }));
 }
 function ensurePanel(){
  const host=$('lobby-current-room');if(!host)return null;
  let panel=$('battle-live-panel');
  if(!panel){panel=document.createElement('section');panel.id='battle-live-panel';panel.className='notice';panel.style.marginTop='14px';host.appendChild(panel);}
  return panel;
 }
 function status(message){const el=$('lobby-status');if(el)el.textContent=message;}
 async function publishMatch(room){
  if(!onlineDb||!onlineUid||onlineUid!==room.hostUid)return;
  const ref=onlineDb.ref('battleLobbyRooms/'+room.code+'/live');
  const questions=questionPool(room);
  if(!questions.length){status('Bank soal untuk permainan ini belum memiliki soal pilihan ganda yang dapat dipakai dalam Battle.');return;}
  const now=Date.now(),durationMs=room.mode==='team'?(Number(room.durationMinutes)||15)*60000:0;
  const payload={version:1,status:'playing',game:room.game,mode:room.mode,level:room.level,questions,startedAt:Number(room.startedAt)||now,durationMs,deadlineAt:durationMs?(Number(room.startedAt)||now)+durationMs:null,progress:{}};
  await ref.transaction(current=>current||payload);
 }
 async function ensureProgress(room,live){
  if(!onlineUid||!live||!Array.isArray(live.questions))return;
  const participant=(room.participants||{})[onlineUid];if(!participant)return;
  const ref=onlineDb.ref('battleLobbyRooms/'+room.code+'/live/progress/'+onlineUid);
  await ref.transaction(current=>current||{name:participant.name||'Siswa',team:participant.team||null,qIndex:0,score:0,correct:0,wrong:0,completed:false,startedAt:Date.now(),finishedAt:null,answers:{}});
 }
 function listenRoom(room){
  if(activeCode===room.code&&liveRef)return;
  if(liveRef)liveRef.off();
  activeCode=room.code;lastRoom=room;lastLive=null;
  liveRef=onlineDb.ref('battleLobbyRooms/'+room.code+'/live');
  liveRef.on('value',async snap=>{
   lastLive=snap.val();
   if(!lastLive&&onlineUid===room.hostUid){
    try{await publishMatch(room);}catch(e){status('Gagal menyiapkan soal: '+(e.message||e));}
   }else if(lastLive){
    try{await ensureProgress(room,lastLive);}catch(e){status('Gagal menyiapkan peserta: '+(e.message||e));}
    draw(room,lastLive);
    maybeFinish(room,lastLive);
   }else drawWaiting(room);
  });
 }
 function drawWaiting(room){
  const panel=ensurePanel();if(panel)panel.innerHTML='<h3>Menyiapkan pertandingan…</h3><p>Guru sedang menyiapkan soal bersama. Sebentar lagi permainan dimulai.</p>';
 }
 function elapsed(progress,live,now){
  const end=progress.finishedAt||((live.deadlineAt&&now>=live.deadlineAt)?live.deadlineAt:now);
  return Math.max(0,Math.floor((end-(progress.startedAt||live.startedAt))/1000));
 }
 function draw(room,live){
  const panel=ensurePanel();if(!panel||!live)return;
  const participants=room.participants||{},progress=live.progress||{},mine=progress[onlineUid];
  const total=live.questions.length,now=Date.now(),remaining=live.deadlineAt?Math.max(0,Math.ceil((live.deadlineAt-now)/1000)):null;
  const timer=remaining===null?'Tanpa batas waktu':Math.floor(remaining/60)+' menit '+String(remaining%60).padStart(2,'0')+' detik';
  if(live.status==='completed'||(mine&&mine.completed)){
   panel.innerHTML='<h3>🏁 '+(live.status==='completed'?'Pertandingan selesai':'Kamu sudah menyelesaikan soal')+'</h3><p>'+escapeText(mine?('Skor kamu: '+mine.score+' · Benar: '+mine.correct+'/'+total):'Hasil pertandingan tersedia di bawah.')+'</p>'+scoreboard(room,live);
   return;
  }
  if(!mine){panel.innerHTML='<h3>Menyiapkan peserta…</h3>';return;}
  if(remaining!==null&&remaining<=0){panel.innerHTML='<h3>⏰ Waktu Battle Tim habis</h3><p>Jawaban yang sudah tersimpan tetap dihitung.</p>';return;}
  const q=live.questions[Math.min(mine.qIndex,total-1)];
  if(!q){panel.innerHTML='<h3>Semua soal selesai</h3>'+scoreboard(room,live);return;}
  const options=q.a.map((a,i)=>'<button class="btn '+(i===0?'':'secondary')+'" style="display:block;width:100%;text-align:left;margin:8px 0" onclick="battleLiveAnswer('+i+')">'+String.fromCharCode(65+i)+'. '+escapeText(a)+'</button>').join('');
  panel.innerHTML='<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><b>🎮 '+escapeText(room.game)+' · '+escapeText(room.mode==='team'?'Battle Tim':'Battle Individu')+'</b><b>'+escapeText(timer)+'</b></div><p>Kesulitan: '+escapeText(room.level)+(room.mode==='team'?' · Batas '+(Number(room.durationMinutes)||15)+' menit':'')+'</p><p><b>Soal '+(mine.qIndex+1)+' dari '+total+'</b> · Skor '+Number(mine.score||0)+'</p><h3>'+escapeText(q.q)+'</h3>'+options+'<p class="muted">Kamu menjawab secara mandiri. Tidak perlu menunggu peserta lain.</p>';
 }
 function scoreboard(room,live){
  const all=live.progress||{},rows=Object.entries(all).map(([uid,p])=>({uid,p,elapsed:elapsed(p,live,Date.now())}));
  if(room.mode==='team'){
   const groups={};
   rows.forEach(r=>{const key=r.p.team||'Tim belum ditentukan';groups[key]=groups[key]||{name:key,score:1000,finished:0,time:0,finishTimeTotal:0,members:[]};groups[key].score+=Number(r.p.score)||0;if(r.p.completed){groups[key].finished++;groups[key].finishTimeTotal+=r.elapsed;}groups[key].time+=r.elapsed;groups[key].members.push((r.p.name||'Siswa')+(r.p.completed?' ✓':' (belum selesai)'));});
   const ranked=Object.values(groups).sort((a,b)=>b.score-a.score||b.finished-a.finished||(a.finished?a.finishTimeTotal/a.finished:Infinity)-(b.finished?b.finishTimeTotal/b.finished:Infinity));
   return '<h3>🏆 Rekap Battle Tim</h3><table style="width:100%"><tr><th>Tim</th><th>Skor total</th><th>Selesai</th><th>Waktu</th></tr>'+ranked.map(t=>'<tr><td><b>'+escapeText(t.name)+'</b><br><small>'+escapeText(t.members.join(', '))+'</small></td><td>'+t.score+'</td><td>'+t.finished+'/'+t.members.length+'</td><td>'+(t.finished?Math.round(t.finishTimeTotal/t.finished)+' dtk rata-rata':'-')+'</td></tr>').join('')+'</table><p class="muted">Setiap tim mendapat skor awal 1.000. Jawaban benar +100 poin dan jawaban salah -25 poin. Urutan: skor total, jumlah anggota selesai, lalu rata-rata waktu anggota yang menyelesaikan permainan.</p>';
  }
  rows.sort((a,b)=>(Number(b.p.score)||0)-(Number(a.p.score)||0)||a.elapsed-b.elapsed);
  return '<h3>🏆 Papan Peringkat Individu</h3><table style="width:100%"><tr><th>Rank</th><th>Nama</th><th>Skor</th><th>Waktu</th><th>Status</th></tr>'+rows.map((r,i)=>'<tr><td>'+(i+1)+'</td><td>'+escapeText(r.p.name||'Siswa')+'</td><td>'+Number(r.p.score||0)+'</td><td>'+r.elapsed+' dtk</td><td>'+(r.p.completed?'Selesai':'Mengerjakan')+'</td></tr>').join('')+'</table>';
 }
 async function maybeFinish(room,live){
  if(!onlineUid||!live||live.status!=='playing')return;
  const people=Object.keys(room.participants||{}),progress=live.progress||{};
  const everyone=people.length>0&&people.every(uid=>progress[uid]&&progress[uid].completed);
  const expired=!!live.deadlineAt&&Date.now()>=live.deadlineAt;
  if(everyone||expired){
   await onlineDb.ref('battleLobbyRooms/'+room.code+'/live').transaction(cur=>{
    if(!cur||cur.status!=='playing')return;
    cur.status='completed';cur.finishedAt=Date.now();cur.finishReason=expired?'time_limit':'all_completed';return cur;
   });
   await onlineDb.ref('battleLobbyRooms/'+room.code).update({status:'completed',completedAt:Date.now()});
  }
 }
 window.battleLiveAnswer=async function(choice){
  const room=lastRoom,live=lastLive;if(!room||!live||live.status!=='playing'||!onlineUid)return;
  const ref=onlineDb.ref('battleLobbyRooms/'+room.code+'/live/progress/'+onlineUid);
  try{
   await ref.transaction(p=>{
    if(!p||p.completed||p.qIndex>=live.questions.length)return;
    const index=Number(p.qIndex),q=live.questions[index];
    if(!q||p.answers&&p.answers[index])return;
    const correct=Number(choice)===Number(q.c);
    p.answers=p.answers||{};p.answers[index]={choice:Number(choice),correct,answeredAt:Date.now()};
    if(correct){p.score=(Number(p.score)||0)+100;p.correct=(Number(p.correct)||0)+1;}else{p.score=(Number(p.score)||0)-25;p.wrong=(Number(p.wrong)||0)+1;}
    p.qIndex=index+1;
    if(p.qIndex>=live.questions.length){p.completed=true;p.finishedAt=Date.now();}
    return p;
   });
  }catch(e){status('Jawaban gagal disimpan: '+(e.message||e));}
 };
 function startTicker(){
  if(renderTimer)clearInterval(renderTimer);
  renderTimer=setInterval(()=>{
   if(!lastRoom||!lastLive)return;
   draw(lastRoom,lastLive);
   if(lastLive.deadlineAt&&Date.now()>=lastLive.deadlineAt)maybeFinish(lastRoom,lastLive);
  },1000);
 }
 const original=window.renderBattleLobbyRoom;
 if(typeof original==='function'){
  window.renderBattleLobbyRoom=function(room){
   original(room);
   if(room&&room.status==='playing'){listenRoom(room);startTicker();}
   else if(room&&room.status==='completed'&&lastLive){
    if(lastLive.status==='playing'&&onlineUid===room.hostUid&&onlineDb){
     onlineDb.ref('battleLobbyRooms/'+room.code+'/live').transaction(cur=>{
      if(!cur||cur.status!=='playing')return;cur.status='completed';cur.finishedAt=Date.now();cur.finishReason='host_ended';return cur;
     });
    }
    draw(room,lastLive);
   }
  };
 }
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&lastRoom&&lastLive)draw(lastRoom,lastLive);});
})();