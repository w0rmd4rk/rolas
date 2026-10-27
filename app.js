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
// Contexto para seguir llenando la cola cuando se acaba: la búsqueda que la originó y su siguiente página.
let queueCtx = null, extending = false;
let autoContinue = store.get('rolas.autocont', true);
let player, ready = false, pendingTrack = null, userPaused = false;

const save = () => { scheduleCloud(); store.set('rolas.library', library); store.set('rolas.queue', queue); store.set('rolas.index', index);
  store.set('rolas.recents', recents); store.set('rolas.shuffle', shuffle); store.set('rolas.repeat', repeat) };
const ID_RE = /^[A-Za-z0-9_-]{11}$/;
// Imágenes: con ahorro de datos se piden las versiones más chicas que tiene YouTube (default ≈ 4 KB, mq ≈ 15 KB, hq ≈ 30 KB).
const img = (id, size) => `https://i.ytimg.com/vi/${ID_RE.test(id) ? id : 'invalid'}/${size}.jpg`;
const thumb = id => img(id, (typeof dataSaver !== 'undefined' && dataSaver) ? 'default' : 'mqdefault');
const bigImg = id => img(id, (typeof dataSaver !== 'undefined' && dataSaver) ? 'mqdefault' : 'hqdefault');
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
let openPl = null; // id de la playlist abierta en Tu biblioteca (null = vista de lista)
let ytPl = null;   // playlist de YouTube abierta desde Buscar → Playlists (null = resultados)
function showView(name){
  currentView = name;
  document.querySelectorAll('.tabbar button').forEach(x => x.setAttribute('aria-selected', x.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-'+name));
  $('#greet').textContent = { inicio: greeting(), buscar: 'Buscar', biblioteca: 'Tu biblioteca', cola: 'Cola', gym: 'Salud' }[name];
  if (name === 'gym') renderGym();
  if (name === 'inicio') renderHome();
  if (name === 'biblioteca') renderLibrary();
  if (name === 'cola') renderQueue();
  if (name === 'buscar') setTimeout(() => !lastResults.length && !ytPl && searchTab === 'songs' && $('#q').focus(), 50);
  $('main').scrollTop = 0;
}
function greeting(){ const h = new Date().getHours(); return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches' }
document.querySelectorAll('.tabbar button').forEach(b => b.onclick = () => {
  // Tocar otra vez "Tu biblioteca" desde el detalle regresa a la lista, como en Spotify.
  if (b.dataset.view === 'biblioteca' && currentView === 'biblioteca' && openPl) closePlaylist();
  else if (b.dataset.view === 'buscar' && currentView === 'buscar' && ytPl) closeYtPlaylist();
  else showView(b.dataset.view);
});

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
// Botón Atrás de Android: cierra la pantalla grande y luego el detalle de la playlist.
window.addEventListener('popstate', () => {
  const st = history.state || {};
  if (sheetOpen && !st.sheet) closeSheet();
  if (st.sheet) return;
  if (openPl && !st.pl) { openPl = null; renderLibrary(); $('main').scrollTop = 0 }
  if (ytPl && !st.ytpl) { ytPl = null; renderYtPlaylist(); $('main').scrollTop = 0 }
});

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
        if (e.data === YT.PlayerState.PLAYING) { keepAlive(true); countPlay() }
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
  $('#stage').style.backgroundImage = `url(${bigImg(t.id)})`;
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
      artwork: [{ src: bigImg(t.id), sizes: dataSaver ? '320x180' : '480x360', type:'image/jpeg' }] });
  }
  renderQueue(); markPlaying();
  if (autoplay && index >= queue.length - 2) extendQueue();
}

// Cuando quedan 2 canciones o menos, trae más: primero la siguiente página de la búsqueda; si ya no hay,
// y está activada la reproducción continua, busca más canciones del mismo artista.
async function extendQueue(){
  if (extending || !apiKey || !queue.length || sleep?.mode === 'end') return;
  let ctx = queueCtx;
  if (!ctx?.page) {
    if (!autoContinue) return;
    const artist = clip(String(queue[queue.length - 1]?.channel || '').replace(/VEVO$|\s*-\s*Topic$/i, '').trim(), 80);
    if (!artist) return;
    ctx = { query: artist, page: '' };
  }
  extending = true;
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=${dataSaver ? 20 : 50}&regionCode=MX&relevanceLanguage=es&q=${encodeURIComponent(ctx.query)}&key=${apiKey}${ctx.page ? '&pageToken=' + ctx.page : ''}`;
    const j = await (await fetch(url)).json();
    if (j.error) throw new Error(j.error.message);
    const have = new Set([...queue, ...recents].map(t => t.id));
    let items = j.items.filter(it => ID_RE.test(it.id?.videoId) && !have.has(it.id.videoId))
      .map(it => cleanTrack({ id: it.id.videoId, title: decode(it.snippet.title), channel: decode(it.snippet.channelTitle) }));
    if (shuffle) items.sort(() => Math.random() - .5);
    queueCtx = { query: ctx.query, page: j.nextPageToken || '' };
    if (items.length) { queue.push(...items); save(); renderQueue() }
  } catch (err) { console.warn('No se pudo continuar la cola:', err.message) }
  finally { extending = false }
}

function playList(tracks, start = 0, source = ''){
  if (!tracks.length) return;
  queueSource = source;
  queueCtx = source.startsWith('search:') ? { query: source.slice(7), page: nextPage } : null;
  queue = tracks.slice(); index = start;
  if (shuffle) { const first = queue.splice(start,1)[0]; queue.sort(()=>Math.random()-.5); queue.unshift(first); index = 0 }
  save(); loadTrack(queue[index]);
}
function playNow(t){ queue.splice(index+1, 0, t); index++; save(); loadTrack(t) }
function enqueue(t){ queue.push(t); if (index < 0) { index = 0; loadTrack(t) } save(); toast('Agregada a la cola'); renderQueue() }
function next(auto = false){
  if (!queue.length) return;
  if (!auto) countSkip();
  if (auto && sleep?.mode === 'end' && index >= queue.length - 1) { stopSleep(true); keepAlive(false); return setPlayIcon(false) }
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
const PLID_RE = /^[\w-]{10,64}$/;
function playlistIdFrom(text){ const m = text.match(/[?&]list=([\w-]+)/); return m && PLID_RE.test(m[1]) ? m[1] : null }
async function infoFor(id){
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v='+id)}&format=json`);
    if (r.ok) { const j = await r.json(); return { id, title: j.title, channel: j.author_name } }
  } catch {}
  return { id, title: 'Video ' + id, channel: 'YouTube' };
}
let lastSearchAt = 0, searchQ = '', searchTab = 'songs';
async function search(){
  const q = clip($('#q').value.trim(), 150); if (!q) return;
  if (Date.now() - lastSearchAt < 2000) return toast('Espera un momento entre búsquedas');
  lastSearchAt = Date.now();
  $('#q').blur();
  if (ytPl) closeYtPlaylist();
  const listId = playlistIdFrom(q), vid = videoIdFrom(q);
  if ((listId && apiKey) || vid) { searchQ = ''; setSearchTab('songs') }
  if (listId && apiKey) return importPlaylist(listId);
  if (vid) { renderResults([cleanTrack(await infoFor(vid))].filter(Boolean)); $('#searchHint').textContent = ''; return }
  searchQ = q;
  // Solo se busca en la pestaña abierta; la otra busca cuando el usuario la abre (ahorra cuota de la API).
  if (searchTab === 'lists') return searchPlaylists();
  searchSongs();
}
function searchSongs(){
  if (!apiKey) { $('#searchHint').textContent = 'Para buscar por nombre agrega tu API key en Ajustes. Mientras, pega el link de un video.'; return }
  lastQuery = searchQ; nextPage = ''; lastResults = [];
  $('#searchHint').textContent = 'Buscando…';
  return fetchResults();
}
function setSearchTab(t){
  searchTab = t;
  document.querySelectorAll('#sTabs .chip').forEach(b => { b.classList.toggle('on', b.dataset.st === t); b.setAttribute('aria-selected', b.dataset.st === t) });
  $('#songsPane').hidden = t !== 'songs'; $('#listsPane').hidden = t !== 'lists';
  if (!searchQ) return;
  if (t === 'lists' && plQuery !== searchQ) searchPlaylists();
  if (t === 'songs' && lastQuery !== searchQ) searchSongs();
}
document.querySelectorAll('#sTabs .chip').forEach(b => b.onclick = () => setSearchTab(b.dataset.st));
async function fetchResults(){
  $('#moreBtn')?.remove();
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=${dataSaver ? 20 : 50}&regionCode=MX&relevanceLanguage=es&q=${encodeURIComponent(lastQuery)}&key=${apiKey}${nextPage ? '&pageToken=' + nextPage : ''}`;
    const j = await (await fetch(url)).json();
    if (j.error) throw new Error(j.error.message);
    const seen = new Set(lastResults.map(t => t.id));
    const items = j.items.filter(it => ID_RE.test(it.id?.videoId) && !seen.has(it.id.videoId))
      .map(it => cleanTrack({ id: it.id.videoId, title: decode(it.snippet.title), channel: decode(it.snippet.channelTitle) }));
    nextPage = j.nextPageToken || '';
    renderResults([...lastResults, ...items]);
    if (queueSource === 'search:' + lastQuery && queueCtx) queueCtx.page = nextPage;
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
async function ytApi(path){
  const j = await (await fetch(`https://www.googleapis.com/youtube/v3/${path}&key=${encodeURIComponent(apiKey)}`)).json();
  if (j.error) throw new Error(j.error.message);
  return j;
}
// Canciones de una playlist de YouTube, ya limpias. onPage recibe lo cargado hasta el momento; si regresa false, se detiene.
async function loadPlaylistTracks(listId, max = 500, onPage){
  if (!PLID_RE.test(listId)) throw new Error('playlist no válida');
  const tracks = [], seen = new Set(); let page = '';
  do {
    const j = await ytApi(`playlistItems?part=snippet&maxResults=50&playlistId=${listId}${page ? '&pageToken=' + encodeURIComponent(page) : ''}`);
    (Array.isArray(j.items) ? j.items : []).forEach(i => {
      const sn = i?.snippet || {};
      if (/^(Private|Deleted) video$/.test(sn.title)) return;
      const t = cleanTrack({ id: sn.resourceId?.videoId, title: decode(sn.title || ''), channel: decode(sn.videoOwnerChannelTitle || '') });
      if (t && !seen.has(t.id)) { seen.add(t.id); tracks.push(t) }
    });
    page = typeof j.nextPageToken === 'string' ? j.nextPageToken : '';
    if (onPage && onPage(tracks.slice()) === false) break;
  } while (page && tracks.length < max);
  return tracks.slice(0, max);
}
async function importPlaylist(listId){
  $('#searchHint').textContent = 'Importando playlist…';
  try {
    let name = 'Playlist importada';
    const info = await ytApi(`playlists?part=snippet&id=${listId}`);
    if (info.items?.[0]) name = clip(decode(info.items[0].snippet?.title || ''), 80) || name;
    const tracks = await loadPlaylistTracks(listId);
    library.unshift({ id: 'pl' + Date.now(), name, tracks }); save();
    $('#searchHint').textContent = `Importada “${name}” con ${nSongs(tracks.length)}. Está en Tu biblioteca.`;
  } catch (err) { $('#searchHint').textContent = 'No se pudo importar: ' + err.message }
}

// ----- Buscar → Playlists -----
let plQuery = '', plList = [];
const plCount = v => { const n = parseInt(v, 10); return n >= 0 ? Math.min(n, 99999) : null };
// Limpieza de un resultado de playlist de YouTube: ID válido, textos recortados y portada como ID de video.
function cleanYtList(x){
  return x && PLID_RE.test(x.id) ? { id: x.id, title: clip(x.title, 200) || 'Playlist', channel: clip(x.channel, 120),
    count: plCount(x.count), cover: ID_RE.test(x.cover) ? x.cover : '' } : null;
}
function coverIdFrom(th){
  const u = String(th?.medium?.url || th?.high?.url || th?.default?.url || '');
  const m = u.match(/^https:\/\/i\.ytimg\.com\/vi\/([\w-]{11})\//); return m ? m[1] : '';
}
async function searchPlaylists(){
  const q = searchQ, ul = $('#plResults');
  plQuery = q; plList = []; ul.innerHTML = '';
  if (!apiKey) { $('#plHint').textContent = 'Para buscar playlists agrega tu API key en Ajustes.'; return }
  $('#plHint').textContent = 'Buscando playlists…';
  try {
    const j = await ytApi(`search?part=snippet&type=playlist&maxResults=20&regionCode=MX&relevanceLanguage=es&q=${encodeURIComponent(q)}`);
    const items = (Array.isArray(j.items) ? j.items : []).map(it => cleanYtList({ id: it?.id?.playlistId,
      title: decode(it?.snippet?.title || ''), channel: decode(it?.snippet?.channelTitle || ''), cover: coverIdFrom(it?.snippet?.thumbnails) })).filter(Boolean);
    // El número de canciones no viene en la búsqueda: se pide en una sola llamada barata (1 unidad).
    if (items.length) try {
      const c = await ytApi(`playlists?part=contentDetails&maxResults=50&id=${items.map(x => x.id).join(',')}`);
      (Array.isArray(c.items) ? c.items : []).forEach(p => { const x = items.find(i => i.id === p?.id); if (x) x.count = plCount(p.contentDetails?.itemCount) });
    } catch {}
    if (plQuery !== q) return; // llegó tarde: ya se buscó otra cosa
    plList = items; renderPlResults();
    $('#plHint').textContent = items.length ? '' : 'Sin playlists. Prueba con otro nombre.';
  } catch (err) { if (plQuery === q) $('#plHint').textContent = 'La búsqueda falló: ' + err.message + '. Revisa tu API key en Ajustes.' }
}
function renderPlResults(){
  const ul = $('#plResults'); ul.innerHTML = '';
  plList.forEach(x => {
    const li = document.createElement('li');
    li.innerHTML = `<button class="pl-row">${coverFor(x.cover ? [{ id: x.cover }] : [])}<span><b class="t-title">${esc(x.title)}</b>
      <span class="t-sub">${esc(x.channel || 'YouTube')}${x.count !== null ? ' · ' + nSongs(x.count) : ''}</span></span></button>`;
    li.firstChild.onclick = () => openYtPlaylist(x);
    ul.appendChild(li);
  });
}
function openYtPlaylist(x){
  if (history.state?.ytpl) history.replaceState({ ytpl: x.id }, ''); else history.pushState({ ytpl: x.id }, '');
  const p = ytPl = { ...x, tracks: [], loading: true, error: '', saved: false };
  renderYtPlaylist(); $('main').scrollTop = 0;
  loadPlaylistTracks(p.id, 500, t => { if (ytPl !== p) return false; p.tracks = t; renderYtPlaylist() })
    .then(t => { p.tracks = t }, err => { p.error = err.message })
    .finally(() => { p.loading = false; if (ytPl === p) renderYtPlaylist() });
}
function closeYtPlaylist(){
  if (history.state?.ytpl) return history.back(); // el popstate regresa a los resultados
  ytPl = null; renderYtPlaylist(); $('main').scrollTop = 0;
}
function renderYtPlaylist(){
  const v = $('#ytPlView'), p = ytPl;
  $('#qBar').hidden = $('#sTabs').hidden = !!p;
  $('#songsPane').hidden = !!p || searchTab !== 'songs'; $('#listsPane').hidden = !!p || searchTab !== 'lists';
  v.hidden = !p; v.innerHTML = '';
  if (!p) return;
  const head = plHeader({ cover: coverFor(p.tracks.length ? p.tracks : p.cover ? [{ id: p.cover }] : []), title: p.title,
    sub: `${esc(p.channel || 'YouTube')} · ${nSongs(p.loading && p.count !== null ? p.count : p.tracks.length)}`, back: closeYtPlaylist, backLabel: 'Regresar a los resultados',
    tracks: p.tracks,
    extra: `<button class="btn ghost pl-save" data-a="save" ${p.loading || !p.tracks.length || p.saved ? 'disabled' : ''}>${p.saved ? 'Guardada ✓' : 'Guardar en mi biblioteca'}</button>` });
  head.querySelector('[data-a=save]').onclick = () => {
    library.unshift({ id: 'pl' + Date.now(), name: clip(p.title, 80), tracks: cleanTracks(p.tracks) }); save();
    p.saved = true; renderYtPlaylist(); toast('Guardada en Tu biblioteca');
  };
  v.appendChild(head);
  const ul = document.createElement('ul'); ul.className = 'list';
  if (p.error) ul.innerHTML = `<li class="empty">No se pudieron cargar las canciones: ${esc(p.error)}</li>`;
  else if (p.loading && !p.tracks.length) ul.innerHTML = '<li class="empty">Cargando canciones…</li>';
  else if (!p.tracks.length) ul.innerHTML = '<li class="empty">Esta playlist no tiene canciones disponibles.</li>';
  p.tracks.forEach((t, i) => ul.appendChild(trackRow(t, { add:true, queue:true, onPlay: () => playList(p.tracks, i) })));
  v.appendChild(ul);
  markPlaying();
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
  if (!recents.length && library.length === 1 && !library[0].tracks.length) {
    box.innerHTML = `<div class="welcome"><h2 class="sec" style="margin-top:0">Empieza a escuchar</h2>
      <p>Busca una canción, tócala para reproducirla y guárdala en tus playlists con el botón +.</p>
      <button class="btn" id="goSearch">Buscar música</button></div>`;
    $('#goSearch').onclick = () => showView('buscar'); return;
  }
  const grid = document.createElement('div'); grid.className = 'grid';
  library.slice(0, 8).forEach(pl => {
    const b = document.createElement('button'); b.className = 'tile';
    b.innerHTML = `${coverFor(pl.tracks)}<b>${esc(pl.name)}</b>`;
    b.onclick = () => pl.tracks.length ? playList(pl.tracks, 0) : openPlaylist(pl.id);
    grid.appendChild(b);
  });
  if (grid.children.length) box.appendChild(grid);
  if (recents.length) {
    box.insertAdjacentHTML('beforeend', '<h2 class="sec">Escuchado recientemente</h2>');
    const shelf = document.createElement('div'); shelf.className = 'shelf';
    recents.forEach(t => {
      const c = document.createElement('button'); c.className = 'card';
      c.innerHTML = `<img src="${esc(bigImg(t.id))}" alt="" loading="lazy"><b>${esc(t.title)}</b><span>${esc(t.channel)}</span>`;
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
const ICON_BACK = '<svg viewBox="0 0 24 24"><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/></svg>';
const ICON_SHUF = '<svg viewBox="0 0 24 24"><path d="M14 4h6v6l-2.3-2.3-4.3 4.3-1.4-1.4 4.3-4.3zM4 5.4 5.4 4 20 18.6 18.6 20zM14 20v-2h2.6l-3.2-3.2 1.4-1.4 3.2 3.2V14h2v6z"/></svg>';
const nSongs = n => `${n} ${n === 1 ? 'canción' : 'canciones'}`;
function renderLibrary(){
  const box = $('#library'); box.innerHTML = '';
  const pl = openPl && library.find(p => p.id === openPl);
  if (openPl && !pl) openPl = null; // la playlist ya no existe (se borró o cambió en la nube)
  $('#plBar').hidden = !!pl;
  if (pl) return renderPlaylist(box, pl);
  const ul = document.createElement('ul'); ul.className = 'list';
  library.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<button class="pl-row">${coverFor(p.tracks)}<span><b class="t-title">${esc(p.name)}</b><span class="t-sub">Playlist · ${nSongs(p.tracks.length)}</span></span></button>`;
    li.firstChild.onclick = () => openPlaylist(p.id);
    ul.appendChild(li);
  });
  box.appendChild(ul);
}
// Encabezado del detalle de playlist (biblioteca y YouTube). `sub` y `extra` ya deben venir escapados.
function plHeader({ cover, title, sub, back, backLabel, tracks, extra }){
  const head = document.createElement('div'); head.className = 'pl-detail';
  head.innerHTML = `<button class="icon-btn pl-back" data-a="back" aria-label="${esc(backLabel)}">${ICON_BACK}</button>
    ${cover}
    <h2>${esc(title)}</h2><div class="t-sub">${sub}</div>
    <div class="pl-actions">
      <button class="icon-btn" data-a="shuf" aria-label="Reproducir en aleatorio" ${tracks.length ? '' : 'disabled'}>${ICON_SHUF}</button>
      ${extra}
      <button class="pl-play" data-a="play" aria-label="Reproducir playlist" ${tracks.length ? '' : 'disabled'}><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
    </div>`;
  head.querySelector('[data-a=back]').onclick = back;
  head.querySelector('[data-a=play]').onclick = () => playList(tracks, 0);
  head.querySelector('[data-a=shuf]').onclick = () => {
    if (!shuffle) { shuffle = true; save(); paintModes(); toast('Aleatorio activado') }
    playList(tracks, Math.floor(Math.random() * tracks.length));
  };
  return head;
}
function renderPlaylist(box, pl){
  const head = plHeader({ cover: coverFor(pl.tracks), title: pl.name, sub: `Playlist · ${nSongs(pl.tracks.length)}`,
    back: closePlaylist, backLabel: 'Regresar a Tu biblioteca', tracks: pl.tracks,
    extra: `<button class="icon-btn" data-a="more" aria-label="Más opciones">${DOTS}</button>` });
  head.querySelector('[data-a=more]').onclick = () => menu(pl.name, [
    ['Renombrar', () => formDialog('Renombrar playlist', [{ key: 'name', label: 'Nombre', value: pl.name, max: 80 }], v => {
      if (!v.name) { toast('Escribe un nombre'); return false }
      pl.name = clip(v.name, 80); save(); renderLibrary();
    })],
    ...(pl.id !== 'fav' ? [['Eliminar playlist', () => {
      if (confirm(`¿Eliminar la playlist “${pl.name}”?`)) { library = library.filter(p => p !== pl); save(); closePlaylist(); toast('Playlist eliminada') }
    }, true]] : [])
  ]);
  box.appendChild(head);
  const ul = document.createElement('ul'); ul.className = 'list';
  if (!pl.tracks.length) ul.innerHTML = '<li class="empty">Vacía. Agrega canciones desde Buscar con el botón +.</li>';
  pl.tracks.forEach((t, i) => ul.appendChild(trackRow(t, { queue:true, del:true, onPlay: () => playList(pl.tracks, i),
    onDel: () => { pl.tracks.splice(i,1); save(); renderLibrary() } })));
  box.appendChild(ul);
  markPlaying();
}
function openPlaylist(id){
  // Una entrada en el historial para que Atrás regrese a la lista.
  if (history.state?.pl) history.replaceState({ pl: id }, ''); else history.pushState({ pl: id }, '');
  openPl = id;
  if (currentView === 'biblioteca') { renderLibrary(); $('main').scrollTop = 0 } else showView('biblioteca');
}
function closePlaylist(){
  if (history.state?.pl) return history.back(); // el popstate regresa a la lista
  openPl = null; renderLibrary(); $('main').scrollTop = 0;
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
  document.querySelectorAll('#results .track, #library .track, #ytPlView .track').forEach(li => li.classList.toggle('playing', li.dataset.id === cur));
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
  library.unshift({ id: 'pl' + Date.now(), name: clip(name, 80), tracks: [] }); $('#newPl').value = ''; save(); renderLibrary();
};
$('#btnClearQ').onclick = () => { queue = current() ? [current()] : []; index = queue.length ? 0 : -1; save(); renderQueue() };

document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

// ---------- Ajustes ----------
$('#btnSettings').onclick = () => { $('#accEmail').textContent = user?.email || ''; $('#apiKey').value = apiKey; $('#saver').checked = dataSaver; $('#autocont').checked = autoContinue; $('#dlgSettings').showModal() };
$('#autocont').onchange = e => { autoContinue = e.target.checked; store.set('rolas.autocont', autoContinue) };
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
    meals: arr(d.meals, 12).filter(m => m && typeof m === 'object').map(m => ({ id: okId(m.id), name: clip(m.name, 40) || 'Comida', text: clip(m.text, 600), kcal: num(m.kcal) })) };
}
function cleanFitness(f){
  if (!f || typeof f !== 'object') return emptyFitness();
  const routines = arr(f.routines, 20).filter(r => r && typeof r === 'object').map(r => ({
    id: okId(r.id), name: clip(r.name, 60) || 'Rutina',
    days: arr(r.days, 14).filter(d => d && typeof d === 'object').map(d => ({
      id: okId(d.id), name: clip(d.name, 40) || 'Día', focus: clip(d.focus, 60),
      exercises: arr(d.exercises, 60).filter(e => e && typeof e === 'object').map(e => ({
        id: okId(e.id), name: clip(e.name, 120) || 'Ejercicio', sets: clip(e.sets, 80), reps: clip(e.reps, 140),
        rest: (n => n !== null && n >= 15 && n <= 900 ? Math.round(n) : null)(num(e.rest)),
        tags: arr(e.tags, 11).filter(t => TAGS.includes(t)), notes: clip(e.notes, 600) }))
    })),
    recs: arr(r.recs, 20).map(x => clip(x, 300)).filter(Boolean)
  }));
  // "diet" (versión anterior, una sola dieta) se convierte en la lista "diets"
  const rawDiets = Array.isArray(f.diets) ? f.diets : (f.diet && typeof f.diet === 'object' ? [f.diet] : []);
  const diets = arr(rawDiets, 36).filter(d => d && typeof d === 'object').map(cleanDiet);
  const log = {};
  Object.keys(f.log && typeof f.log === 'object' ? f.log : {}).filter(k => DATE_RE.test(k)).sort().slice(-370).forEach(k => {
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
  const metrics = arr(f.metrics, 15).filter(m => m && typeof m === 'object').map(m => ({ id: okId(m.id), name: clip(m.name, 30) || 'Medida', unit: clip(m.unit, 10) }));
  if (!metrics.length) metrics.push(...defaultMetrics());
  const ids = new Set(metrics.map(m => m.id));
  const body = arr(f.body, 500).filter(b => b && DATE_RE.test(b.date)).map(b => {
    const values = {};
    Object.keys(b.values && typeof b.values === 'object' ? b.values : {}).forEach(k => { const v = num(b.values[k]); if (ids.has(k) && v !== null) values[k] = v });
    return { id: okId(b.id), date: b.date, values, obs: clip(b.obs, 300) };
  }).filter(b => Object.keys(b.values).length || b.obs);
  return {
    metrics, body,
    routines, activeRoutine: routines.some(r => r.id === f.activeRoutine) ? f.activeRoutine : routines[0]?.id || '',
    diets, activeDiet: diets.some(d => d.id === f.activeDiet) ? f.activeDiet : diets[0]?.id || '',
    log, records,
    sessions: arr(f.sessions, 300).filter(x => x && DATE_RE.test(x.date)).map(x => ({ id: okId(x.id), date: x.date,
      rname: clip(x.rname, 60), dname: clip(x.dname, 60), dur: num(x.dur) ?? 0, sets: num(x.sets) ?? 0, total: num(x.total) ?? 0,
      avgRest: num(x.avgRest), avgTarget: num(x.avgTarget), short: num(x.short) ?? 0, long: num(x.long) ?? 0 }))
  };
}
function defaultMetrics(){ return [{ id: 'peso', name: 'Peso', unit: 'kg' }] }
function emptyFitness(){ return { metrics: defaultMetrics(), body: [], routines: [], activeRoutine: '', diets: [], activeDiet: '', log: {}, records: {}, sessions: [] } }

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
  ['ejercicio:rutina','comida:dieta','dormir:dormir','progreso:progreso'].forEach(x => { const [t, id] = x.split(':'); $('#' + id).hidden = gymTab !== t });
  ({ ejercicio: renderRutina, comida: renderDieta, dormir: renderDormir, progreso: renderProgreso }[gymTab] || renderRutina)();
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
  if (r) {
    const bar = document.createElement('div'); bar.className = 'crud';
    bar.innerHTML = `<span>${esc(r.name)}</span><button class="btn ghost sm" data-a="ren">Renombrar</button><button class="icon-btn" aria-label="Más opciones de la rutina">${DOTS}</button>`;
    bar.querySelector('[data-a=ren]').onclick = () => renameRoutine(r);
    bar.querySelector('.icon-btn').onclick = () => routineMenu(r);
    box.appendChild(bar);
  }
  if (!r) {
    box.insertAdjacentHTML('beforeend', `<div class="empty-card"><h2 class="sec" style="margin-top:0">Agrega tu rutina</h2>
      <p>Importa tu plan en archivo o crea una rutina desde cero con los ejercicios de tu entrenador.</p>
      <div class="actions"><button class="btn" data-a="imp">Importar plan</button><button class="btn ghost" data-a="paste">Pegar plan</button><button class="btn ghost" data-a="new">Crear rutina</button></div></div>`);
    box.querySelector('[data-a=imp]').onclick = () => $('#fileFit').click();
    box.querySelector('[data-a=new]').onclick = newRoutine;
    box.querySelector('[data-a=paste]').onclick = pastePlan;
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
    if (total) box.appendChild(sessionPanel(r, d));

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
      if (session && session.did === d.id) li.appendChild(setRow(e));
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
  det.querySelector('[data-a=opts]').onclick = () => routineMenu(r);
  box.appendChild(det);
}
function renameRoutine(r){
  formDialog('Nombre de la rutina', [{ key:'name', label:'Nombre', value:r.name, max:60 }], v => { r.name = v.name || r.name; saveFit(); renderRutina() });
}
function routineMenu(r){
  menu(r.name, [
    ['Renombrar', () => renameRoutine(r)],
    ['Duplicar rutina', () => {
      const c = JSON.parse(JSON.stringify(r)); c.id = uid(); c.name = clip(r.name + ' (copia)', 60);
      c.days.forEach(d => { d.id = uid(); d.exercises.forEach(e => e.id = uid()) });
      fitness.routines.push(c); fitness.activeRoutine = c.id; saveFit(); renderRutina(); toast('Rutina duplicada') }],
    ['Exportar plan (respaldo)', exportFit],
    ['Importar plan (archivo)', () => $('#fileFit').click()],
    ['Pegar plan (texto)', pastePlan],
    ['Eliminar rutina', () => { if (confirm(`¿Eliminar la rutina “${r.name}”?`)) { fitness.routines = fitness.routines.filter(x => x !== r);
      fitness.activeRoutine = fitness.routines[0]?.id || ''; saveFit(); renderRutina() } }, true]]);
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
    { key:'rest', label:'Descanso entre series', value: e?.rest ? mmss(e.rest) : '', placeholder:'Ej. 2:30 (si lo dejas vacío, 2:30)', max:5 },
    { key:'tags', label:'Variantes', type:'tags', value:e?.tags },
    { key:'notes', label:'Explicación', type:'textarea', rows:3, value:e?.notes, placeholder:'Cómo hacerlo, según tu entrenador', max:600 }],
    v => {
      if (!v.name) { toast('Escribe el nombre del ejercicio'); return false }
      if (!e && day.exercises.length >= 60) { toast('Llegaste al máximo de 60 ejercicios en este día'); return false }
      const data = { name: v.name, sets: v.sets, reps: v.reps, rest: parseRest(v.rest), tags: v.tags.filter(t => TAGS.includes(t)), notes: v.notes };
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
      <div class="actions"><button class="btn" data-a="imp">Importar plan</button><button class="btn ghost" data-a="paste">Pegar plan</button><button class="btn ghost" data-a="new">Crear protocolo</button></div></div>`);
    box.querySelector('[data-a=imp]').onclick = () => $('#fileFit').click();
    box.querySelector('[data-a=new]').onclick = () => editDiet(null);
    box.querySelector('[data-a=paste]').onclick = pastePlan;
    return;
  }
  const log = todayLog();
  const done = dt.meals.filter(m => log.meals.includes(m.id)).length, total = dt.meals.length;
  const eaten = dt.meals.filter(m => log.meals.includes(m.id)).reduce((t, m) => t + (m.kcal || 0), 0);
  const planned = dt.meals.reduce((t, m) => t + (m.kcal || 0), 0);
  const goal = +dt.kcal || planned;
  const head = document.createElement('div'); head.className = 'diet-head';
  head.innerHTML = `<div><b>${esc(dt.name)}</b>${dt.kcal ? `<span>${esc(dt.kcal)} kcal</span> · ` : ''}<small style="color:var(--muted)">${dt.month ? esc(monthLabel(dt.month)) + ' · ' : ''}${total} comidas</small></div>
    <button class="icon-btn" aria-label="Opciones del protocolo">${DOTS}</button>`;
  head.querySelector('button').onclick = () => menu(dt.name, [
    ['Editar nombre, calorías y mes', () => editDiet(dt)],
    ['Duplicar protocolo', () => { const c = { ...JSON.parse(JSON.stringify(dt)), id: uid(), name: clip(dt.name + ' (copia)', 60) };
      c.meals.forEach(m => m.id = uid()); fitness.diets.push(c); fitness.activeDiet = c.id; saveFit(); renderDieta(); toast('Protocolo duplicado') }],
    ['Reiniciar marcas de hoy', () => { log.meals = []; saveFit(); renderDieta() }],
    ['Exportar plan (respaldo)', exportFit],
    ['Importar plan (archivo)', () => $('#fileFit').click()],
    ['Pegar plan (texto)', pastePlan],
    ['Eliminar protocolo', () => { if (confirm(`¿Eliminar ${dt.name}?`)) { fitness.diets = fitness.diets.filter(x => x !== dt);
      fitness.activeDiet = fitness.diets[0]?.id || ''; saveFit(); renderDieta() } }, true]]);
  box.appendChild(head);
  const kcalLine = planned ? `<div class="kcal-today"><b>${Math.round(eaten)}</b> de ${Math.round(goal)} kcal consumidas hoy</div>` :
    `<p class="note">Agrega las calorías de cada comida para ver cuántas llevas en el día.</p>`;
  box.insertAdjacentHTML('beforeend', `<div class="sec-head"><div><h2>Hoy</h2><p>${total ? `${done} de ${total} comidas` : 'Sin comidas todavía'}</p></div></div>
    ${kcalLine}
    <div class="meter"><i style="width:${planned ? Math.min(100, eaten / goal * 100) : (total ? done / total * 100 : 0)}%"></i></div>
    ${planned && dt.kcal && Math.abs(planned - dt.kcal) > 50 ? `<p class="note">Tus comidas suman ${Math.round(planned)} kcal y la meta del protocolo es ${esc(dt.kcal)} kcal.</p>` : ''}`);
  const ol = document.createElement('ol'); ol.className = 'items';
  dt.meals.forEach(m => {
    const isDone = log.meals.includes(m.id);
    const li = document.createElement('li'); li.className = 'item' + (isDone ? ' done' : '');
    li.innerHTML = `<span class="num" aria-hidden="true"></span>
      <button class="item-main"><b>${esc(m.name)}${m.kcal ? ` <span class="kc">${m.kcal} kcal</span>` : ''}</b>${m.text ? `<div class="note" style="color:var(--text);opacity:.85">${esc(m.text)}</div>` : ''}</button>
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
        const nd = { id: uid(), ...data, meals: copy ? prev.meals.map(m => ({ id: uid(), name: m.name, text: m.text, kcal: m.kcal })) : [] };
        fitness.diets.push(nd); fitness.activeDiet = nd.id;
      }
      saveFit(); renderDieta();
    });
}
function editMeal(m){
  const dt = activeDiet();
  formDialog(m ? 'Editar comida' : 'Nueva comida', [
    { key:'name', label:'Nombre', value: m?.name || 'Comida ' + (dt.meals.length + 1), max:40 },
    { key:'kcal', label:'Calorías de esta comida', value: m?.kcal ?? '', inputmode:'decimal', placeholder:'Ej. 550', max:6 },
    { key:'text', label:'Qué lleva', type:'textarea', rows:4, value: m?.text, placeholder:'Alimentos y cantidades de tu protocolo', max:600 }],
    v => {
      const data = { name: v.name || 'Comida', text: v.text, kcal: num(v.kcal) };
      if (m) Object.assign(m, data); else dt.meals.push({ id: uid(), ...data });
      saveFit(); renderDieta();
    },
    m ? () => { dt.meals = dt.meals.filter(x => x !== m); saveFit(); renderDieta() } : null);
}


// ----- Progreso: medidas corporales y gráficas -----
function lineChart(points, unit){
  // points: [{date, y}] ordenados por fecha
  if (points.length < 2) return `<p class="note">${points.length ? 'Agrega otro registro para ver la gráfica.' : 'Sin registros todavía.'}</p>`;
  const W = 320, H = 150, L = 36, R = 10, T = 12, B = 24;
  const ys = points.map(p => p.y), lo = Math.min(...ys), hi = Math.max(...ys), pad = (hi - lo) * 0.15 || 1;
  const y0 = lo - pad, y1 = hi + pad;
  const t = points.map(p => new Date(p.date + 'T12:00').getTime()), t0 = t[0], t1 = t[t.length - 1] || t0 + 1;
  const X = i => L + (t1 === t0 ? 0 : (t[i] - t0) / (t1 - t0)) * (W - L - R);
  const Y = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const area = `${d}L${X(points.length - 1).toFixed(1)},${H - B}L${L},${H - B}Z`;
  const fmt = v => Math.round(v * 10) / 10;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfica de ${esc(unit)}">
    <line x1="${L}" x2="${W - R}" y1="${Y(hi)}" y2="${Y(hi)}" class="grid"/><line x1="${L}" x2="${W - R}" y1="${Y(lo)}" y2="${Y(lo)}" class="grid"/>
    <text x="${L - 6}" y="${Y(hi) + 4}" text-anchor="end">${fmt(hi)}</text><text x="${L - 6}" y="${Y(lo) + 4}" text-anchor="end">${fmt(lo)}</text>
    <path d="${area}" class="area"/><path d="${d}" class="line"/>
    ${points.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3"/>`).join('')}
    <text x="${L}" y="${H - 6}">${shortDate(points[0].date)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${shortDate(points[points.length - 1].date)}</text>
  </svg>`;
}
function barChart(items, goal){
  // items: [{label, y}]
  const W = 320, H = 150, L = 8, R = 8, T = 14, B = 24, max = Math.max(goal || 0, ...items.map(i => i.y), 1);
  const bw = (W - L - R) / items.length;
  const Y = v => T + (1 - v / max) * (H - T - B);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfica de calorías por día">
    ${items.map((it, i) => `<rect x="${(L + i * bw + bw * 0.18).toFixed(1)}" y="${Y(it.y).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${(H - B - Y(it.y)).toFixed(1)}" rx="3" class="${goal && it.y > goal * 1.05 ? 'bar over' : 'bar'}"/>
      ${i % 2 === items.length % 2 ? '' : `<text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(it.label)}</text>`}`).join('')}
    ${goal ? `<line x1="${L}" x2="${W - R}" y1="${Y(goal)}" y2="${Y(goal)}" class="goal"/><text x="${W - R}" y="${Y(goal) - 4}" text-anchor="end">Meta ${Math.round(goal)}</text>` : ''}
  </svg>`;
}
function mealById(id){ for (const d of fitness.diets) { const m = d.meals.find(x => x.id === id); if (m) return [m, d] } return [null, null] }
function kcalOn(key){ return (fitness.log[key]?.meals || []).reduce((t, id) => t + (mealById(id)[0]?.kcal || 0), 0) }
let strengthPick = '';

function renderProgreso(){
  const box = $('#progreso'); box.innerHTML = '';
  box.appendChild(calendar());
  const body = fitness.body.slice().sort((a, b) => a.date.localeCompare(b.date));

  // Medidas
  box.insertAdjacentHTML('beforeend', `<div class="sec-head"><div><h2>Medidas</h2><p>${body.length ? `${body.length} registros · último ${shortDate(body[body.length - 1].date)}` : 'Registra tu peso y las medidas que te toma tu nutrióloga'}</p></div></div>
    <div class="actions" style="margin-top:8px"><button class="btn" data-a="addb">+ Registrar medidas</button><button class="btn ghost" data-a="fields">Campos</button></div>`);
  box.querySelector('[data-a=addb]').onclick = () => editBody(null);
  box.querySelector('[data-a=fields]').onclick = manageMetrics;
  fitness.metrics.forEach(m => {
    const pts = body.filter(b => b.values[m.id] !== undefined).map(b => ({ date: b.date, y: b.values[m.id] }));
    const last = pts[pts.length - 1], first = pts[0];
    const diff = last && first && pts.length > 1 ? Math.round((last.y - first.y) * 10) / 10 : null;
    box.insertAdjacentHTML('beforeend', `<div class="pcard">
      <div class="card-head"><div><small>${esc(m.name)}</small><b>${last ? `${last.y} ${esc(m.unit)}` : '—'}</b></div>
      ${diff !== null ? `<span class="delta ${diff < 0 ? 'down' : diff > 0 ? 'up' : ''}">${diff > 0 ? '+' : ''}${diff} ${esc(m.unit)} desde ${shortDate(first.date)}</span>` : ''}</div>
      ${lineChart(pts, m.unit)}</div>`);
  });

  // Fuerza
  const withRec = [];
  fitness.routines.forEach(r => r.days.forEach(d => d.exercises.forEach(e => { if ((fitness.records[e.id] || []).length) withRec.push({ e, r }) })));
  box.insertAdjacentHTML('beforeend', `<div class="sec-head"><div><h2>Fuerza</h2><p>Peso máximo por sesión de cada ejercicio</p></div></div>`);
  if (!withRec.length) box.insertAdjacentHTML('beforeend', '<p class="note">Registra pesos en tus ejercicios (Ejercicio → toca un ejercicio) para ver tu progreso aquí.</p>');
  else {
    if (!withRec.some(x => x.e.id === strengthPick)) strengthPick = withRec[0].e.id;
    const sel = document.createElement('select'); sel.className = 'pick';
    withRec.forEach(({ e, r }) => { const o = document.createElement('option'); o.value = e.id; o.textContent = `${e.name} · ${r.name}`; if (e.id === strengthPick) o.selected = true; sel.appendChild(o) });
    sel.onchange = () => { strengthPick = sel.value; renderProgreso() };
    box.appendChild(sel);
    const recs = (fitness.records[strengthPick] || []).filter(x => x.max !== null || x.min !== null).slice().sort((a, b) => a.date.localeCompare(b.date));
    const byDate = {}; recs.forEach(x => { const v = x.max ?? x.min; if (!byDate[x.date] || v > byDate[x.date].y) byDate[x.date] = { date: x.date, y: v, unit: x.unit } });
    const pts = Object.values(byDate);
    const unitW = pts[pts.length - 1]?.unit || 'kg';
    const best = pts.length ? Math.max(...pts.map(p => p.y)) : null;
    box.insertAdjacentHTML('beforeend', `<div class="pcard"><div class="card-head"><div><small>Récord</small><b>${best !== null ? best + ' ' + esc(unitW) : '—'}</b></div></div>${lineChart(pts, unitW)}</div>`);
  }

  // Calorías
  const days = []; const now = new Date();
  for (let i = 13; i >= 0; i--) { const d = new Date(now); d.setDate(now.getDate() - i);
    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    days.push({ label: String(d.getDate()), y: kcalOn(k), key: k }) }
  const goal = +(activeDiet()?.kcal || 0);
  const logged = days.filter(d => d.y > 0);
  const avg = logged.length ? Math.round(logged.reduce((t, d) => t + d.y, 0) / logged.length) : 0;
  box.insertAdjacentHTML('beforeend', `<div class="sec-head"><div><h2>Calorías</h2><p>Últimos 14 días, según las comidas que marcas</p></div></div>
    <div class="pcard"><div class="card-head"><div><small>Promedio en días registrados</small><b>${avg ? avg + ' kcal' : '—'}</b></div>${goal ? `<span class="delta">Meta ${goal} kcal</span>` : ''}</div>
    ${logged.length ? barChart(days, goal) : '<p class="note">Agrega las calorías de cada comida y márcalas al comerlas para ver esta gráfica.</p>'}</div>`);

  // Constancia
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  let trained = 0;
  for (let i = 0; i < 7; i++) { const d = new Date(weekStart); d.setDate(weekStart.getDate() + i);
    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if ((fitness.log[k]?.ex || []).length) trained++ }
  const planDays = activeRoutine()?.days.length || 0;
  box.insertAdjacentHTML('beforeend', `<div class="pcard"><div class="card-head"><div><small>Días entrenados esta semana</small><b>${trained}${planDays ? ' de ' + planDays : ''}</b></div></div>
    <div class="meter" style="margin:4px 0 0"><i style="width:${planDays ? Math.min(100, trained / planDays * 100) : 0}%"></i></div></div>`);

  // Historial de medidas
  if (body.length) {
    box.insertAdjacentHTML('beforeend', `<h4 class="hist-title" style="margin-top:24px">Historial de medidas</h4>`);
    const ul = document.createElement('ul'); ul.className = 'hist';
    body.slice().reverse().forEach(b => {
      const li = document.createElement('li');
      const vals = fitness.metrics.filter(m => b.values[m.id] !== undefined).map(m => `${esc(m.name)}: ${b.values[m.id]} ${esc(m.unit)}`).join(' · ');
      li.innerHTML = `<div><b>${shortDate(b.date)}</b><small>${vals || 'Sin medidas'}</small>${b.obs ? `<p>${esc(b.obs)}</p>` : ''}</div><button class="icon-btn" aria-label="Opciones del registro">${DOTS}</button>`;
      li.querySelector('button').onclick = () => menu(shortDate(b.date), [['Editar registro', () => editBody(b)],
        ['Eliminar registro', () => { fitness.body = fitness.body.filter(x => x !== b); saveFit(); renderProgreso() }, true]]);
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }
}
function editBody(b){
  const fields = fitness.metrics.map(m => ({ key: 'm_' + m.id, label: `${m.name}${m.unit ? ' (' + m.unit + ')' : ''}`, value: b?.values[m.id] ?? '', inputmode: 'decimal', max: 8, half: true }));
  fields.push({ key: 'date', label: 'Fecha', type: 'date', value: b?.date || todayKey(), half: true },
    { key: 'obs', label: 'Observaciones', type: 'textarea', rows: 2, value: b?.obs, placeholder: 'Ej. Medición con la nutrióloga, en ayunas', max: 300 });
  formDialog(b ? 'Editar medidas' : 'Registrar medidas', fields, v => {
    const values = {};
    fitness.metrics.forEach(m => { const n = num(v['m_' + m.id]); if (n !== null) values[m.id] = n });
    if (!Object.keys(values).length && !v.obs) { toast('Anota al menos una medida'); return false }
    const data = { date: DATE_RE.test(v.date) ? v.date : todayKey(), values, obs: clip(v.obs, 300) };
    if (b) Object.assign(b, data); else fitness.body.push({ id: uid(), ...data });
    saveFit(); renderProgreso(); toast('Medidas guardadas');
  });
}
function manageMetrics(){
  menu('Campos de medidas', [
    ...fitness.metrics.map(m => [`${m.name}${m.unit ? ' (' + m.unit + ')' : ''}`, () => formDialog('Editar campo', [
        { key:'name', label:'Nombre', value:m.name, max:30, half:true }, { key:'unit', label:'Unidad', value:m.unit, max:10, half:true }],
        v => { m.name = v.name || m.name; m.unit = v.unit; saveFit(); renderProgreso() },
        fitness.metrics.length > 1 ? () => { if (confirm(`¿Eliminar el campo ${m.name}? Se borran sus valores del historial.`)) {
          fitness.metrics = fitness.metrics.filter(x => x !== m); fitness.body.forEach(b => delete b.values[m.id]); saveFit(); renderProgreso() } } : null)]),
    ['+ Agregar campo', () => formDialog('Nuevo campo', [
        { key:'name', label:'Nombre', placeholder:'Ej. Cintura', max:30, half:true }, { key:'unit', label:'Unidad', placeholder:'Ej. cm', max:10, half:true }],
        v => { if (!v.name) { toast('Escribe el nombre del campo'); return false }
          if (fitness.metrics.length >= 15) { toast('Máximo 15 campos'); return false }
          fitness.metrics.push({ id: uid(), name: v.name, unit: v.unit }); saveFit(); renderProgreso() })]
  ]);
}


// ---------- Sesión de entrenamiento y descansos ----------
const DEFAULT_REST = 150;
let session = store.get('rolas.session', null);
if (session && (typeof session !== 'object' || !UID_RE.test(session.did || '') || !isFinite(session.start))) session = null;
const mmss = sec => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = String(sec % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}` };
function parseRest(v){
  v = String(v || '').trim(); if (!v) return null;
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  const sec = m ? +m[1] * 60 + +m[2] : (/^\d+(\.\d+)?$/.test(v) ? (+v <= 15 ? +v * 60 : +v) : null);
  return sec && sec >= 15 && sec <= 900 ? Math.round(sec) : null;
}
// Cuántas series tiene un ejercicio a partir del texto: "3" → 3, "2 de aproximación y 3 efectivas" → 5, "4 (2 pesadas + 2 ligeras)" → 4
function setCount(e){
  const t = String(e.sets || '').replace(/\([^)]*\)/g, ' ');
  const n = (t.match(/\d+/g) || []).map(Number);
  if (!n.length) return 3;
  return Math.max(1, Math.min(20, /\by\b|\+/.test(t) ? n.reduce((a, b) => a + b, 0) : n[0]));
}
const saveSession = () => store.set('rolas.session', session);
const setsOf = id => session?.sets?.[id] || [];

let actx = null;
function unlockAudio(){ try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume() } catch {} }
function beep(){
  if (!actx) return;
  [0, .28, .56].forEach(t => { try {
    const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(actx.destination);
    const at = actx.currentTime + t; g.gain.setValueAtTime(.0001, at); g.gain.exponentialRampToValueAtTime(.35, at + .02); g.gain.exponentialRampToValueAtTime(.0001, at + .2);
    o.start(at); o.stop(at + .22) } catch {} });
}
function restAlert(){
  // Baja la música un momento, suena el aviso, vibra y regresa el volumen
  let vol = null;
  try { if (ready && player.getPlayerState() === YT.PlayerState.PLAYING && !fading) { vol = player.getVolume(); player.setVolume(Math.round(vol * .2)) } } catch {}
  beep(); try { navigator.vibrate?.([300, 150, 300, 150, 300]) } catch {}
  if (vol !== null) setTimeout(() => { try { player.setVolume(vol) } catch {} }, 1800);
}
function startSession(r, d, withMusic){
  unlockAudio();
  session = { rid: r.id, did: d.id, start: Date.now(), sets: {}, rest: null };
  saveSession(); renderRutina();
  if (withMusic) playGymMix();
}
function setDone(e){
  if (!session) return;
  unlockAudio();
  if (session.rest) finishRest();
  const list = session.sets[e.id] = session.sets[e.id] || [];
  if (list.length >= setCount(e)) return;
  list.push({ at: Date.now(), rest: null, target: null });
  session.rest = { exId: e.id, start: Date.now(), target: e.rest || DEFAULT_REST, alerted: false };
  if (list.length >= setCount(e)) { const log = todayLog(); if (!log.ex.includes(e.id)) { log.ex.push(e.id); saveFit() } }
  saveSession(); renderRutina();
}
function finishRest(){
  const rs = session?.rest; if (!rs) return;
  const last = setsOf(rs.exId).slice(-1)[0];
  if (last) { last.rest = Math.round((Date.now() - rs.start) / 1000); last.target = rs.target }
  session.rest = null; saveSession();
}
function endSession(){
  if (!session) return;
  session.rest = null; // el descanso que estaba corriendo al terminar no cuenta
  const r = fitness.routines.find(x => x.id === session.rid), d = r?.days.find(x => x.id === session.did);
  const all = Object.values(session.sets).flat(), rests = all.filter(x => x.rest !== null);
  const total = d ? d.exercises.reduce((t, e) => t + setCount(e), 0) : all.length;
  const avg = a => a.length ? Math.round(a.reduce((t, x) => t + x, 0) / a.length) : null;
  const sum = { id: uid(), date: todayKey(), rname: r?.name || '', dname: d ? (d.focus || d.name) : '', dur: Math.round((Date.now() - session.start) / 1000),
    sets: all.length, total, avgRest: avg(rests.map(x => x.rest)), avgTarget: avg(rests.map(x => x.target)),
    short: rests.filter(x => x.rest < x.target - 15).length, long: rests.filter(x => x.rest > x.target + 30).length };
  fitness.sessions = [...fitness.sessions, sum].slice(-300);
  session = null; saveSession(); saveFit(); renderRutina(); showSummary(sum);
}
function showSummary(x){
  $('#exTitle').textContent = 'Entrenamiento terminado';
  $('#exBody').innerHTML = `<p class="note" style="margin-top:0">${esc(x.dname)} · ${esc(x.rname)}</p>
    <div class="stats"><div><small>Duración</small><b>${mmss(x.dur)}</b></div><div><small>Series</small><b>${x.sets} de ${x.total}</b></div>
    <div><small>Descanso prom.</small><b>${x.avgRest !== null ? mmss(x.avgRest) : '—'}</b></div></div>
    ${x.avgTarget ? `<p class="note">Tu objetivo de descanso promedio era ${mmss(x.avgTarget)}. ${x.short ? `Descansaste de menos en ${x.short} ${x.short === 1 ? 'serie' : 'series'}. ` : ''}${x.long ? `Te pasaste del descanso en ${x.long} ${x.long === 1 ? 'serie' : 'series'}.` : ''}${!x.short && !x.long ? 'Respetaste muy bien los descansos.' : ''}</p>` : ''}
    <div class="fbtns"><button class="btn" data-a="ok">Listo</button></div>`;
  $('#exBody [data-a=ok]').onclick = () => $('#dlgEx').close();
  $('#dlgEx').showModal();
}
function sessionPanel(r, d){
  const wrap = document.createElement('div');
  if (!session) {
    wrap.className = 'actions';
    wrap.innerHTML = `<button class="btn" data-a="go">Iniciar entrenamiento</button><button class="btn ghost" data-a="music">Entrenar con música</button>`;
    wrap.querySelector('[data-a=go]').onclick = () => startSession(r, d, false);
    wrap.querySelector('[data-a=music]').onclick = () => startSession(r, d, true);
    return wrap;
  }
  if (session.did !== d.id) {
    const od = fitness.routines.flatMap(x => x.days).find(x => x.id === session.did);
    wrap.className = 'ses';
    wrap.innerHTML = `<div class="ses-row"><div><small>Entrenamiento en curso</small><b>${esc(od ? (od.focus || od.name) : 'Otro día')}</b></div>
      <button class="btn ghost sm" data-a="go">Ir</button><button class="btn ghost sm" data-a="end">Terminar</button></div>`;
    wrap.querySelector('[data-a=go]').onclick = () => { const rr = fitness.routines.find(x => x.days.some(y => y.id === session.did)); if (rr) { fitness.activeRoutine = rr.id; selDay[rr.id] = session.did; renderRutina() } };
    wrap.querySelector('[data-a=end]').onclick = () => { if (confirm('¿Terminar el entrenamiento en curso?')) endSession() };
    return wrap;
  }
  const total = d.exercises.reduce((t, e) => t + setCount(e), 0), done = d.exercises.reduce((t, e) => t + Math.min(setsOf(e.id).length, setCount(e)), 0);
  wrap.className = 'ses';
  wrap.innerHTML = `<div class="ses-row"><div><small>Tiempo</small><b id="sesTotal">${mmss((Date.now() - session.start) / 1000)}</b></div>
      <div><small>Series</small><b>${done} de ${total}</b></div><button class="btn ghost sm" data-a="end">Terminar</button></div>
    ${session.rest ? `<div class="restbox" id="restBox"><small id="restLabel">Descanso</small><b id="restClock">0:00</b>
      <button class="btn" data-a="next">Empezar siguiente serie</button></div>` : ''}`;
  wrap.querySelector('[data-a=end]').onclick = () => { if (confirm('¿Terminar el entrenamiento?')) endSession() };
  wrap.querySelector('[data-a=next]')?.addEventListener('click', () => { finishRest(); renderRutina(); toast('¡A darle!') });
  setTimeout(tickSession, 0);
  return wrap;
}
function setRow(e){
  const n = setCount(e), done = setsOf(e.id).length;
  const row = document.createElement('div'); row.className = 'setrow';
  row.innerHTML = `<span class="dots">${Array.from({ length: n }, (_, i) => `<i class="${i < done ? 'on' : ''}"></i>`).join('')}</span>
    ${done < n ? `<button class="btn sm">Serie hecha ${done + 1}/${n}</button>` : '<span class="ok">✓ Completo</span>'}
    <small>Descanso ${mmss(e.rest || DEFAULT_REST)}</small>`;
  row.querySelector('button')?.addEventListener('click', () => setDone(e));
  return row;
}
function tickSession(){
  if (!session) return;
  const t = $('#sesTotal'); if (t) t.textContent = mmss((Date.now() - session.start) / 1000);
  const rs = session.rest; if (!rs) return;
  const left = rs.target - (Date.now() - rs.start) / 1000;
  const c = $('#restClock'), box = $('#restBox');
  if (c) c.textContent = left >= 0 ? mmss(left) : '+' + mmss(-left);
  if (box) box.classList.toggle('over', left < 0);
  const lab = $('#restLabel'); if (lab) lab.textContent = left >= 0 ? 'Descanso' : 'Descanso terminado, te estás pasando';
  if (left <= 0 && !rs.alerted) { rs.alerted = true; saveSession(); restAlert() }
}
setInterval(tickSession, 250);

// ---------- Calendario de constancia ----------
let calMonth = todayKey().slice(0, 7);
function calendar(){
  const box = document.createElement('div'); box.className = 'pcard cal';
  const [y, m] = calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate(), pad = (first.getDay() + 6) % 7;
  const sessDays = new Set(fitness.sessions.map(x => x.date));
  let trained = 0, meals = 0, cells = '';
  for (let i = 0; i < pad; i++) cells += '<span></span>';
  for (let dd = 1; dd <= days; dd++) {
    const k = `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`, lg = fitness.log[k];
    const tr = (lg?.ex || []).length > 0 || sessDays.has(k);
    const mealIds = lg?.meals || [], diet = mealIds.length ? fitness.diets.find(dt => dt.meals.some(x => mealIds.includes(x.id))) : null;
    const food = diet && diet.meals.every(x => mealIds.includes(x.id));
    if (tr) trained++; if (food) meals++;
    cells += `<span class="${tr ? 'tr' : ''} ${k === todayKey() ? 'today' : ''}">${dd}${food ? '<i></i>' : ''}</span>`;
  }
  box.innerHTML = `<div class="cal-head"><button class="icon-btn" data-a="prev" aria-label="Mes anterior">‹</button>
      <b>${esc(monthLabel(calMonth))}</b><button class="icon-btn" data-a="nextm" aria-label="Mes siguiente">›</button></div>
    <div class="cal-grid"><small>L</small><small>M</small><small>M</small><small>J</small><small>V</small><small>S</small><small>D</small>${cells}</div>
    <p class="note cal-legend"><span class="lg tr"></span>${trained} días entrenados <span class="lg food"></span>${meals} días con todas tus comidas</p>`;
  const move = delta => { const d = new Date(y, m - 1 + delta, 1); calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; renderProgreso() };
  box.querySelector('[data-a=prev]').onclick = () => move(-1);
  box.querySelector('[data-a=nextm]').onclick = () => move(1);
  return box;
}

// ---------- Estadísticas de escucha y Mix del gym ----------
// Limpieza de las estadísticas (navegador o nube): IDs válidos, contadores numéricos y máximo 600 rolas.
function cleanStats(o){
  const out = {}, int = v => { const n = Math.floor(Number(v)); return isFinite(n) && n > 0 ? Math.min(n, 1e6) : 0 };
  Object.keys(o && typeof o === 'object' && !Array.isArray(o) ? o : {}).filter(k => ID_RE.test(k)).forEach(k => {
    const x = o[k]; if (!x || typeof x !== 'object') return;
    const t = cleanTrack(x.t);
    out[k] = { n: int(x.n), s: int(x.s), l: Math.min(int(x.l), 4e12) };
    if (t && t.id === k) out[k].t = t;
  });
  const keys = Object.keys(out); if (keys.length > 600) keys.sort((a, b) => out[a].l - out[b].l).slice(0, keys.length - 600).forEach(k => delete out[k]);
  return out;
}
// Une las estadísticas de dos dispositivos quedándose con el valor más alto de cada contador.
function mergeStats(a, b){
  const out = { ...a };
  Object.entries(b).forEach(([k, y]) => { const x = out[k];
    out[k] = x ? { n: Math.max(x.n, y.n), s: Math.max(x.s, y.s), l: Math.max(x.l, y.l), ...(x.t || y.t ? { t: x.t || y.t } : {}) } : y });
  return cleanStats(out);
}
let stats = cleanStats(store.get('rolas.stats', {}));
let playing = { id: '', at: 0 };
function countPlay(){
  const t = current(); if (!t || playing.id === t.id) return;
  playing = { id: t.id, at: Date.now() };
  const st = stats[t.id] = stats[t.id] || { n: 0, s: 0 };
  st.n++; st.t = cleanTrack(t); st.l = Date.now();
  const keys = Object.keys(stats); if (keys.length > 600) keys.sort((a, b) => (stats[a].l || 0) - (stats[b].l || 0)).slice(0, keys.length - 600).forEach(k => delete stats[k]);
  store.set('rolas.stats', stats); scheduleCloud();
}
function countSkip(){
  const t = current(); if (!t || playing.id !== t.id || Date.now() - playing.at > 30000) return;
  if (stats[t.id]) { stats[t.id].s++; store.set('rolas.stats', stats); scheduleCloud() }
}
async function playGymMix(){
  const scored = Object.values(stats).filter(x => x.t && ID_RE.test(x.t.id)).map(x => ({ t: x.t, sc: x.n - 2 * x.s })).filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc);
  let mix = scored.slice(0, 25).map(x => x.t);
  const fav = library.find(p => p.id === 'fav')?.tracks || [];
  fav.forEach(t => { if (!mix.some(x => x.id === t.id)) mix.push(t) });
  if (apiKey && scored.length) {
    const count = {}; scored.slice(0, 30).forEach(x => { const a = String(x.t.channel || '').replace(/VEVO$|\s*-\s*Topic$/i, '').trim(); if (a) count[a] = (count[a] || 0) + x.sc });
    const top = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    if (top) try {
      const j = await (await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=15&regionCode=MX&q=${encodeURIComponent(top)}&key=${apiKey}`)).json();
      (j.items || []).filter(it => ID_RE.test(it.id?.videoId) && !mix.some(x => x.id === it.id.videoId))
        .forEach(it => mix.push(cleanTrack({ id: it.id.videoId, title: decode(it.snippet.title), channel: decode(it.snippet.channelTitle) })));
    } catch {}
  }
  if (!mix.length) { toast('Escucha y dale + a algunas canciones para armar tu mix'); return }
  mix.sort(() => Math.random() - .5);
  const pl = library.find(p => p.id === 'gymmix');
  if (pl) pl.tracks = mix.slice(0, 60); else library.push({ id: 'gymmix', name: 'Mix del gym', tracks: mix.slice(0, 60) });
  save(); playList(mix, 0, 'mix'); toast('Sonando tu Mix del gym');
}

// ---------- Dormir ----------
let sleep = null, fading = false, sleepPick = 'now', sleepMode = '30';
function stopSleep(pause){
  if (!sleep) return;
  try { if (sleep.vol !== null && ready) player.setVolume(sleep.vol) } catch {}
  if (pause && ready) { userPaused = true; try { player.pauseVideo() } catch {} }
  sleep = null; fading = false;
  if (currentView === 'gym' && gymTab === 'dormir') renderDormir();
}
function startSleep(){
  const pl = library.find(p => p.id === sleepPick);
  if (pl && pl.tracks.length) playList(pl.tracks, 0, 'sleep');
  else if (!current()) { toast('Elige una playlist o pon una canción'); return }
  else if (ready && player.getPlayerState() !== YT.PlayerState.PLAYING) { userPaused = false; player.playVideo() }
  let vol = null; try { vol = ready ? player.getVolume() : null } catch {}
  const mins = +sleepMode;
  sleep = { mode: sleepMode === 'stop' ? 'stop' : sleepMode === 'end' ? 'end' : 'time', end: mins ? Date.now() + mins * 60000 : null, vol };
  toast(sleep.mode === 'time' ? `Se detendrá en ${mins >= 60 ? mins / 60 + ' h' : mins + ' min'}` : sleep.mode === 'end' ? 'Se detendrá al terminar la playlist' : 'Sonará hasta que lo detengas');
  renderDormir();
}
setInterval(() => {
  if (!sleep || sleep.mode !== 'time' || !ready) return;
  const left = (sleep.end - Date.now()) / 1000, FADE = 180;
  const el = $('#sleepLeft'); if (el) el.textContent = mmss(Math.max(0, left));
  if (left <= 0) return stopSleep(true);
  if (left <= FADE && sleep.vol !== null) { fading = true; try { player.setVolume(Math.max(1, Math.round(sleep.vol * left / FADE))) } catch {} }
}, 1000);
function renderDormir(){
  const box = $('#dormir'); box.innerHTML = '';
  const lists = library.filter(p => p.tracks.length);
  const opts = [['now', 'Lo que está sonando'], ...lists.map(p => [p.id, p.name])];
  if (!opts.some(o => o[0] === sleepPick)) sleepPick = 'now';
  const modes = [['stop', 'Hasta que lo pare'], ['15', '15 min'], ['30', '30 min'], ['60', '1 hora'], ['120', '2 horas'], ['end', 'Al terminar la playlist']];
  box.innerHTML = `<div class="sec-head"><div><h2>Dormir</h2><p>Música o meditación que se apaga sola, bajando el volumen poco a poco</p></div></div>
    ${sleep ? `<div class="pcard sleep-on"><small>${sleep.mode === 'time' ? 'Se detiene en' : sleep.mode === 'end' ? 'Se detiene al terminar la playlist' : 'Sonando hasta que lo detengas'}</small>
      ${sleep.mode === 'time' ? `<b id="sleepLeft">${mmss((sleep.end - Date.now()) / 1000)}</b>` : ''}
      <div class="actions"><button class="btn ghost" data-a="cancel">Cancelar temporizador</button><button class="btn ghost" data-a="stopnow">Detener ahora</button></div></div>` : ''}
    <h4 class="hist-title">¿Qué quieres escuchar?</h4><div class="chips wrap" id="sleepLists"></div>
    <h4 class="hist-title">¿Cuándo se detiene?</h4><div class="chips wrap" id="sleepModes"></div>
    <div class="actions"><button class="btn add-ex" data-a="start">${sleep ? 'Reiniciar con esta configuración' : 'Empezar'}</button></div>
    <p class="note">Tip: crea en tu Biblioteca una playlist de meditación o música para dormir y elígela aquí.</p>`;
  const mk = (host, items, sel, set) => items.forEach(([v, label]) => { const b = document.createElement('button'); b.className = 'chip' + (v === sel ? ' on' : ''); b.textContent = label; b.onclick = () => { set(v); renderDormir() }; $(host).appendChild(b) });
  mk('#sleepLists', opts, sleepPick, v => sleepPick = v);
  mk('#sleepModes', modes, sleepMode, v => sleepMode = v);
  box.querySelector('[data-a=start]').onclick = () => { if (sleep) stopSleep(false); startSleep() };
  box.querySelector('[data-a=cancel]')?.addEventListener('click', () => { stopSleep(false); toast('Temporizador cancelado') });
  box.querySelector('[data-a=stopnow]')?.addEventListener('click', () => stopSleep(true));
}

// ----- Importar / exportar plan -----
function exportFit(){
  const a = document.createElement('a');
  const { routines, activeRoutine, diets, activeDiet, records, metrics, body } = fitness;
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ type: 'rolas-plan', routines, activeRoutine, diets, activeDiet, records, metrics, body }, null, 1)], { type: 'application/json' }));
  a.download = 'rolas-plan.json'; a.click();
}
$('#fileFit').onchange = async e => {
  try {
    const f = e.target.files[0]; if (!f || f.size > 2_000_000) throw 0;
    importPlan(JSON.parse(await f.text()));
  } catch { toast('Ese archivo no es un plan de Rolas') }
  e.target.value = '';
};
function pastePlan(){
  formDialog('Pegar plan', [{ key:'txt', label:'Pega aquí el texto completo del plan (empieza con { y termina con })', type:'textarea', rows:10, max:300000 }], v => {
    try { importPlan(JSON.parse(v.txt)) } catch { toast('El texto no es un plan válido. Revisa que esté completo.'); return false }
  });
}
function importPlan(data){
    if (!data || data.type !== 'rolas-plan') throw new Error('formato');
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
    if (Array.isArray(data.metrics) && data.metrics.length) {
      inc.metrics.forEach(m => { if (!fitness.metrics.some(x => x.id === m.id)) fitness.metrics.push(m) });
      const have = new Set(fitness.body.map(b => b.id)); inc.body.forEach(b => { if (!have.has(b.id)) fitness.body.push(b) });
    }
    saveFit(); renderGym();
    const nd = inc.routines.reduce((t, r) => t + r.days.length, 0), nm = inc.diets.reduce((t, d) => t + d.meals.length, 0);
    toast(`Importado: ${inc.routines.length} rutina(s) con ${nd} días y ${inc.diets.length} protocolo(s) con ${nm} comidas`);
}

// ---------- Nube (Supabase) ----------
let cloudTimer = null, cloudReady = false;
function scheduleCloud(){ if (!user || !cloudReady) return; clearTimeout(cloudTimer); cloudTimer = setTimeout(pushCloud, 1500) }
async function pushCloud(){
  if (!user || !cloudReady) return;
  const row = { user_id: user.id, library, recents, api_key: apiKey || null, fitness: { ...fitness, stats }, updated_at: new Date().toISOString() };
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
    if (data.fitness && (data.fitness.routines?.length || data.fitness.diets?.length || data.fitness.diet || data.fitness.body?.length)) fitness = cleanFitness(data.fitness);
    if (data.fitness && typeof data.fitness === 'object') stats = mergeStats(stats, cleanStats(data.fitness.stats));
  }
  store.set('rolas.stats', stats);
  store.set('rolas.fitness', fitness);
  store.set('rolas.library', library); store.set('rolas.recents', recents); store.set('rolas.key', apiKey);
  cloudReady = true;
  if (!data) await pushCloud(); // primera vez: sube lo que ya tenías en este celular
  else scheduleCloud(); // sube las estadísticas ya combinadas con las de este dispositivo
}
function clearLocal(){
  ['rolas.library','rolas.queue','rolas.index','rolas.recents','rolas.key','rolas.fitness','rolas.stats'].forEach(k => { try { localStorage.removeItem(k) } catch {} });
  library = [{ id:'fav', name:'Me gustan', tracks:[] }]; queue = []; index = -1; recents = []; apiKey = ''; fitness = emptyFitness(); stats = {};
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
