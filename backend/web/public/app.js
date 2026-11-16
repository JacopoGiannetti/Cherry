// Cherry web: la Dynamic view dell'app, nel browser.
// In alto il video, sotto una card per spezzone: a ogni card il video
// salta al suo pezzo e lo ripete. Stessa logica del Coordinator in
// DynamicRecipeView.swift (seekTo + play, riparte a fine spezzone).
(function () {
  const $ = (id) => document.getElementById(id);
  const show = (id) => {
    for (const s of ['home', 'loading', 'dynamic']) $(s).hidden = s !== id;
  };

  // ---------- Home ----------

  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    start($('url').value.trim());
  });
  $('paste').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) { $('url').value = text.trim(); start(text.trim()); }
    } catch { $('url').focus(); }
  });

  function homeError(message) {
    show('home');
    $('home-error').textContent = message;
    $('home-error').hidden = false;
  }

  async function start(url) {
    if (!url) return;
    $('home-error').hidden = true;
    history.replaceState(null, '', `?u=${encodeURIComponent(url)}`);
    show('loading');
    $('stage').textContent = 'Reading the post';
    try {
      const r = await fetch('api/import', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }),
      });
      const body = await r.json();
      if (!r.ok) return homeError(body.error || 'Something went wrong.');
      poll(body.id);
    } catch {
      homeError('Could not reach the server.');
    }
  }

  async function poll(id) {
    const r = await fetch(`api/import/${id}`).catch(() => null);
    const job = r && r.ok ? await r.json() : null;
    if (!job) return homeError('Could not reach the server.');
    if (job.status === 'running') {
      $('stage').textContent = job.stage;
      return setTimeout(() => poll(id), 1500);
    }
    if (job.status === 'error') return homeError(job.error);
    openDynamic(job.result);
  }

  // ---------- Vista dinamica ----------

  const state = { pages: [], index: 0, paused: false, muted: true, player: null };

  function openDynamic(result) {
    const { recipe } = result;
    // Come DynamicRecipeView.pages: si scartano gli spezzoni senza step validi.
    state.pages = (recipe.segments || [])
      .map((s) => ({
        ...s,
        steps: (s.steps || []).filter((i) => i >= 0 && i < recipe.steps.length),
        ingredients: (s.ingredients || []).filter((i) => i >= 0 && i < recipe.ingredients.length),
      }))
      .filter((s) => s.steps.length && s.end > s.start);
    state.index = 0;
    state.paused = false;
    state.muted = true;
    state.recipe = recipe;
    state.result = result;
    document.title = `${recipe.title} · Cherry`;

    renderTicks();
    renderPages();
    renderSheet();
    show('dynamic');
    mountPlayer(result);
    syncButtons();
  }

  function renderTicks() {
    $('ticks').innerHTML = state.pages.map(() => '<i></i>').join('');
    updateTicks();
  }

  function updateTicks() {
    [...$('ticks').children].forEach((t, n) => t.classList.toggle('on', n <= state.index));
    $('next').textContent = state.index >= state.pages.length - 1 ? 'Done ✓' : 'Next step ↓';
  }

  function fmt(sec) {
    const s = Math.max(0, Math.round(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function esc(text) {
    const d = document.createElement('div');
    d.textContent = text == null ? '' : String(text);
    return d.innerHTML;
  }

  function renderPages() {
    const { recipe } = state;
    $('pages').innerHTML = state.pages.map((seg, n) => `
      <article class="page" data-n="${n}">
        <p class="kicker">STEP ${n + 1} OF ${state.pages.length}<span class="time">${fmt(seg.start)}–${fmt(seg.end)}</span></p>
        ${seg.title ? `<h2>${esc(seg.title)}</h2>` : ''}
        <ul class="steps">
          ${seg.steps.map((i) => `<li><span class="num">${i + 1}</span><span>${esc(recipe.steps[i])}</span></li>`).join('')}
        </ul>
        ${seg.ingredients.length ? `<div class="chips">${seg.ingredients.map((i) => {
          const g = recipe.ingredients[i];
          return `<span class="chip">${g.emoji ? esc(g.emoji) : ''} ${esc(g.name)} ${g.quantity ? `<em>${esc(g.quantity)}</em>` : ''}</span>`;
        }).join('')}</div>` : ''}
      </article>`).join('');

    // La card che occupa lo schermo decide lo spezzone.
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRatio > 0.6) setIndex(parseInt(e.target.dataset.n, 10));
      }
    }, { root: $('pages'), threshold: [0.6] });
    $('pages').querySelectorAll('.page').forEach((p) => io.observe(p));
    $('pages').scrollTop = 0;
  }

  function renderSheet() {
    const { recipe, result } = state;
    $('sheet-title').textContent = recipe.title;
    const meta = [recipe.servings && `${recipe.servings} servings`, recipe.cookMinutes && `${recipe.cookMinutes} min`].filter(Boolean);
    $('sheet-meta').textContent = meta.join(' · ');
    $('sheet-ingredients').innerHTML = recipe.ingredients
      .map((g) => `<li><span>${g.emoji ? esc(g.emoji) + ' ' : ''}${esc(g.name)}</span><em>${esc(g.quantity || '')}</em></li>`).join('');
    $('sheet-steps').innerHTML = recipe.steps.map((s) => `<li>${esc(s)}</li>`).join('');
    $('sheet-source').href = result.url;
  }

  function setIndex(n) {
    if (n === state.index) return;
    state.index = n;
    state.paused = false;
    updateTicks();
    syncButtons();
    state.player && state.player.restart();
  }

  $('next').addEventListener('click', () => {
    if (state.index >= state.pages.length - 1) return close();
    const target = $('pages').querySelector(`[data-n="${state.index + 1}"]`);
    target && target.scrollIntoView({ behavior: 'smooth' });
  });
  $('close').addEventListener('click', close);
  $('full').addEventListener('click', () => { $('sheet').hidden = false; });
  $('sheet-close').addEventListener('click', () => { $('sheet').hidden = true; });
  $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) $('sheet').hidden = true; });

  $('play').addEventListener('click', () => {
    state.paused = !state.paused;
    state.player && state.player.send(state.paused ? 'pause' : 'play');
    syncButtons();
  });
  $('mute').addEventListener('click', () => {
    state.muted = !state.muted;
    state.player && state.player.send(state.muted ? 'mute' : 'unMute');
    syncButtons();
  });

  function syncButtons() {
    $('play').textContent = state.paused ? '▶' : '❚❚';
    $('play').setAttribute('aria-label', state.paused ? 'Play' : 'Pause');
    $('mute').textContent = state.muted ? '🔇' : '🔊';
    $('mute').setAttribute('aria-label', state.muted ? 'Sound on' : 'Sound off');
  }

  function close() {
    state.player && state.player.destroy();
    state.player = null;
    $('player').innerHTML = '';
    $('sheet').hidden = true;
    history.replaceState(null, '', location.pathname);
    document.title = 'Cherry: cook any recipe video';
    show('home');
  }

  // ---------- Player ----------
  //
  // Due player con gli stessi comandi (send) e gli stessi eventi:
  // - TikTok: Embed Player ufficiale, comandato via postMessage.
  // - Instagram: il file del reel in un <video> nostro, servito a flusso
  //   dal server (/api/media), perché l'embed di Instagram non ha comandi.
  //   Se non si carica, ripiego sull'embed ufficiale con i tempi scritti.

  function mountPlayer(result) {
    $('player-note').hidden = true;
    const ctl = controller();
    state.player = result.embed.type === 'tiktok'
      ? tiktokPlayer(result.embed.postId, ctl)
      : instagramPlayer(result.url, result.embed.shortcode, ctl);
  }

  /** La logica del Coordinator di Cherry: salta allo spezzone, lo ripete. */
  function controller() {
    let ready = false;
    let player = null;
    const segment = () => state.pages[state.index];
    const api = {
      bind(p) { player = p; },
      ready() {
        if (ready) return;
        ready = true;
        player.send(state.muted ? 'mute' : 'unMute');
        api.restart();
      },
      time(t) {
        const s = segment();
        if (!ready || state.paused || !s) return;
        if (t >= s.end - 0.15 || t < s.start - 1) api.restart();
      },
      ended() { if (!state.paused) api.restart(); },
      restart() {
        const s = segment();
        if (!ready || !s) return;
        player.send('seekTo', s.start);
        player.send(state.paused ? 'pause' : 'play');
      },
    };
    return api;
  }

  function tiktokPlayer(postId, ctl) {
    const params = [
      'controls=0', 'autoplay=1', 'loop=0', 'muted=1', 'progress_bar=0', 'play_button=0',
      'volume_control=0', 'fullscreen_button=0', 'timestamp=0', 'rel=0', 'music_info=0',
      'description=0', 'native_context_menu=0', 'closed_caption=0',
    ].join('&');
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.tiktok.com/player/v1/${postId}?${params}`;
    iframe.allow = 'autoplay; encrypted-media; fullscreen';
    $('player').replaceChildren(iframe);

    const onMessage = (e) => {
      if (e.source !== iframe.contentWindow) return;
      let d = e.data;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return; } }
      if (!d || !d['x-tiktok-player']) return;
      if (d.type === 'onPlayerReady') ctl.ready();
      else if (d.type === 'onCurrentTime') ctl.time(Number(d.value && d.value.currentTime));
      else if (d.type === 'onStateChange' && Number(d.value) === 0) ctl.ended();
    };
    window.addEventListener('message', onMessage);

    const p = {
      send(type, value) {
        iframe.contentWindow && iframe.contentWindow.postMessage({ type, value, 'x-tiktok-player': true }, '*');
      },
      restart: () => ctl.restart(),
      destroy() { window.removeEventListener('message', onMessage); },
    };
    ctl.bind(p);
    watchdog(ctl, () => note('The TikTok player did not start. The creator may have turned off embedding.'));
    return p;
  }

  function instagramPlayer(postUrl, shortcode, ctl) {
    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.preload = 'auto';
    video.src = `api/media?u=${encodeURIComponent(postUrl)}`;
    $('player').replaceChildren(video);

    let pendingSeek = null;
    video.addEventListener('loadedmetadata', () => {
      ctl.ready();
      if (pendingSeek !== null) { video.currentTime = pendingSeek; pendingSeek = null; }
    });
    video.addEventListener('timeupdate', () => ctl.time(video.currentTime));
    video.addEventListener('ended', () => ctl.ended());

    let fellBack = false;
    const fallback = () => {
      if (fellBack) return;
      fellBack = true;
      // Ripiego: l'embed ufficiale, che però non si può comandare.
      const iframe = document.createElement('iframe');
      iframe.src = `https://www.instagram.com/reel/${shortcode}/embed/`;
      iframe.allow = 'autoplay; encrypted-media; fullscreen';
      $('player').replaceChildren(iframe);
      note('This Instagram video can only play in its own player: use the times on each step to follow along.');
    };
    video.addEventListener('error', fallback);

    const p = {
      send(type, value) {
        if (fellBack) return;
        if (type === 'seekTo') {
          if (video.readyState < 1) pendingSeek = value; else video.currentTime = value;
        } else if (type === 'play') {
          const r = video.play();
          if (r && r.catch) r.catch(() => {});
        } else if (type === 'pause') video.pause();
        else if (type === 'mute') video.muted = true;
        else if (type === 'unMute') video.muted = false;
      },
      restart: () => ctl.restart(),
      destroy() { video.removeAttribute('src'); video.load(); },
    };
    ctl.bind(p);
    return p;
  }

  function watchdog(ctl, onFail) {
    let started = false;
    const orig = ctl.ready;
    ctl.ready = () => { started = true; orig(); };
    setTimeout(() => { if (!started) onFail(); }, 12000);
  }

  function note(text) {
    $('player-note').textContent = text;
    $('player-note').hidden = false;
  }

  // Link condivisibile: ?u=<post> apre subito la ricetta.
  const shared = new URLSearchParams(location.search).get('u');
  if (shared) { $('url').value = shared; start(shared); }
})();
