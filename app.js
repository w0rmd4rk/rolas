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
  $('#greet').textContent = { inicio: greeting(), buscar: 'Buscar', biblioteca: 'Tu biblioteca', cola: 'Cola' }[name];
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

// ---------- Nube (Supabase) ----------
let cloudTimer = null, cloudReady = false;
function scheduleCloud(){ if (!user || !cloudReady) return; clearTimeout(cloudTimer); cloudTimer = setTimeout(pushCloud, 1500) }
async function pushCloud(){
  if (!user || !cloudReady) return;
  const { error } = await sb.from('user_data').upsert({ user_id: user.id, library, recents, api_key: apiKey || null, updated_at: new Date().toISOString() });
  if (error) console.warn('No se pudo sincronizar:', error.message);
}
async function flushCloud(){ if (cloudTimer) { clearTimeout(cloudTimer); cloudTimer = null; await pushCloud() } }
async function pullCloud(){
  const { data, error } = await sb.from('user_data').select('library, recents, api_key').eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  if (data) {
    // La nube manda: así ves lo mismo en el celular y en la PC.
    if (Array.isArray(data.library) && data.library.length) library = cleanLibrary(data.library);
    recents = cleanTracks(data.recents).slice(0, 20);
    apiKey = /^[\w-]{20,60}$/.test(data.api_key || '') ? data.api_key : '';
  }
  store.set('rolas.library', library); store.set('rolas.recents', recents); store.set('rolas.key', apiKey);
  cloudReady = true;
  if (!data) await pushCloud(); // primera vez: sube lo que ya tenías en este celular
}
function clearLocal(){
  ['rolas.library','rolas.queue','rolas.index','rolas.recents','rolas.key'].forEach(k => { try { localStorage.removeItem(k) } catch {} });
  library = [{ id:'fav', name:'Me gustan', tracks:[] }]; queue = []; index = -1; recents = []; apiKey = '';
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
function leaveApp(){
  user = null; cloudReady = false; booted = false;
  if (ready) { try { player.stopVideo() } catch {} } keepAlive(false);
  clearLocal(); closeSheet();
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
  if (!session && event === 'SIGNED_OUT') leaveApp();
});
(async () => {
  const { data } = await sb.auth.getSession();
  if (data.session?.user) { if (!booted) enterApp(data.session.user) } else leaveApp();
})();
window.addEventListener('pagehide', () => { flushCloud() });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
