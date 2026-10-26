// ---------- Supabase: pega aquí los datos de tu proyecto (Project Settings → API) ----------
// Son públicos por diseño: lo que protege tus datos son las reglas RLS de la base de datos.
const SUPABASE_URL = 'https://aahatpyclefkkaqhgybw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_1_-6gYs--sHbO5hOs_MJ8w_yooanmBT';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let user = null;

// ---------- Estado ----------
const $ = s => document.querySelector(s);
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d }catch{ return d } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)) }catch{} }
};
let library = store.get('rolas.library', [{ id:'fav', name:'Me gustan', tracks:[] }]);
let queue = store.get('rolas.queue', []);
let index = store.get('rolas.index', -1);
let recents = store.get('rolas.recents', []);
let shuffle = store.get('rolas.shuffle', false);
let repeat = store.get('rolas.repeat', 'off');
let apiKey = store.get('rolas.key', '');
let dataSaver = store.get('rolas.saver', true);
let lastResults = [], lastQuery = '', nextPage = '', queueSource = '';
let player, ready = false, pendingTrack = null, userPaused = false;

const save = () => { scheduleCloud(); store.set('rolas.library', library); store.set('rolas.queue', queue); store.set('rolas.index', index);
  store.set('rolas.recents', recents); store.set('rolas.shuffle', shuffle); store.set('rolas.repeat', repeat) };
const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const thumb = id => `https://i.ytimg.com/vi/${ID_RE.test(id) ? id : 'invalid'}/mqdefault.jpg`;
// Todo dato que entra (archivo importado, nube, navegador) pasa por aquí: IDs validados, textos recortados.
const clip = (v, n) => String(v ?? '').slice(0, n);
function cleanTrack(t){ return t && ID_RE.test(t.id) ? { id: t.id, title: clip(t.title, 200), channel: clip(t.channel, 120) } : null }
const cleanTracks = a => (Array.isArray(a) ? a : []).map(cleanTrack).filter(Boolean).slice(0, 5000);
function cleanLibrary(a){
  const out = (Array.isArray(a) ? a : []).slice(0, 200).filter(p => p && typeof p === 'object')
    .map(p => ({ id: /^[\w-]{1,40}$/.test(p.id) ? p.id : 'pl' + Math.random().toString(36).slice(2), name: clip(p.name, 80) || 'Playlist', tracks: cleanTracks(p.tracks) }));
  if (!out.some(p => p.id === 'fav')) out.unshift({ id:'fav', name:'Me gustan', tracks:[] });
  return out;
}
library = cleanLibrary(library); queue = cleanTracks(queue); recents = cleanTracks(recents);
if (index >= queue.length) index = queue.length - 1;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = s => { s = Math.max(0, Math.floor(s||0)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}` };
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(()=>t.classList.remove('show'), 1800) }
function decode(s){ const d = document.createElement('textarea'); d.innerHTML = s; return d.value }
const current = () => queue[index];

// ---------- Navegación ----------
let currentView = 'inicio';
function showView(name){
  currentView = name;
  document.querySelectorAll('.tabbar button').forEach(x => x.setAttribute('aria-selected', x.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-'+name));
  $('#greet').textContent = { inicio: greeting(), buscar: 'Buscar', biblioteca: 'Tu biblioteca', cola: 'Cola', gym: 'Gym' }[name];
  if (name === 'gym') renderGym();
  if (name === 'inicio') renderHome();
  if (name === 'biblioteca') renderLibrary();
  if (name === 'cola') renderQueue();
  if (name === 'buscar') setTimeout(() => !lastResults.length && $('#q').focus(), 50);
  $('main').scrollTop = 0;
}
function greeting(){ const h = new Date().getHours(); return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches' }
document.querySelectorAll('.tabbar button').forEach(b => b.onclick = () => showView(b.dataset.view));

// ---------- Pantalla grande ----------
let sheetOpen = false;
function openSheet(){ if (!current()) return; history.pushState({ sheet: 1 }, ''); sheetOpen = true; $('#sheet').classList.add('open'); $('#sheet').setAttribute('aria-hidden','false');
  $('#video').classList.add('off'); setTimeout(placeVideo, 260) }
function closeSheet(){ sheetOpen = false; $('#sheet').classList.remove('open'); $('#sheet').setAttribute('aria-hidden','true');
  $('#video').classList.add('off'); setTimeout(placeVideo, 260) }
$('#minfo').onclick = openSheet; $('#mslot').onclick = openSheet;
const leaveSheet = () => history.state?.sheet ? history.back() : closeSheet();
$('#btnClose').onclick = leaveSheet;
$('#btnToQueue').onclick = () => { leaveSheet(); showView('cola') };
window.addEventListener('popstate', () => sheetOpen && closeSheet());

// Un solo iframe que nunca se mueve en el DOM (moverlo lo recargaría): solo se reacomoda encima del lugar visible.
function placeVideo(){
  const v = $('#video'), vin = $('#vin');
  const big = sheetOpen && !dataSaver;
  // En ahorro de datos el video se queda del tamaño de la miniatura: YouTube elige la calidad según el tamaño
  // del reproductor, así que baja a la mínima (144p). En la pantalla grande se muestra la portada fija.
  const target = big ? $('#stage') : (!$('#mini').hidden ? $('#mslot') : null);
  if (!target) { v.classList.add('off'); return }
  const r = target.getBoundingClientRect();
  if (!r.width) { v.classList.add('off'); return }
  v.classList.remove('off'); v.classList.toggle('big', big);
  Object.assign(v.style, { left: r.left+'px', top: r.top+'px', width: r.width+'px', height: r.height+'px' });
  // En el mini el cuadro es cuadrado: el video 16:9 se recorta a los lados, como una portada.
  const w = Math.max(r.width, r.height * 16/9), h = w * 9/16;
  Object.assign(vin.style, { width: w+'px', height: h+'px', left: (r.width - w)/2+'px', top: (r.height - h)/2+'px' });
}
window.addEventListener('resize', placeVideo);

// ---------- Control desde la notificación ----------
// Android muestra los botones del "reproductor" que suena en la página principal. Como YouTube suena dentro
// de su propio marco, se reproduce en paralelo un audio en silencio de la app para que la notificación use
// los botones de Rolas (anterior / siguiente) y no los del marco de YouTube.
function silentWav(){
  // 30 s, 8 bits, mono. Android trata como "sonido corto" lo que dura menos de 5 s y no le da notificación.
  const sr = 8000, n = sr * 30, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); str(36, 'data'); v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128); // 128 = silencio en audio de 8 bits
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
const keep = new Audio(silentWav()); keep.loop = true;
function keepAlive(on){ if (on) keep.play().catch(() => {}); else keep.pause() }

// ---------- YouTube ----------
const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
window.onYouTubeIframeAPIReady = () => {
  player = new YT.Player('yt', {
    host: 'https://www.youtube.com',
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 0, disablekb: 1, iv_load_policy: 3 },
    events: {
      onReady: () => { ready = true; const t = pendingTrack || current(); if (t) loadTrack(t, !!pendingTrack) },
      onStateChange: e => {
        setPlayIcon(e.data === YT.PlayerState.PLAYING);
        if (e.data === YT.PlayerState.PLAYING) keepAlive(true);
        if (e.data === YT.PlayerState.PAUSED) keepAlive(false);
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = e.data === YT.PlayerState.PLAYING ? 'playing' : 'paused';
        if (e.data === YT.PlayerState.ENDED) next(true);
      },
      onError: () => { toast('Ese video no se puede reproducir, saltando'); next(true) }
    }
  });
};

function showTrackInfo(t){
  $('#mini').hidden = false;
  $('#mTitle').textContent = $('#nowTitle').textContent = t.title || 'Sin título';
  $('#mSub').textContent = $('#nowSub').textContent = t.channel || '';
  $('#mslot').style.backgroundImage = `url(${thumb(t.id)})`;
  $('#stage').style.backgroundImage = `url(https://i.ytimg.com/vi/${t.id}/hqdefault.jpg)`;
  requestAnimationFrame(placeVideo);
}
function loadTrack(t, autoplay = true){
  showTrackInfo(t);
  if (!ready) { pendingTrack = autoplay ? t : null; return }
  pendingTrack = null;
  if (autoplay) { userPaused = false; keepAlive(true) }
  autoplay ? player.loadVideoById(t.id) : player.cueVideoById(t.id);
  document.title = `${t.title} · Rolas`;
  if (autoplay) { recents = [t, ...recents.filter(x => x.id !== t.id)].slice(0, 20); save() }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.channel || '',
      artwork: [{ src: `https://i.ytimg.com/vi/${t.id}/hqdefault.jpg`, sizes:'480x360', type:'image/jpeg' }] });
  }
  renderQueue(); markPlaying();
}

function playList(tracks, start = 0, source = ''){
  if (!tracks.length) return;
  queueSource = source;
  queue = tracks.slice(); index = start;
  if (shuffle) { const first = queue.splice(start,1)[0]; queue.sort(()=>Math.random()-.5); queue.unshift(first); index = 0 }
  save(); loadTrack(queue[index]);
}
function playNow(t){ queue.splice(index+1, 0, t); index++; save(); loadTrack(t) }
function enqueue(t){ queue.push(t); if (index < 0) { index = 0; loadTrack(t) } save(); toast('Agregada a la cola'); renderQueue() }
function next(auto = false){
  if (!queue.length) return;
  if (auto && repeat === 'one') { player.seekTo(0); player.playVideo(); return }
  if (index < queue.length - 1) index++;
  else if (repeat === 'all' || !auto) index = 0;
  else { keepAlive(false); return setPlayIcon(false) }
  save(); loadTrack(queue[index]);
}
function prev(){
  if (!queue.length) return;
  if (ready && player.getCurrentTime() > 4) return player.seekTo(0);
  index = index > 0 ? index - 1 : queue.length - 1; save(); loadTrack(queue[index]);
}
function togglePlay(){
  if (!ready || index < 0) return;
  const st = player.getPlayerState();
  if (st === YT.PlayerState.PLAYING) { userPaused = true; player.pauseVideo(); keepAlive(false) }
  else { userPaused = false; keepAlive(true); player.playVideo() }
}

function setPlayIcon(playing){
  document.querySelectorAll('.pi').forEach(p => p.innerHTML = playing ? '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>');
  ['#btnPlay','#mPlay'].forEach(id => $(id).setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir'));
}
$('#btnPlay').onclick = togglePlay; $('#mPlay').onclick = togglePlay;
$('#btnNext').onclick = () => next(); $('#btnPrev').onclick = prev;
$('#mAdd').onclick = () => current() && askPlaylist(current());
$('#sAdd').onclick = () => current() && askPlaylist(current());
$('#btnShuffle').onclick = () => { shuffle = !shuffle; save(); paintModes(); toast(shuffle ? 'Aleatorio activado' : 'Aleatorio desactivado') };
$('#btnRepeat').onclick = () => { repeat = {off:'all', all:'one', one:'off'}[repeat]; save(); paintModes();
  toast({off:'Repetir desactivado', all:'Repetir todo', one:'Repetir esta canción'}[repeat]) };
function paintModes(){
  $('#btnShuffle').classList.toggle('on', shuffle); $('#btnRepeat').classList.toggle('on', repeat !== 'off');
  $('#btnRepeat').innerHTML = repeat === 'one'
    ? '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2zm-4-2V9h-1l-2 1v1h1.5v4z"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z"/></svg>';
}
paintModes();

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => { userPaused = false; keepAlive(true); player?.playVideo() });
  navigator.mediaSession.setActionHandler('pause', () => { userPaused = true; player?.pauseVideo(); keepAlive(false); navigator.mediaSession.playbackState = 'paused' });
  try { navigator.mediaSession.setActionHandler('seekto', e => player?.seekTo(e.seekTime, true)) } catch {}
  navigator.mediaSession.setActionHandler('nexttrack', () => next());
  navigator.mediaSession.setActionHandler('previoustrack', prev);
}

let seeking = false;
$('#seek').addEventListener('input', () => seeking = true);
$('#seek').addEventListener('change', e => { if (ready) player.seekTo(player.getDuration() * e.target.value / 100, true); seeking = false });
setInterval(() => {
  if (!ready || !player.getDuration) return;
  const d = player.getDuration(), c = player.getCurrentTime(), pct = d ? c / d * 100 : 0;
  $('#tCur').textContent = fmt(c); $('#tDur').textContent = fmt(d);
  $('#mBar').style.width = pct + '%';
  if (d && 'mediaSession' in navigator && navigator.mediaSession.setPositionState) {
    try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(c, d), playbackRate: 1 }) } catch {}
  }
  if (!seeking) $('#seek').value = pct;
}, 500);

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay() }
  if (e.code === 'Escape' && sheetOpen) leaveSheet();
});

// ---------- Búsqueda ----------
function videoIdFrom(text){
  const m = text.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/);
  return m ? m[1] : null;
}
function playlistIdFrom(text){ const m = text.match(/[?&]list=([\w-]+)/); return m ? m[1] : null }
async function infoFor(id){
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v='+id)}&format=json`);
    if (r.ok) { const j = await r.json(); return { id, title: j.title, channel: j.author_name } }
  } catch {}
  return { id, title: 'Video ' + id, channel: 'YouTube' };
}
let lastSearchAt = 0;
async function search(){
  const q = clip($('#q').value.trim(), 150); if (!q) return;
  if (Date.now() - lastSearchAt < 2000) return toast('Espera un momento entre búsquedas');
  lastSearchAt = Date.now();
  $('#q').blur();
  const listId = playlistIdFrom(q), vid = videoIdFrom(q);
  if (listId && apiKey) return importPlaylist(listId);
  if (vid) { renderResults([await infoFor(vid)]); $('#searchHint').textContent = ''; return }
  if (!apiKey) { $('#searchHint').textContent = 'Para buscar por nombre agrega tu API key en Ajustes. Mientras, pega el link de un video.'; return }
  lastQuery = q; nextPage = ''; lastResults = [];
  $('#searchHint').textContent = 'Buscando…';
  await fetchResults();
}
async function fetchResults(){
  $('#moreBtn')?.remove();
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=50&regionCode=MX&relevanceLanguage=es&q=${encodeURIComponent(lastQuery)}&key=${apiKey}${nextPage ? '&pageToken=' + nextPage : ''}`;
    const j = await (await fetch(url)).json();
    if (j.error) throw new Error(j.error.message);
    const seen = new Set(lastResults.map(t => t.id));
    const items = j.items.filter(it => ID_RE.test(it.id?.videoId) && !seen.has(it.id.videoId))
      .map(it => cleanTrack({ id: it.id.videoId, title: decode(it.snippet.title), channel: decode(it.snippet.channelTitle) }));
    nextPage = j.nextPageToken || '';
    renderResults([...lastResults, ...items]);
    if (queueSource === 'search:' + lastQuery && items.length) {
      const extra = shuffle ? items.slice().sort(() => Math.random() - .5) : items;
      queue.push(...extra); save(); renderQueue();
    }
    $('#searchHint').textContent = lastResults.length ? '' : 'Sin resultados. Prueba con otro nombre.';
    if (nextPage) {
      const b = document.createElement('button'); b.id = 'moreBtn'; b.className = 'btn ghost';
      b.style.cssText = 'display:block;margin:16px auto'; b.textContent = 'Cargar más resultados';
      b.onclick = () => { b.textContent = 'Cargando…'; b.disabled = true; fetchResults() };
      $('#results').after(b);
    }
  } catch (err) { $('#searchHint').textContent = 'La búsqueda falló: ' + err.message + '. Revisa tu API key en Ajustes.' }
}
async function importPlaylist(listId){
  $('#searchHint').textContent = 'Importando playlist…';
  try {
    let tracks = [], page = '', name = 'Playlist importada';
    const info = await (await fetch(`https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${listId}&key=${apiKey}`)).json();
    if (info.items?.[0]) name = decode(info.items[0].snippet.title);
    do {
      const j = await (await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${listId}&key=${apiKey}${page ? '&pageToken='+page : ''}`)).json();
      if (j.error) throw new Error(j.error.message);
      tracks.push(...j.items.filter(i => i.snippet.resourceId?.videoId && i.snippet.title !== 'Private video')
        .map(i => ({ id: i.snippet.resourceId.videoId, title: decode(i.snippet.title), channel: decode(i.snippet.videoOwnerChannelTitle || '') })));
      page = j.nextPageToken;
    } while (page && tracks.length < 500);
    library.push({ id: 'pl' + Date.now(), name, tracks }); save();
    $('#searchHint').textContent = `Importada “${name}” con ${tracks.length} canciones. Está en Tu biblioteca.`;
  } catch (err) { $('#searchHint').textContent = 'No se pudo importar: ' + err.message }
}
$('#q').addEventListener('keydown', e => { if (e.key === 'Enter') search() });

// ---------- Render ----------
const ICON_PLUS = '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm1-13h-2v4H7v2h4v4h2v-4h4v-2h-4z"/></svg>';
const ICON_QUEUE = '<svg viewBox="0 0 24 24"><path d="M3 6h12v2H3zm0 5h12v2H3zm0 5h8v2H3zm14-2v-3h2v3h3v2h-3v3h-2v-3h-3v-2z"/></svg>';
const ICON_DEL = '<svg viewBox="0 0 24 24"><path d="M6 7h12l-1 13H7zm3-4h6l1 2h4v2H4V5h4z"/></svg>';

function trackRow(t, opts){
  const li = document.createElement('li'); li.className = 'track'; li.dataset.id = t.id;
  li.innerHTML = `<img src="${thumb(t.id)}" alt="" loading="lazy">
    <button class="t-main"><div class="t-title">${esc(t.title)}</div><div class="t-sub">${esc(t.channel)}</div></button>
    ${opts.add ? `<button class="icon-btn" data-a="add" aria-label="Agregar a playlist">${ICON_PLUS}</button>` : ''}
    ${opts.queue ? `<button class="icon-btn" data-a="queue" aria-label="Agregar a la cola">${ICON_QUEUE}</button>` : ''}
    ${opts.del ? `<button class="icon-btn" data-a="del" aria-label="Quitar">${ICON_DEL}</button>` : ''}`;
  li.querySelector('.t-main').onclick = opts.onPlay;
  li.querySelector('[data-a=add]')?.addEventListener('click', () => askPlaylist(t));
  li.querySelector('[data-a=queue]')?.addEventListener('click', () => enqueue(t));
  li.querySelector('[data-a=del]')?.addEventListener('click', opts.onDel);
  return li;
}
function coverFor(tracks){
  const ids = [...new Set(tracks.map(t => t.id).filter(id => ID_RE.test(id)))];
  if (!ids.length) return '<div class="cover one"></div>';
  if (ids.length < 4) return `<div class="cover one"><img src="${thumb(ids[0])}" alt=""></div>`;
  return `<div class="cover">${ids.slice(0,4).map(id => `<img src="https://i.ytimg.com/vi/${esc(id)}/default.jpg" alt="">`).join('')}</div>`;
}
function renderHome(){
  const box = $('#home'); box.innerHTML = '';
  if (!recents.length && !library.some(p => p.tracks.length)) {
    box.innerHTML = `<div class="welcome"><h2 class="sec" style="margin-top:0">Empieza a escuchar</h2>
      <p>Busca una canción, tócala para reproducirla y guárdala en tus playlists con el botón +.</p>
      <button class="btn" id="goSearch">Buscar música</button></div>`;
    $('#goSearch').onclick = () => showView('buscar'); return;
  }
  const grid = document.createElement('div'); grid.className = 'grid';
  library.filter(p => p.tracks.length).slice(0, 8).forEach(pl => {
    const b = document.createElement('button'); b.className = 'tile';
    b.innerHTML = `${coverFor(pl.tracks)}<b>${esc(pl.name)}</b>`;
    b.onclick = () => playList(pl.tracks, 0);
    grid.appendChild(b);
  });
  if (grid.children.length) box.appendChild(grid);
  if (recents.length) {
    box.insertAdjacentHTML('beforeend', '<h2 class="sec">Escuchado recientemente</h2>');
    const shelf = document.createElement('div'); shelf.className = 'shelf';
    recents.forEach(t => {
      const c = document.createElement('button'); c.className = 'card';
      c.innerHTML = `<img src="https://i.ytimg.com/vi/${esc(t.id)}/hqdefault.jpg" alt="" loading="lazy"><b>${esc(t.title)}</b><span>${esc(t.channel)}</span>`;
      c.onclick = () => playNow(t);
      shelf.appendChild(c);
    });
    box.appendChild(shelf);
  }
}
function renderResults(items){
  lastResults = items;
  const ul = $('#results'); ul.innerHTML = '';
  items.forEach((t, i) => ul.appendChild(trackRow(t, { add:true, queue:true,
    onPlay: () => playList(lastResults, i, 'search:' + lastQuery) })));
  markPlaying();
}
function renderLibrary(){
  const box = $('#library'); box.innerHTML = '';
  library.forEach(pl => {
    const head = document.createElement('div'); head.className = 'pl-head';
    head.innerHTML = `${coverFor(pl.tracks).replace('class="cover', 'style="border-radius:6px" class="cover')}
      <h2>${esc(pl.name)}<div class="t-sub">Playlist · ${pl.tracks.length} canciones</div></h2>
      <button class="icon-btn" data-a="play" aria-label="Reproducir playlist" style="color:var(--accent)" ${pl.tracks.length ? '' : 'disabled'}><svg viewBox="0 0 24 24" style="width:34px;height:34px"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 14.5v-9l6 4.5z"/></svg></button>
      ${pl.id !== 'fav' ? `<button class="icon-btn" data-a="del" aria-label="Borrar playlist">${ICON_DEL}</button>` : ''}`;
    head.querySelector('[data-a=play]').onclick = () => playList(pl.tracks, 0);
    head.querySelector('[data-a=del]')?.addEventListener('click', () => {
      if (confirm(`¿Borrar la playlist “${pl.name}”?`)) { library = library.filter(p => p !== pl); save(); renderLibrary() }
    });
    box.appendChild(head);
    const ul = document.createElement('ul'); ul.className = 'list';
    if (!pl.tracks.length) ul.innerHTML = '<li class="empty">Vacía. Agrega canciones desde Buscar con el botón +.</li>';
    pl.tracks.forEach((t, i) => ul.appendChild(trackRow(t, { queue:true, del:true, onPlay: () => playList(pl.tracks, i),
      onDel: () => { pl.tracks.splice(i,1); save(); renderLibrary() } })));
    box.appendChild(ul);
  });
  markPlaying();
}
function renderQueue(){
  const ul = $('#queue'); ul.innerHTML = '';
  if (!queue.length) { ul.innerHTML = '<li class="empty">La cola está vacía. Reproduce una playlist o agrega canciones.</li>'; return }
  queue.forEach((t, i) => {
    const li = trackRow(t, { del:true, onPlay: () => { index = i; save(); loadTrack(t) },
      onDel: () => { queue.splice(i,1); if (i < index) index--; else if (i === index) { index = Math.min(index, queue.length-1); if (queue[index]) loadTrack(queue[index]) } save(); renderQueue() } });
    if (i === index) li.classList.add('playing');
    ul.appendChild(li);
  });
}
function markPlaying(){
  const cur = current()?.id;
  document.querySelectorAll('#results .track, #library .track').forEach(li => li.classList.toggle('playing', li.dataset.id === cur));
}

// ---------- Playlists ----------
function askPlaylist(t){
  const box = $('#addOpts'); box.innerHTML = '';
  library.forEach(pl => {
    const has = pl.tracks.some(x => x.id === t.id);
    const b = document.createElement('button'); b.textContent = (has ? '✓ ' : '') + pl.name;
    b.onclick = () => { if (!has) pl.tracks.push(t); save(); $('#dlgAdd').close(); toast(has ? `Ya está en ${pl.name}` : `Agregada a ${pl.name}`) };
    box.appendChild(b);
  });
  $('#dlgAdd').showModal();
}
$('#btnNewPl').onclick = () => {
  const name = $('#newPl').value.trim(); if (!name) return;
  library.push({ id: 'pl' + Date.now(), name, tracks: [] }); $('#newPl').value = ''; save(); renderLibrary();
};
$('#btnClearQ').onclick = () => { queue = current() ? [current()] : []; index = queue.length ? 0 : -1; save(); renderQueue() };

document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

// ---------- Ajustes ----------
$('#btnSettings').onclick = () => { $('#accEmail').textContent = user?.email || ''; $('#apiKey').value = apiKey; $('#saver').checked = dataSaver; $('#dlgSettings').showModal() };
$('#saver').onchange = e => { dataSaver = e.target.checked; store.set('rolas.saver', dataSaver); placeVideo();
  toast(dataSaver ? 'Ahorro de datos activado' : 'Ahorro de datos desactivado') };
$('#btnSaveKey').onclick = () => { const k = $('#apiKey').value.trim();
  if (k && !/^[\w-]{20,60}$/.test(k)) return toast('Esa API key no tiene un formato válido');
  apiKey = k; store.set('rolas.key', apiKey); scheduleCloud(); toast('Guardado'); $('#dlgSettings').close() };
$('#btnLogout').onclick = async () => { await flushCloud(); await sb.auth.signOut(); };
$('#btnExport').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(library, null, 1)], { type: 'application/json' }));
  a.download = 'rolas-biblioteca.json'; a.click();
};
$('#btnImport').onclick = () => $('#fileImport').click();
$('#fileImport').onchange = async e => {
  try {
    const f = e.target.files[0]; if (!f || f.size > 2_000_000) throw 0;
    const data = JSON.parse(await f.text()); if (!Array.isArray(data)) throw 0;
    library = cleanLibrary(data); save(); renderLibrary(); toast('Biblioteca importada')
  } catch { toast('Ese archivo no es una biblioteca de Rolas') }
  e.target.value = '';
};

// ---------- Gym: ejercicio y comida ----------
const TAGS = ['Aproximación','Efectivas','Pesadas','Ligeras','Dropset','Unilateral','Biserie','Al fallo','Top set','Parciales','Excéntrica'];
const UNITS = ['kg','lb','placas'];
const uid = () => Math.random().toString(36).slice(2, 10);
const UID_RE = /^[a-z0-9]{1,12}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const okId = v => UID_RE.test(v) ? v : uid();
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` };
const arr = (a, n) => (Array.isArray(a) ? a : []).slice(0, n);
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) && n >= 0 && n <= 9999 ? Math.round(n * 100) / 100 : null };
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const monthLabel = m => /^\d{4}-\d{2}$/.test(m || '') ? `${MESES[+m.slice(5) - 1]} ${m.slice(0, 4)}` : '';
const shortDate = k => { const [y, m, d] = k.split('-'); return `${+d} ${MESES[+m - 1].slice(0, 3)}${y !== String(new Date().getFullYear()) ? ' ' + y : ''}` };

// Limpieza de todo lo que entra (archivo importado, nube, navegador): estructura, tamaños e IDs.
function cleanDiet(d){
  return { id: okId(d.id), name: clip(d.name, 60) || 'Protocolo', kcal: clip(d.kcal, 10).replace(/[^\d]/g, '').slice(0, 5),
    month: /^\d{4}-\d{2}$/.test(d.month || '') ? d.month : '',
    meals: arr(d.meals, 12).filter(m => m && typeof m === 'object').map(m => ({ id: okId(m.id), name: clip(m.name, 40) || 'Comida', text: clip(m.text, 600) })) };
}
function cleanFitness(f){
  if (!f || typeof f !== 'object') return emptyFitness();
  const routines = arr(f.routines, 20).filter(r => r && typeof r === 'object').map(r => ({
    id: okId(r.id), name: clip(r.name, 60) || 'Rutina',
    days: arr(r.days, 14).filter(d => d && typeof d === 'object').map(d => ({
      id: okId(d.id), name: clip(d.name, 40) || 'Día', focus: clip(d.focus, 60),
      exercises: arr(d.exercises, 60).filter(e => e && typeof e === 'object').map(e => ({
        id: okId(e.id), name: clip(e.name, 120) || 'Ejercicio', sets: clip(e.sets, 80), reps: clip(e.reps, 140),
        tags: arr(e.tags, 11).filter(t => TAGS.includes(t)), notes: clip(e.notes, 600) }))
    })),
    recs: arr(r.recs, 20).map(x => clip(x, 300)).filter(Boolean)
  }));
  // "diet" (versión anterior, una sola dieta) se convierte en la lista "diets"
  const rawDiets = Array.isArray(f.diets) ? f.diets : (f.diet && typeof f.diet === 'object' ? [f.diet] : []);
  const diets = arr(rawDiets, 36).filter(d => d && typeof d === 'object').map(cleanDiet);
  const log = {};
  Object.keys(f.log && typeof f.log === 'object' ? f.log : {}).filter(k => DATE_RE.test(k)).sort().slice(-60).forEach(k => {
    const v = f.log[k] || {};
    log[k] = { ex: arr(v.ex, 400).filter(x => UID_RE.test(x)), meals: arr(v.meals, 20).filter(x => UID_RE.test(x)) };
  });
  const records = {};
  Object.keys(f.records && typeof f.records === 'object' ? f.records : {}).filter(k => UID_RE.test(k)).slice(0, 600).forEach(k => {
    const list = arr(f.records[k], 300).filter(x => x && DATE_RE.test(x.date)).map(x => ({
      id: okId(x.id), date: x.date, min: num(x.min), max: num(x.max), unit: UNITS.includes(x.unit) ? x.unit : 'kg', obs: clip(x.obs, 300) }))
      .filter(x => x.min !== null || x.max !== null || x.obs);
    if (list.length) records[k] = list;
  });
  return {
    routines, activeRoutine: routines.some(r => r.id === f.activeRoutine) ? f.activeRoutine : routines[0]?.id || '',
    diets, activeDiet: diets.some(d => d.id === f.activeDiet) ? f.activeDiet : diets[0]?.id || '',
    log, records
  };
}
function emptyFitness(){ return { routines: [], activeRoutine: '', diets: [], activeDiet: '', log: {}, records: {} } }

let fitness = cleanFitness(store.get('rolas.fitness', null));
let selDay = {};
let gymTab = store.get('rolas.gymTab', 'ejercicio');
function saveFit(){ store.set('rolas.fitness', fitness); scheduleCloud() }
const activeRoutine = () => fitness.routines.find(r => r.id === fitness.activeRoutine);
const activeDiet = () => fitness.diets.find(d => d.id === fitness.activeDiet);
function todayLog(){ const k = todayKey(); return fitness.log[k] || (fitness.log[k] = { ex: [], meals: [] }) }
function toggleIn(list, id){ const i = list.indexOf(id); i < 0 ? list.push(id) : list.splice(i, 1) }
const recsOf = id => (fitness.records[id] || []).slice().sort((a, b) => b.date.localeCompare(a.date));
const fmtW = r => r.min !== null && r.max !== null && r.min !== r.max ? `${r.min}–${r.max} ${r.unit}` : `${r.max ?? r.min ?? ''} ${r.unit}`;
const CHECK = '<svg viewBox="0 0 24 24"><path d="m9 16.2-3.5-3.5L4 14.2l5 5 11-11-1.5-1.4z"/></svg>';
const DOTS = '<svg viewBox="0 0 24 24"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>';

// Menú de opciones reutilizable
function menu(title, options){
  $('#mnTitle').textContent = title;
  const box = $('#mnOpts'); box.innerHTML = '';
  options.forEach(([label, fn, danger]) => {
    const b = document.createElement('button'); b.textContent = label; if (danger) b.style.color = '#FF8A8A';
    b.onclick = () => { $('#dlgMenu').close(); fn() }; box.appendChild(b);
  });
  $('#dlgMenu').showModal();
}
// Formulario reutilizable
function formDialog(title, fields, onSave, onDelete){
  $('#fTitle').textContent = title;
  const f = $('#fBody'); f.innerHTML = '';
  const picked = {};
  let row = null;
  fields.forEach(fd => {
    const id = 'f_' + fd.key;
    let host = f;
    if (fd.half) { if (!row || row.children.length >= 2) { row = document.createElement('div'); row.className = 'frow'; f.appendChild(row) } host = document.createElement('div'); row.appendChild(host) } else row = null;
    const lab = document.createElement('label'); lab.textContent = fd.label; lab.htmlFor = id; host.appendChild(lab);
    if (fd.type === 'tags') {
      picked[fd.key] = new Set(fd.value || []);
      const wrap = document.createElement('div'); wrap.className = 'tagpick'; wrap.id = id;
      TAGS.forEach(t => {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = t;
        b.setAttribute('aria-pressed', picked[fd.key].has(t));
        b.onclick = () => { picked[fd.key].has(t) ? picked[fd.key].delete(t) : picked[fd.key].add(t); b.setAttribute('aria-pressed', picked[fd.key].has(t)) };
        wrap.appendChild(b);
      });
      host.appendChild(wrap);
    } else if (fd.type === 'select') {
      const el = document.createElement('select'); el.id = id;
      fd.options.forEach(o => { const op = document.createElement('option'); op.value = o; op.textContent = o; if (o === fd.value) op.selected = true; el.appendChild(op) });
      host.appendChild(el);
    } else {
      const el = document.createElement(fd.type === 'textarea' ? 'textarea' : 'input');
      el.id = id; el.value = fd.value ?? ''; if (fd.placeholder) el.placeholder = fd.placeholder;
      if (fd.type === 'textarea') el.rows = fd.rows || 3; else el.type = fd.type || 'text';
      if (fd.inputmode) el.inputMode = fd.inputmode;
      if (fd.type !== 'date' && fd.type !== 'month') el.maxLength = fd.max || 300;
      host.appendChild(el);
    }
  });
  const btns = document.createElement('div'); btns.className = 'fbtns';
  btns.innerHTML = `<button class="btn" type="submit">Guardar</button><button class="btn ghost" type="button" data-x>Cancelar</button>`;
  if (onDelete) { const d = document.createElement('button'); d.type = 'button'; d.className = 'danger'; d.textContent = 'Eliminar'; d.onclick = () => { $('#dlgForm').close(); onDelete() }; btns.appendChild(d) }
  btns.querySelector('[data-x]').onclick = () => $('#dlgForm').close();
  f.appendChild(btns);
  f.onsubmit = e => {
    e.preventDefault();
    const out = {};
    fields.forEach(fd => out[fd.key] = fd.type === 'tags' ? [...picked[fd.key]] : $('#f_' + fd.key).value.trim());
    if (onSave(out) !== false) $('#dlgForm').close();
  };
  if ($('#dlgEx').open) $('#dlgEx').close();
  $('#dlgForm').showModal();
  setTimeout(() => f.querySelector('input:not([type=date]),textarea')?.focus(), 50);
}

// ----- Pestaña Gym -----
function renderGym(){
  document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === gymTab));
  $('#rutina').hidden = gymTab !== 'ejercicio'; $('#dieta').hidden = gymTab !== 'comida';
  gymTab === 'ejercicio' ? renderRutina() : renderDieta();
}
document.querySelectorAll('.seg button').forEach(b => b.onclick = () => { gymTab = b.dataset.tab; store.set('rolas.gymTab', gymTab); renderGym() });

// ----- Ejercicio -----
function renderRutina(){
  const box = $('#rutina'); box.innerHTML = '';
  const chips = document.createElement('div'); chips.className = 'chips';
  fitness.routines.forEach(r => {
    const c = document.createElement('button'); c.className = 'chip' + (r.id === fitness.activeRoutine ? ' on' : ''); c.textContent = r.name;
    c.onclick = () => { fitness.activeRoutine = r.id; saveFit(); renderRutina() };
    chips.appendChild(c);
  });
  const add = document.createElement('button'); add.className = 'chip add'; add.textContent = '+ Nueva rutina';
  add.onclick = newRoutine; chips.appendChild(add);
  box.appendChild(chips);

  const r = activeRoutine();
  if (!r) {
    box.insertAdjacentHTML('beforeend', `<div class="empty-card"><h2 class="sec" style="margin-top:0">Agrega tu rutina</h2>
      <p>Importa tu plan en archivo o crea una rutina desde cero con los ejercicios de tu entrenador.</p>
      <div class="actions"><button class="btn" data-a="imp">Importar plan</button><button class="btn ghost" data-a="new">Crear rutina</button></div></div>`);
    box.querySelector('[data-a=imp]').onclick = () => $('#fileFit').click();
    box.querySelector('[data-a=new]').onclick = newRoutine;
    return;
  }
  const days = document.createElement('div'); days.className = 'days';
  if (!r.days.some(d => d.id === selDay[r.id])) selDay[r.id] = r.days[0]?.id;
  const log = todayLog();
  r.days.forEach(d => {
    const done = d.exercises.filter(e => log.ex.includes(e.id)).length;
    const b = document.createElement('button'); b.className = 'day' + (d.id === selDay[r.id] ? ' on' : '');
    b.innerHTML = `<b>${esc(d.name)}</b><small>${esc(d.focus || d.exercises.length + ' ejercicios')}${done ? ' · ' + done + '/' + d.exercises.length : ''}</small>`;
    b.onclick = () => { selDay[r.id] = d.id; renderRutina() };
    days.appendChild(b);
  });
  const addDay = document.createElement('button'); addDay.className = 'day'; addDay.innerHTML = '<b style="color:var(--accent)">+ Día</b><small>Agregar</small>';
  addDay.onclick = () => formDialog('Nuevo día', [
      { key:'name', label:'Nombre', value:'Día ' + (r.days.length + 1), max:40 },
      { key:'focus', label:'Enfoque (opcional)', placeholder:'Ej. Cardio y abdomen', max:60 }],
    v => { const d = { id: uid(), name: v.name || 'Día', focus: v.focus, exercises: [] }; r.days.push(d); selDay[r.id] = d.id; saveFit(); renderRutina() });
  days.appendChild(addDay);
  box.appendChild(days);

  const d = r.days.find(x => x.id === selDay[r.id]);
  if (d) {
    const done = d.exercises.filter(e => log.ex.includes(e.id)).length, total = d.exercises.length;
    const head = document.createElement('div'); head.className = 'sec-head';
    head.innerHTML = `<div><h2>${esc(d.focus || d.name)}</h2><p>${esc(d.focus ? d.name + ' · ' : '')}${total ? `${done} de ${total} hechos hoy` : 'Sin ejercicios todavía'}</p></div>
      <button class="icon-btn" aria-label="Opciones del día">${DOTS}</button>`;
    head.querySelector('button').onclick = () => menu(d.name, [
      ['Editar nombre y enfoque', () => formDialog('Editar día', [
        { key:'name', label:'Nombre', value:d.name, max:40 }, { key:'focus', label:'Enfoque', value:d.focus, max:60 }],
        v => { d.name = v.name || d.name; d.focus = v.focus; saveFit(); renderRutina() })],
      ['Reiniciar marcas de hoy', () => { log.ex = log.ex.filter(id => !d.exercises.some(e => e.id === id)); saveFit(); renderRutina() }],
      ['Eliminar día', () => { if (confirm(`¿Eliminar ${d.name} y sus ejercicios?`)) { r.days = r.days.filter(x => x !== d); saveFit(); renderRutina() } }, true]]);
    box.appendChild(head);
    box.insertAdjacentHTML('beforeend', `<div class="meter"><i style="width:${total ? done / total * 100 : 0}%"></i></div>`);

    const ol = document.createElement('ol'); ol.className = 'items';
    const unit = (v, u) => /^[\d\s\-–]+$/.test(v) ? `${esc(v)} <span>${u}</span>` : esc(v);
    d.exercises.forEach(e => {
      const isDone = log.ex.includes(e.id), last = recsOf(e.id)[0];
      const li = document.createElement('li'); li.className = 'item' + (isDone ? ' done' : '');
      const meta = [e.sets && unit(e.sets, 'series'), e.reps && unit(e.reps, 'reps')].filter(Boolean).join(' <span>·</span> ');
      li.innerHTML = `<span class="num" aria-hidden="true"></span>
        <button class="item-main"><b>${esc(e.name)}</b>${meta ? `<div class="meta">${meta}</div>` : ''}
          ${e.tags.length ? `<div class="tags">${e.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
          ${e.notes ? `<div class="note">${esc(e.notes)}</div>` : ''}
          ${last ? `<div class="lastw">Último: ${esc(fmtW(last))} · ${shortDate(last.date)}</div>` : ''}</button>
        <button class="check" aria-pressed="${isDone}" aria-label="Marcar ${esc(e.name)} como hecho">${CHECK}</button>`;
      li.querySelector('.check').onclick = () => { toggleIn(log.ex, e.id); saveFit(); renderRutina() };
      li.querySelector('.item-main').onclick = () => openExercise(d, e);
      ol.appendChild(li);
    });
    box.appendChild(ol);
    const act = document.createElement('div'); act.className = 'actions';
    act.innerHTML = `<button class="btn add-ex">+ Agregar ejercicio</button>`;
    act.querySelector('button').onclick = () => editExercise(d, null);
    box.appendChild(act);
  }

  const det = document.createElement('details'); det.className = 'recs';
  det.innerHTML = `<summary>Recomendaciones del entrenador (${r.recs.length})</summary>
    ${r.recs.length ? `<ul>${r.recs.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="note">Todavía no hay recomendaciones.</p>'}
    <div class="actions" style="margin-bottom:14px"><button class="btn ghost" data-a="recs">Editar recomendaciones</button><button class="btn ghost" data-a="opts">Opciones de la rutina</button></div>`;
  det.querySelector('[data-a=recs]').onclick = () => formDialog('Recomendaciones', [
      { key:'recs', label:'Una recomendación por línea', type:'textarea', rows:7, value: r.recs.join('\n'), max: 5000 }],
    v => { r.recs = v.recs.split('\n').map(x => clip(x.trim(), 300)).filter(Boolean).slice(0, 20); saveFit(); renderRutina() });
  det.querySelector('[data-a=opts]').onclick = () => menu(r.name, [
    ['Cambiar nombre', () => formDialog('Nombre de la rutina', [{ key:'name', label:'Nombre', value:r.name, max:60 }],
      v => { r.name = v.name || r.name; saveFit(); renderRutina() })],
    ['Exportar plan (respaldo)', exportFit],
    ['Importar plan', () => $('#fileFit').click()],
    ['Eliminar rutina', () => { if (confirm(`¿Eliminar la rutina “${r.name}”?`)) { fitness.routines = fitness.routines.filter(x => x !== r);
      fitness.activeRoutine = fitness.routines[0]?.id || ''; saveFit(); renderRutina() } }, true]]);
  box.appendChild(det);
}
function newRoutine(){
  formDialog('Nueva rutina', [{ key:'name', label:'Nombre', placeholder:'Ej. Rutina 5', max:60 }], v => {
    const r = { id: uid(), name: v.name || 'Rutina', days: [{ id: uid(), name: 'Día 1', focus: '', exercises: [] }], recs: [] };
    fitness.routines.push(r); fitness.activeRoutine = r.id; saveFit(); renderRutina();
  });
}
function editExercise(day, e){
  formDialog(e ? 'Editar ejercicio' : 'Nuevo ejercicio', [
    { key:'name', label:'Ejercicio', value:e?.name, placeholder:'Ej. Sentadilla búlgara', max:120 },
    { key:'sets', label:'Series', value:e?.sets, placeholder:'Ej. 3  ·  2 de aproximación y 3 efectivas', max:80 },
    { key:'reps', label:'Repeticiones', value:e?.reps, placeholder:'Ej. 6-8  ·  10 + dropset + 10', max:140 },
    { key:'tags', label:'Variantes', type:'tags', value:e?.tags },
    { key:'notes', label:'Explicación', type:'textarea', rows:3, value:e?.notes, placeholder:'Cómo hacerlo, según tu entrenador', max:600 }],
    v => {
      if (!v.name) { toast('Escribe el nombre del ejercicio'); return false }
      if (!e && day.exercises.length >= 60) { toast('Llegaste al máximo de 60 ejercicios en este día'); return false }
      const data = { name: v.name, sets: v.sets, reps: v.reps, tags: v.tags.filter(t => TAGS.includes(t)), notes: v.notes };
      if (e) Object.assign(e, data); else day.exercises.push({ id: uid(), ...data });
      saveFit(); renderRutina();
      if (!e) toast('Ejercicio agregado');
    },
    e ? () => { if (confirm(`¿Eliminar ${e.name}? También se borran sus registros de peso.`)) {
      day.exercises = day.exercises.filter(x => x !== e); delete fitness.records[e.id]; saveFit(); renderRutina() } } : null);
}

// Detalle del ejercicio: registros de peso y observaciones
function openExercise(day, e){
  const box = $('#exBody'); const list = recsOf(e.id);
  const maxes = list.map(x => x.max ?? x.min).filter(x => x !== null);
  const best = maxes.length ? list.find(x => (x.max ?? x.min) === Math.max(...maxes)) : null;
  $('#exTitle').textContent = e.name;
  box.innerHTML = `
    <p class="meta" style="margin:0">${esc([e.sets && e.sets + ' series', e.reps && e.reps + ' reps'].filter(Boolean).join(' · '))}</p>
    ${e.notes ? `<p class="note">${esc(e.notes)}</p>` : ''}
    <div class="stats">
      <div><small>Récord</small><b>${best ? esc(`${best.max ?? best.min} ${best.unit}`) : '—'}</b></div>
      <div><small>Último</small><b>${list[0] ? esc(fmtW(list[0])) : '—'}</b></div>
      <div><small>Registros</small><b>${list.length}</b></div>
    </div>
    <button class="btn" data-a="add" style="width:100%">Registrar pesos de hoy</button>
    <h4 class="hist-title">Historial</h4>
    ${list.length ? `<ul class="hist">${list.map(x => `<li data-id="${esc(x.id)}">
        <div><b>${esc(fmtW(x))}</b><small>${shortDate(x.date)}${x.min !== null && x.max !== null && x.min !== x.max ? ' · mín ' + x.min + ' / máx ' + x.max : ''}</small>
        ${x.obs ? `<p>${esc(x.obs)}</p>` : ''}</div>
        <button class="icon-btn" aria-label="Opciones del registro">${DOTS}</button></li>`).join('')}</ul>`
      : '<p class="note">Aún no hay registros. Anota el peso mínimo y máximo que cargaste y cómo te sentiste.</p>'}
    <div class="fbtns"><button class="btn ghost" data-a="edit">Editar ejercicio</button><button class="btn ghost" data-a="close">Cerrar</button></div>`;
  box.querySelector('[data-a=add]').onclick = () => editRecord(day, e, null);
  box.querySelector('[data-a=edit]').onclick = () => editExercise(day, e);
  box.querySelector('[data-a=close]').onclick = () => $('#dlgEx').close();
  box.querySelectorAll('.hist li').forEach(li => li.querySelector('button').onclick = () => {
    const rec = (fitness.records[e.id] || []).find(x => x.id === li.dataset.id); if (!rec) return;
    $('#dlgEx').close();
    menu(shortDate(rec.date), [['Editar registro', () => editRecord(day, e, rec)],
      ['Eliminar registro', () => { fitness.records[e.id] = fitness.records[e.id].filter(x => x !== rec); saveFit(); renderRutina(); openExercise(day, e) }, true]]);
  });
  $('#dlgEx').showModal();
}
function editRecord(day, e, rec){
  const prevUnit = rec?.unit || recsOf(e.id)[0]?.unit || 'kg';
  formDialog(rec ? 'Editar registro' : 'Registrar pesos', [
    { key:'min', label:'Peso mínimo', value: rec?.min ?? '', inputmode:'decimal', placeholder:'Ej. 10', max:7, half:true },
    { key:'max', label:'Peso máximo', value: rec?.max ?? '', inputmode:'decimal', placeholder:'Ej. 14', max:7, half:true },
    { key:'unit', label:'Unidad', type:'select', options: UNITS, value: prevUnit, half:true },
    { key:'date', label:'Fecha', type:'date', value: rec?.date || todayKey(), half:true },
    { key:'obs', label:'Observaciones', type:'textarea', rows:3, value: rec?.obs, placeholder:'Ej. La última serie costó mucho, subir peso la próxima', max:300 }],
    v => {
      const min = num(v.min), max = num(v.max);
      if (min === null && max === null && !v.obs) { toast('Anota al menos un peso u observación'); return false }
      const data = { date: DATE_RE.test(v.date) ? v.date : todayKey(), min: min ?? max, max: max ?? min, unit: UNITS.includes(v.unit) ? v.unit : 'kg', obs: clip(v.obs, 300) };
      if (data.min !== null && data.max !== null && data.min > data.max) [data.min, data.max] = [data.max, data.min];
      if (rec) Object.assign(rec, data);
      else { (fitness.records[e.id] = fitness.records[e.id] || []).push({ id: uid(), ...data }); fitness.records[e.id] = fitness.records[e.id].slice(-300) }
      saveFit(); renderRutina(); toast('Registro guardado');
      setTimeout(() => openExercise(day, e), 60);
    });
}

// ----- Comida -----
function renderDieta(){
  const box = $('#dieta'); box.innerHTML = '';
  const sorted = fitness.diets.slice().sort((a, b) => (b.month || '').localeCompare(a.month || ''));
  const chips = document.createElement('div'); chips.className = 'chips';
  sorted.forEach(dd => {
    const c = document.createElement('button'); c.className = 'chip' + (dd.id === fitness.activeDiet ? ' on' : '');
    c.textContent = dd.month ? `${dd.name} · ${monthLabel(dd.month).split(' ')[0]}` : dd.name;
    c.onclick = () => { fitness.activeDiet = dd.id; saveFit(); renderDieta() };
    chips.appendChild(c);
  });
  const add = document.createElement('button'); add.className = 'chip add'; add.textContent = '+ Nuevo protocolo';
  add.onclick = () => editDiet(null); chips.appendChild(add);
  box.appendChild(chips);

  const dt = activeDiet();
  if (!dt) {
    box.insertAdjacentHTML('beforeend', `<div class="empty-card"><h2 class="sec" style="margin-top:0">Agrega tu protocolo</h2>
      <p>Importa tu plan en archivo o escribe las comidas del protocolo de este mes.</p>
      <div class="actions"><button class="btn" data-a="imp">Importar plan</button><button class="btn ghost" data-a="new">Crear protocolo</button></div></div>`);
    box.querySelector('[data-a=imp]').onclick = () => $('#fileFit').click();
    box.querySelector('[data-a=new]').onclick = () => editDiet(null);
    return;
  }
  const log = todayLog();
  const done = dt.meals.filter(m => log.meals.includes(m.id)).length, total = dt.meals.length;
  const head = document.createElement('div'); head.className = 'diet-head';
  head.innerHTML = `<div><b>${esc(dt.name)}</b>${dt.kcal ? `<span>${esc(dt.kcal)} kcal</span> · ` : ''}<small style="color:var(--muted)">${dt.month ? esc(monthLabel(dt.month)) + ' · ' : ''}${total} comidas</small></div>
    <button class="icon-btn" aria-label="Opciones del protocolo">${DOTS}</button>`;
  head.querySelector('button').onclick = () => menu(dt.name, [
    ['Editar nombre, calorías y mes', () => editDiet(dt)],
    ['Reiniciar marcas de hoy', () => { log.meals = []; saveFit(); renderDieta() }],
    ['Exportar plan (respaldo)', exportFit],
    ['Importar plan', () => $('#fileFit').click()],
    ['Eliminar protocolo', () => { if (confirm(`¿Eliminar ${dt.name}?`)) { fitness.diets = fitness.diets.filter(x => x !== dt);
      fitness.activeDiet = fitness.diets[0]?.id || ''; saveFit(); renderDieta() } }, true]]);
  box.appendChild(head);
  box.insertAdjacentHTML('beforeend', `<div class="sec-head"><div><h2>Hoy</h2><p>${total ? `${done} de ${total} comidas` : 'Sin comidas todavía'}</p></div></div>
    <div class="meter"><i style="width:${total ? done / total * 100 : 0}%"></i></div>`);
  const ol = document.createElement('ol'); ol.className = 'items';
  dt.meals.forEach(m => {
    const isDone = log.meals.includes(m.id);
    const li = document.createElement('li'); li.className = 'item' + (isDone ? ' done' : '');
    li.innerHTML = `<span class="num" aria-hidden="true"></span>
      <button class="item-main"><b>${esc(m.name)}</b>${m.text ? `<div class="note" style="color:var(--text);opacity:.85">${esc(m.text)}</div>` : ''}</button>
      <button class="check" aria-pressed="${isDone}" aria-label="Marcar ${esc(m.name)} como hecha">${CHECK}</button>`;
    li.querySelector('.check').onclick = () => { toggleIn(log.meals, m.id); saveFit(); renderDieta() };
    li.querySelector('.item-main').onclick = () => editMeal(m);
    ol.appendChild(li);
  });
  box.appendChild(ol);
  const act = document.createElement('div'); act.className = 'actions';
  act.innerHTML = '<button class="btn">+ Agregar comida</button>';
  act.querySelector('button').onclick = () => editMeal(null);
  box.appendChild(act);
}
function editDiet(dt){
  const now = todayKey().slice(0, 7);
  formDialog(dt ? 'Editar protocolo' : 'Nuevo protocolo', [
    { key:'name', label:'Nombre', value: dt?.name, placeholder:'Ej. Protocolo Martin 5', max:60 },
    { key:'kcal', label:'Calorías al día', value: dt?.kcal, inputmode:'numeric', max:5, half:true },
    { key:'month', label:'Mes', type:'month', value: dt?.month || now, half:true }],
    v => {
      const data = { name: v.name || 'Protocolo', kcal: v.kcal.replace(/[^\d]/g, '').slice(0, 5), month: /^\d{4}-\d{2}$/.test(v.month) ? v.month : now };
      if (dt) Object.assign(dt, data);
      else {
        const prev = activeDiet();
        const copy = prev && prev.meals.length && confirm(`¿Empezar con las comidas de ${prev.name} para solo cambiar lo necesario?`);
        const nd = { id: uid(), ...data, meals: copy ? prev.meals.map(m => ({ id: uid(), name: m.name, text: m.text })) : [] };
        fitness.diets.push(nd); fitness.activeDiet = nd.id;
      }
      saveFit(); renderDieta();
    });
}
function editMeal(m){
  const dt = activeDiet();
  formDialog(m ? 'Editar comida' : 'Nueva comida', [
    { key:'name', label:'Nombre', value: m?.name || 'Comida ' + (dt.meals.length + 1), max:40 },
    { key:'text', label:'Qué lleva', type:'textarea', rows:4, value: m?.text, placeholder:'Alimentos y cantidades de tu protocolo', max:600 }],
    v => {
      const data = { name: v.name || 'Comida', text: v.text };
      if (m) Object.assign(m, data); else dt.meals.push({ id: uid(), ...data });
      saveFit(); renderDieta();
    },
    m ? () => { dt.meals = dt.meals.filter(x => x !== m); saveFit(); renderDieta() } : null);
}

// ----- Importar / exportar plan -----
function exportFit(){
  const a = document.createElement('a');
  const { routines, activeRoutine, diets, activeDiet, records } = fitness;
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ type: 'rolas-plan', routines, activeRoutine, diets, activeDiet, records }, null, 1)], { type: 'application/json' }));
  a.download = 'rolas-plan.json'; a.click();
}
$('#fileFit').onchange = async e => {
  try {
    const f = e.target.files[0]; if (!f || f.size > 2_000_000) throw 0;
    const data = JSON.parse(await f.text());
    if (!data || data.type !== 'rolas-plan') throw 0;
    const inc = cleanFitness(data);
    const dup = inc.routines.filter(r => fitness.routines.some(x => x.name === r.name));
    const replace = dup.length ? confirm(`Ya tienes ${dup.map(r => '“' + r.name + '”').join(', ')}. ¿Reemplazar con la versión del archivo? (Tus registros de peso de esa rutina se conservan solo si el ejercicio sigue existiendo.)`) : false;
    inc.routines.forEach(r => {
      const i = fitness.routines.findIndex(x => x.name === r.name);
      if (i < 0) fitness.routines.push(r); else if (replace) fitness.routines[i] = r;
    });
    if (fitness.routines.some(r => r.id === inc.activeRoutine)) fitness.activeRoutine = inc.activeRoutine;
    if (!fitness.activeRoutine) fitness.activeRoutine = fitness.routines[0]?.id || '';
    inc.diets.forEach(d => {
      const i = fitness.diets.findIndex(x => x.name === d.name && x.month === d.month);
      if (i < 0) fitness.diets.push(d); else fitness.diets[i] = d;
    });
    if (fitness.diets.some(d => d.id === inc.activeDiet)) fitness.activeDiet = inc.activeDiet;
    if (!fitness.activeDiet) fitness.activeDiet = fitness.diets[0]?.id || '';
    Object.entries(inc.records).forEach(([k, v]) => { if (!fitness.records[k]) fitness.records[k] = v });
    saveFit(); toast('Plan importado'); renderGym();
  } catch { toast('Ese archivo no es un plan de Rolas') }
  e.target.value = '';
};

// ---------- Nube (Supabase) ----------
let cloudTimer = null, cloudReady = false;
function scheduleCloud(){ if (!user || !cloudReady) return; clearTimeout(cloudTimer); cloudTimer = setTimeout(pushCloud, 1500) }
async function pushCloud(){
  if (!user || !cloudReady) return;
  const row = { user_id: user.id, library, recents, api_key: apiKey || null, fitness, updated_at: new Date().toISOString() };
  let { error } = await sb.from('user_data').upsert(row);
  if (error && /fitness/i.test(error.message)) {
    // La columna "fitness" aún no existe en Supabase: se guarda lo demás y la rutina queda en este dispositivo.
    delete row.fitness; ({ error } = await sb.from('user_data').upsert(row));
  }
  if (error) console.warn('No se pudo sincronizar:', error.message);
}
async function flushCloud(){ if (cloudTimer) { clearTimeout(cloudTimer); cloudTimer = null; await pushCloud() } }
async function pullCloud(){
  const { data, error } = await sb.from('user_data').select('*').eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  if (data) {
    // La nube manda: así ves lo mismo en el celular y en la PC.
    if (Array.isArray(data.library) && data.library.length) library = cleanLibrary(data.library);
    recents = cleanTracks(data.recents).slice(0, 20);
    apiKey = /^[\w-]{20,60}$/.test(data.api_key || '') ? data.api_key : '';
    if (data.fitness && (data.fitness.routines?.length || data.fitness.diets?.length || data.fitness.diet)) fitness = cleanFitness(data.fitness);
  }
  store.set('rolas.fitness', fitness);
  store.set('rolas.library', library); store.set('rolas.recents', recents); store.set('rolas.key', apiKey);
  cloudReady = true;
  if (!data) await pushCloud(); // primera vez: sube lo que ya tenías en este celular
}
function clearLocal(){
  ['rolas.library','rolas.queue','rolas.index','rolas.recents','rolas.key','rolas.fitness'].forEach(k => { try { localStorage.removeItem(k) } catch {} });
  library = [{ id:'fav', name:'Me gustan', tracks:[] }]; queue = []; index = -1; recents = []; apiKey = ''; fitness = emptyFitness();
}

// ---------- Acceso ----------
let authMode = 'login'; // login | signup | reset
function setAuthMode(m){
  authMode = m; $('#authMsg').textContent = ''; $('#authMsg').className = 'msg';
  $('#pass2Wrap').hidden = m !== 'signup'; $('#passWrap').hidden = m === 'reset';
  $('#authPass').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
  $('#authSubmit').textContent = { login:'Iniciar sesión', signup:'Crear cuenta', reset:'Enviar enlace' }[m];
  $('#authLead').textContent = { login:'Inicia sesión para escuchar tu música.', signup:'Crea tu cuenta. Te enviaremos un correo para confirmarla.',
    reset:'Escribe tu correo y te enviaremos un enlace para cambiar tu contraseña.' }[m];
  $('#authSwitch').textContent = m === 'login' ? 'Crear cuenta' : 'Ya tengo cuenta';
  $('#authForgot').hidden = m !== 'login';
}
$('#authSwitch').onclick = () => setAuthMode(authMode === 'login' ? 'signup' : 'login');
$('#authForgot').onclick = () => setAuthMode('reset');
function authMsg(text, ok = false){ const m = $('#authMsg'); m.textContent = text; m.className = 'msg ' + (ok ? 'ok' : 'err') }
function niceError(e){
  const m = (e?.message || '').toLowerCase();
  if (m.includes('invalid login')) return 'Correo o contraseña incorrectos.';
  if (m.includes('not confirmed')) return 'Primero confirma tu cuenta con el enlace que te llegó al correo.';
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) return 'El registro de cuentas nuevas está cerrado.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Demasiados intentos. Espera unos minutos y vuelve a intentar.';
  if (m.includes('already registered')) return 'Ese correo ya tiene cuenta. Inicia sesión.';
  if (m.includes('password')) return 'La contraseña no cumple los requisitos: mínimo 8 caracteres.';
  return 'No se pudo completar: ' + (e?.message || 'error desconocido');
}
const appUrl = location.origin + location.pathname;
$('#authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#authEmail').value.trim(), pass = $('#authPass').value;
  if (!/^\S+@\S+\.\S+$/.test(email)) return authMsg('Escribe un correo válido.');
  const btn = $('#authSubmit'); btn.disabled = true;
  try {
    if (authMode === 'reset') {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl });
      if (error) throw error;
      authMsg('Si el correo tiene cuenta, te llegará un enlace para cambiar la contraseña.', true);
    } else if (pass.length < 8) {
      authMsg('La contraseña debe tener al menos 8 caracteres.');
    } else if (authMode === 'signup') {
      if (pass !== $('#authPass2').value) { authMsg('Las contraseñas no coinciden.'); return }
      const { data, error } = await sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: appUrl } });
      if (error) throw error;
      if (!data.session) { authMsg('Listo. Revisa tu correo y abre el enlace para confirmar tu cuenta.', true); setTimeout(() => setAuthMode('login'), 4000) }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
    }
  } catch (err) { authMsg(niceError(err)) }
  finally { btn.disabled = false }
});

let booted = false;
async function enterApp(u){
  if (booted && user?.id === u.id) return;
  user = u; booted = true;
  try { await pullCloud() } catch (err) { console.warn(err); cloudReady = true }
  document.body.classList.remove('locked');
  $('#authPass').value = $('#authPass2').value = '';
  showView('inicio'); renderQueue();
  if (current()) showTrackInfo(current()); else { $('#mini').hidden = true; placeVideo() }
  $('#searchHint').textContent = apiKey ? '' : 'Pega el link de un video de YouTube, o agrega tu API key en Ajustes para buscar por nombre.';
}
function leaveApp(wipe = false){
  user = null; cloudReady = false; booted = false;
  if (ready) { try { player.stopVideo() } catch {} } keepAlive(false);
  // Solo se borran los datos del dispositivo al cerrar sesión a propósito, no al abrir la app sin sesión.
  if (wipe) clearLocal();
  closeSheet();
  $('#results').innerHTML = ''; lastResults = [];
  document.body.classList.add('locked'); setAuthMode('login');
}
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    setTimeout(async () => {
      const np = prompt('Escribe tu nueva contraseña (mínimo 8 caracteres):');
      if (np && np.length >= 8) {
        const { error } = await sb.auth.updateUser({ password: np });
        toast(error ? 'No se pudo cambiar la contraseña' : 'Contraseña actualizada');
      }
    }, 300);
  }
  if (session?.user && (!booted || user?.id !== session.user.id)) enterApp(session.user);
  if (!session && event === 'SIGNED_OUT') leaveApp(true);
});
(async () => {
  const { data } = await sb.auth.getSession();
  if (data.session?.user) { if (!booted) enterApp(data.session.user) } else leaveApp();
})();
window.addEventListener('pagehide', () => { flushCloud() });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
