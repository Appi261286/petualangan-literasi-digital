/* Synchronized Battle engine for Petualangan Literasi Digital.
   The host publishes one shared question set; every participant advances independently. */
(function(){
 'use strict';
 let activeCode=null,liveRef=null,lastRoom=null,lastLive=null,renderTimer=null,lastDrawKey=null,storyOrder=[],storyQuestionId=null;
 const $=id=>document.getElementById(id);
 const escapeText=v=>String(v==null?'':v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const shuffle=a=>{const x=a.slice();for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]];}return x;};
 const levelRank=v=>({'Mudah':1,'Sedang':2,'Menantang':3,'Sulit':3,'Sangat Sulit':4}[v]||1);
 function questionPool(room){
  const game=room.game;let source=[];
  if(game==='Susun Cerita')source=typeof storyQuestionBank!=='undefined'?storyQuestionBank:[];
  else if(typeof gameQuestionBanks!=='undefined'&&Array.isArray(gameQuestionBanks[game]))source=gameQuestionBanks[game];
  if(!Array.isArray(source)||!source.length)return [];
  const requested=levelRank(room.level),count=Math.max(1,Math.min(50,Number(room.questionCount)||5));
  const typed=source.map((q,i)=>{
   if(!q||typeof q.q!=='string')return null;
   if(game==='Susun Cerita'){
    if(!Array.isArray(q.events)||q.events.length<2)return null;
    return {id:'q'+i,type:'story-order',q:q.q,events:shuffle(q.events).map((e,j)=>({id:j,text:String(e[0]),order:Number(e[1])})),why:q.why||'',level:q.level||room.level,sourceId:q.sourceId||null};
   }
   if(game==='Tebak Kata'||game==='Puzzle Literasi'){
    const c=Number.isInteger(Number(q.c))?Number(q.c):0;if(!Array.isArray(q.a)||!q.a[c])return null;
    return {id:'q'+i,type:game==='Tebak Kata'?'text':'puzzle',q:q.q,answer:String(q.a[c]),why:q.why||'',level:q.level||room.level,sourceId:q.sourceId||null};
   }
   if(!Array.isArray(q.a)||q.a.length<2||!Number.isInteger(Number(q.c))||Number(q.c)<0||Number(q.c)>=q.a.length)return null;
   return {id:'q'+i,type:'choice',q:q.q,a:q.a.map(String),c:Number(q.c),why:q.why||'',level:q.level||room.level,sourceId:q.sourceId||null};
  }).filter(Boolean);
  const exact=typed.filter(q=>levelRank(q.level)===requested);let valid=exact.length>=Math.min(count,typed.length)?exact.slice():typed.slice();
  if(exact.length&&exact.length<Math.min(count,typed.length)){const extra=typed.filter(q=>levelRank(q.level)!==requested).sort((a,b)=>Math.abs(levelRank(a.level)-requested)-Math.abs(levelRank(b.level)-requested));valid=exact.concat(extra);}
  return shuffle(valid).slice(0,count);
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
  if(!questions.length){status('Bank soal untuk '+room.game+' belum memiliki soal yang sesuai untuk Battle pada tingkat '+room.level+'.');return;}
  const now=Date.now(),durationMs=(Number(room.durationMinutes)||15)*60000;
  const payload={version:1,status:'playing',game:room.game,mode:room.mode,level:room.level,questions,startedAt:Number(room.startedAt)||now,durationMs,deadlineAt:durationMs?(Number(room.startedAt)||now)+durationMs:null,progress:{}};
  await ref.transaction(current=>{
   if(current&&Array.isArray(current.questions)&&current.questions.length>0)return current;
   return payload;
  });
 }
 async function ensureProgress(room,live){
  if(!onlineUid||!live||!Array.isArray(live.questions))return false;
  const participant=(room.participants||{})[onlineUid];
  if(!participant){status('Identitas perangkat belum cocok dengan daftar peserta. Keluar dari ruang lalu gabung kembali menggunakan kode ruang.');return false;}
  const ref=onlineDb.ref('battleLobbyRooms/'+room.code+'/live/progress/'+onlineUid);
  const result=await ref.transaction(current=>current||{name:participant.name||'Siswa',team:participant.team||null,qIndex:0,score:0,correct:0,wrong:0,completed:false,startedAt:Date.now(),finishedAt:null,answers:{}});
  return !!(result.snapshot&&result.snapshot.exists());
 }
 function listenRoom(room){
  if(activeCode===room.code&&liveRef)return;
  if(liveRef)liveRef.off();
  activeCode=room.code;lastRoom=room;lastLive=null;lastDrawKey=null;storyOrder=[];storyQuestionId=null;
  liveRef=onlineDb.ref('battleLobbyRooms/'+room.code+'/live');
  liveRef.on('value',async snap=>{
   lastLive=snap.val();
   const currentRoom=lastRoom||room;
   const hasQuestions=!!(lastLive&&Array.isArray(lastLive.questions)&&lastLive.questions.length>0);
   if(!hasQuestions&&onlineUid===currentRoom.hostUid){
    drawWaiting(currentRoom);
    try{await publishMatch(currentRoom);}catch(e){status('Gagal menyiapkan soal: '+(e.message||e));}
   }else if(hasQuestions){
    try{await ensureProgress(currentRoom,lastLive);}catch(e){status('Gagal menyiapkan peserta: '+(e.message||e));}
    draw(currentRoom,lastLive);
    maybeFinish(currentRoom,lastLive);
   }else{
    drawWaiting(currentRoom);
    status('Menunggu pembuat ruang menyiapkan daftar soal…');
   }
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
  if(!Array.isArray(live.questions)||!live.questions.length){panel.innerHTML='<h3>⏳ Menyiapkan soal…</h3><p>Daftar soal belum diterima dari pembuat ruang.</p>';return;}
  const total=live.questions.length,now=Date.now(),remaining=live.deadlineAt?Math.max(0,Math.ceil((live.deadlineAt-now)/1000)):null;
  const timer=remaining===null?'Tanpa batas waktu':Math.floor(remaining/60)+' menit '+String(remaining%60).padStart(2,'0')+' detik';
  const drawKey=JSON.stringify({status:live.status,mine:mine||null,progress,total,game:room.game,mode:room.mode,level:room.level,deadlineAt:live.deadlineAt});
  if(drawKey===lastDrawKey)return;lastDrawKey=drawKey;
  if(live.status==='completed'){panel.innerHTML='<h3>🏁 Pertandingan selesai!</h3><p>'+escapeText(mine?('Skor kamu: '+mine.score+' · Benar: '+mine.correct+'/'+total):'Hasil pertandingan tersedia di bawah.')+'</p>'+scoreboard(room,live);return;}
  const anyCompleted=Object.values(progress).some(p=>p&&p.completed);
  if(mine&&mine.completed){const finished=Object.values(progress).filter(p=>p&&p.completed).length,totalPlayers=Object.keys(participants).length;panel.innerHTML='<h3>✅ Kamu sudah menyelesaikan semua soal!</h3><div class="notice">⏳ Jawabanmu sudah tersimpan. Papan skor sementara akan diperbarui saat peserta lain selesai.</div><p class="muted">Progres: '+finished+' dari '+totalPlayers+' peserta.</p>'+scoreboard(room,live);return;}
  if(!mine){panel.innerHTML='<h3>Menyiapkan peserta…</h3>';return;}
  if(remaining!==null&&remaining<=0){panel.innerHTML='<h3>⏰ Waktu Battle habis</h3><p>Jawaban yang sudah tersimpan tetap dihitung.</p>'+scoreboard(room,live);return;}
  const index=Math.max(0,Math.min(Number(mine.qIndex)||0,total));if(index>=total){panel.innerHTML='<h3>Semua soal selesai</h3>'+scoreboard(room,live);return;}
  const q=live.questions[index];if(!q){panel.innerHTML='<h3>Soal tidak tersedia</h3><p>Minta pembuat ruang memeriksa bank soal.</p>';return;}
  const readingSource=q.sourceId&&typeof gameReadingSources!=='undefined'?(gameReadingSources[room.game]||{})[q.sourceId]:null;
  const readingPanel=readingSource?'<details class="notice" open><summary><b>📖 Bacaan sumber: '+escapeText(readingSource.title)+'</b></summary><p style="white-space:pre-line">'+escapeText(readingSource.text)+'</p></details>':'';
  let intro='';
  if(room.game==='Detektif Bacaan'&&typeof contentBank!=='undefined'&&contentBank.caseFile)intro='<div class="notice"><b>🔎 '+escapeText(contentBank.caseFile.heading)+'</b><ul>'+(contentBank.caseFile.clues||[]).map(x=>'<li>'+escapeText(x)+'</li>').join('')+'</ul><small>Gunakan petunjuk bersama bacaan sebelum menjawab.</small></div>';
  else if(room.game==='Petualangan Literasi'&&typeof contentBank!=='undefined')intro='<div class="notice">🗺️ <b>Misi petualangan</b><p>'+escapeText(contentBank.mission||'Bacalah petunjuk dan pilih jawaban berdasarkan informasi.')+'</p></div>';
  else if(room.game==='Duel Kuis Literasi')intro='<div class="notice">⚔️ Duel cepat! Jawab dengan teliti sebelum waktu Battle habis.</div>';
  else if(room.game==='Battle Literasi')intro='<div class="notice">🏆 Arena poin! Jawaban benar menambah skor.</div>';
  else if(room.game==='Misi Penyelamatan Buku')intro='<div class="notice">📖 Misi penyelamatan! Pilih jawaban yang paling tepat.</div>';
  let interaction='';
  if(q.type==='story-order'){
   if(storyQuestionId!==q.id){storyQuestionId=q.id;storyOrder=(q.events||[]).map((e,i)=>i);}
   interaction='<p class="muted">Susun peristiwa dari awal hingga akhir menggunakan tombol panah.</p>'+storyOrder.map((eventIndex,pos)=>{const event=q.events[eventIndex];return '<div class="notice" style="display:flex;align-items:center;gap:8px"><b>'+(pos+1)+'.</b><span style="flex:1">'+escapeText(event.text)+'</span><button class="btn secondary" style="padding:6px 10px" onclick="battleStoryMove('+pos+',-1)" '+(pos===0?'disabled':'')+'>↑</button><button class="btn secondary" style="padding:6px 10px" onclick="battleStoryMove('+pos+',1)" '+(pos===storyOrder.length-1?'disabled':'')+'>↓</button></div>';}).join('')+'<button class="btn" onclick="battleStorySubmit()">Periksa urutan</button>';
  }else if(q.type==='text'||q.type==='puzzle'){
   let letters='';if(q.type==='puzzle')letters='<div class="notice" style="font-size:21px;text-align:center;letter-spacing:2px">'+escapeText(shuffle(String(q.answer||'').split('')).join(' · '))+'</div>';
   interaction='<div class="question">'+escapeText(q.q)+'</div>'+letters+'<label for="battle-text-answer">'+(q.type==='puzzle'?'Susun jawaban dari huruf di atas':'Ketik jawaban yang tepat')+'</label><input id="battle-text-answer" class="field" autocomplete="off" placeholder="Tulis jawabanmu..."><button class="btn" onclick="battleTextSubmit()">Kirim jawaban</button>';
  }else interaction='<div class="question">'+escapeText(q.q)+'</div>'+(q.a||[]).map((a,i)=>'<button class="btn '+(i===0?'':'secondary')+'" style="display:block;width:100%;text-align:left;margin:8px 0" onclick="battleLiveAnswer('+i+')">'+String.fromCharCode(65+i)+'. '+escapeText(a)+'</button>').join('');
  panel.innerHTML='<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><b>🎮 '+escapeText(room.game)+' · '+escapeText(room.mode==='team'?'Battle Tim':'Battle Individu')+'</b><b id="battle-live-timer">'+escapeText(timer)+'</b></div><p>Kesulitan: '+escapeText(room.level)+'</p><p><b>Soal '+(index+1)+' dari '+total+'</b> · Skor '+Number(mine.score||0)+'</p>'+readingPanel+intro+interaction+'<p class="muted">Jawabanmu tersimpan secara otomatis setelah dikirim.</p>'+(anyCompleted?'<div class="notice">🏆 Papan skor sementara telah dibuka.</div>'+scoreboard(room,live):'');
 }
 function scoreboard(room,live){
  const all=live.progress||{},rows=Object.entries(all).map(([uid,p])=>({uid,p,elapsed:elapsed(p,live,Date.now())}));
  if(room.mode==='team'){
   const groups={};
   rows.forEach(r=>{const key=r.p.team||'Tim belum ditentukan';groups[key]=groups[key]||{name:key,score:1000,correct:0,finished:0,time:0,members:[]};groups[key].score+=Number(r.p.score)||0;groups[key].correct+=Number(r.p.correct)||0;if(r.p.completed)groups[key].finished++;groups[key].time+=r.elapsed;groups[key].members.push((r.p.name||'Siswa')+(r.p.completed?' ✓':' (belum selesai)'));});
   const ranked=Object.values(groups).sort((a,b)=>b.score-a.score||b.correct-a.correct||a.time-b.time);
   return '<h3>🏆 Rekap Battle Tim</h3><table style="width:100%"><tr><th>Tim</th><th>Skor total</th><th>Jawaban benar</th><th>Anggota</th></tr>'+ranked.map(t=>'<tr><td><b>'+escapeText(t.name)+'</b><br><small>'+escapeText(t.members.join(', '))+'</small></td><td>'+t.score+'</td><td>'+t.correct+'</td><td>'+t.finished+'/'+t.members.length+' selesai</td></tr>').join('')+'</table><p class="muted">Setiap tim memperoleh 1.000 poin awal. Jawaban benar +100, jawaban salah −25, dan soal yang tidak dijawab 0. Peringkat ditentukan oleh skor, jumlah jawaban benar, lalu waktu.</p>';
  }
  rows.sort((a,b)=>(Number(b.p.score)||0)-(Number(a.p.score)||0)||(Number(b.p.correct)||0)-(Number(a.p.correct)||0)||a.elapsed-b.elapsed);
  return '<h3>🏆 Papan Peringkat Individu</h3><table style="width:100%"><tr><th>Rank</th><th>Nama</th><th>Skor</th><th>Waktu</th><th>Status</th></tr>'+rows.map((r,i)=>'<tr><td>'+(i+1)+'</td><td>'+escapeText(r.p.name||'Siswa')+'</td><td>'+Number(r.p.score||0)+'</td><td>'+r.elapsed+' dtk</td><td>'+(r.p.completed?'Selesai':'Mengerjakan')+'</td></tr>').join('')+'</table>';
 }
 async function maybeFinish(room,live){
  // Hanya pembuat ruang yang boleh memutuskan pertandingan selesai.
  // Baca ulang daftar peserta dan progres terbaru agar data yang stale
  // pada perangkat lain tidak mengakhiri pertandingan terlalu cepat.
  if(!onlineUid||!room||onlineUid!==room.hostUid||!live||live.status!=='playing')return;
  try{
   const roomRef=onlineDb.ref('battleLobbyRooms/'+room.code);
   const freshSnap=await roomRef.once('value');
   if(!freshSnap.exists())return;
   const freshRoom=freshSnap.val();
   if(freshRoom.status!=='playing')return;
   const liveRefFresh=roomRef.child('live');
   const liveSnap=await liveRefFresh.once('value');
   const freshLive=liveSnap.val();
   if(!freshLive||freshLive.status!=='playing')return;
   const people=Object.keys(freshRoom.participants||{}),progress=freshLive.progress||{};
   const everyone=people.length>0&&people.every(uid=>progress[uid]&&progress[uid].completed);
   const expired=!!freshLive.deadlineAt&&Date.now()>=freshLive.deadlineAt;
   if(!everyone&&!expired)return;
   await liveRefFresh.transaction(cur=>{
    if(!cur||cur.status!=='playing')return;
    const currentProgress=cur.progress||{};
    const allDone=people.length>0&&people.every(uid=>currentProgress[uid]&&currentProgress[uid].completed);
    const timeUp=!!cur.deadlineAt&&Date.now()>=cur.deadlineAt;
    if(!allDone&&!timeUp)return;
    cur.status='completed';cur.finishedAt=Date.now();cur.finishReason=timeUp?'time_limit':'all_completed';return cur;
   });
   const finalSnap=await liveRefFresh.once('value');
   if(finalSnap.val()&&finalSnap.val().status==='completed')
    await roomRef.update({status:'completed',completedAt:Date.now()});
  }catch(e){status('Gagal memeriksa akhir pertandingan: '+(e.message||e));}
 }
 async function submitBattleAnswer(value){
  const room=lastRoom;if(!room||!onlineUid||!onlineDb){status('Koneksi Battle belum siap. Muat ulang halaman lalu masuk kembali.');return;}
  const base='battleLobbyRooms/'+room.code;
  try{
   const freshSnap=await onlineDb.ref(base).once('value');if(!freshSnap.exists()){status('Ruang Battle sudah tidak tersedia.');return;}
   const freshRoom=freshSnap.val(),live=freshRoom.live,participant=(freshRoom.participants||{})[onlineUid];
   if(!live||live.status!=='playing'||!Array.isArray(live.questions)){status('Pertandingan belum aktif atau sudah selesai.');return;}
   if(!participant){status('Peserta tidak ditemukan. Masuk kembali dengan kode ruang.');return;}
   const ref=onlineDb.ref(base+'/live/progress/'+onlineUid);
   const result=await ref.transaction(p=>{
    p=p||{name:participant.name||'Siswa',team:participant.team||null,qIndex:0,score:0,correct:0,wrong:0,completed:false,startedAt:Date.now(),finishedAt:null,answers:{}};
    const total=live.questions.length,index=Math.max(0,Number(p.qIndex)||0);
    if(p.completed||index>=total||live.status!=='playing')return;
    p.answers=p.answers||{};if(Object.prototype.hasOwnProperty.call(p.answers,String(index)))return;
    const q=live.questions[index];if(!q)return;let correct=false,stored=value;
    if(q.type==='story-order'){
     const submitted=Array.isArray(value)?value.map(Number):[],expected=(q.events||[]).map((e,i)=>({i,order:Number(e.order)})).sort((a,b)=>a.order-b.order).map(x=>x.i);
     correct=submitted.length===expected.length&&submitted.every((v,i)=>v===expected[i]);stored=submitted;
    }else if(q.type==='text'||q.type==='puzzle'){
     const normalize=v=>String(v==null?'':v).trim().toLocaleLowerCase('id-ID').replace(/\\s+/g,'');
     correct=normalize(value)===normalize(q.answer);stored=String(value==null?'':value).slice(0,300);
    }else{correct=Number(value)===Number(q.c);stored=Number(value);}
    p.name=p.name||participant.name||'Siswa';p.team=p.team||participant.team||null;
    p.answers[String(index)]={value:stored,correct,answeredAt:Date.now()};
    if(correct){p.score=(Number(p.score)||0)+100;p.correct=(Number(p.correct)||0)+1;}else{p.score=(Number(p.score)||0)-25;p.wrong=(Number(p.wrong)||0)+1;}
    p.qIndex=index+1;if(p.qIndex>=total){p.qIndex=total;p.completed=true;p.finishedAt=Date.now();}return p;
   });
   if(!result.committed){status('Jawaban tidak tersimpan. Soal mungkin sudah dijawab atau pertandingan telah selesai.');return;}
   const saved=result.snapshot&&result.snapshot.val();if(saved){status('Jawaban tersimpan. Skor saat ini: '+Number(saved.score||0));if(saved.completed)maybeFinish(freshRoom,live);}
  }catch(e){status('Jawaban gagal disimpan: '+(e.message||e));}
 }
 window.battleLiveAnswer=value=>submitBattleAnswer(value);
 window.battleTextSubmit=()=>{const el=$('battle-text-answer');if(!el)return;const value=el.value.trim();if(!value){status('Isi jawaban terlebih dahulu.');return;}submitBattleAnswer(value);};
 window.battleStoryMove=(position,direction)=>{const next=position+direction;if(next<0||next>=storyOrder.length)return;[storyOrder[position],storyOrder[next]]=[storyOrder[next],storyOrder[position]];lastDrawKey=null;if(lastRoom&&lastLive)draw(lastRoom,lastLive);};
 window.battleStorySubmit=()=>submitBattleAnswer(storyOrder.slice());
 function startTicker(){
  if(renderTimer)clearInterval(renderTimer);
  renderTimer=setInterval(()=>{
   if(!lastRoom||!lastLive)return;
   const timerEl=$('battle-live-timer');
   if(timerEl&&lastLive.deadlineAt){
    const seconds=Math.max(0,Math.ceil((lastLive.deadlineAt-Date.now())/1000));
    timerEl.textContent=seconds<=0?'Waktu habis':Math.floor(seconds/60)+' menit '+String(seconds%60).padStart(2,'0')+' detik';
   }
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
 window.battleLiveRoomChanged=function(room){
  if(!room)return;
  if(activeCode===room.code)lastRoom=room;
  if(room.status==='playing'){listenRoom(room);startTicker();}
  else if(room.status==='completed'&&lastLive){lastRoom=room;draw(room,lastLive);}
 };
 })();