/* ============================================================
   F.A.R.T. — Flesh and Blood Playline Sandbox
   Step 1 skeleton: import a Fabrary deck list, review it,
   start a session, shuffle and draw an opening hand.

   No backend. All state lives in memory for the session.
   ============================================================ */

'use strict';

/* ---------- pitch colors / values ---------- */
const PITCH = {
  red:    { dot: '#c8463a', value: 1 },
  yellow: { dot: '#d6a531', value: 2 },
  blue:   { dot: '#5183bd', value: 3 },
};

/* ---------- hero → intellect lookup ----------
   Intellect (= hand size) is 4 for almost every hero in Flesh and Blood.
   We key on a normalized hero name (lower-case, first name is enough).
   Anything not listed defaults to 4, and there is always a manual override. */
const HERO_INTELLECT = {
  // Most heroes: 4. A few documented non-4 intellect heroes:
  'data doll mkii': 4,
  'genis, locus of malice': 4,
  // (kept small on purpose — manual override covers the rest)
};
const DEFAULT_INTELLECT = 4;

/* ============================================================
   Fabrary decklist parsing
   ============================================================ */

const PITCH_RE = /^(\d+)\s*x?\s+(.*?)\s*\((red|yellow|blue)\)\s*$/i;
const QTY_RE   = /^(\d+)\s*x?\s+(.+?)\s*$/i;

function isNoiseLine(line) {
  const l = line.trim();
  if (!l) return true;
  if (/^name\s*:/i.test(l)) return true;
  if (/^format\s*:/i.test(l)) return true;
  if (/^class\s*:/i.test(l)) return true;
  if (/^hero\s*:/i.test(l)) return true; // handled separately, skip as card
  if (/^arena cards\s*$/i.test(l)) return true;
  if (/^deck cards\s*$/i.test(l)) return true;
  if (/^equipment\s*$/i.test(l)) return true;
  if (/^weapons?\s*:/i.test(l)) return true;
  if (/^made with love/i.test(l)) return true;
  if (/^see the full deck/i.test(l)) return true;
  if (/^https?:\/\//i.test(l)) return true;
  return false;
}

/**
 * Parse a pasted Fabrary "copy deck list".
 * Returns { hero, deck: [{name,pitch,qty}], equipment: [{name,qty}] }.
 * Rules (per spec):
 *  - A line with a pitch tag (red/yellow/blue) is a DECK card (drawable).
 *  - A "Nx Name" line WITHOUT a pitch tag is ARENA/equipment (never drawn).
 *  - "//" inside a name is part of the single card name.
 */
function parseDecklist(text) {
  const lines = text.split(/\r?\n/);
  let hero = '';
  const deck = [];
  const equipment = [];
  let section = null; // 'arena' | 'deck' | null

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const heroMatch = line.match(/^hero\s*:\s*(.+)$/i);
    if (heroMatch) { hero = heroMatch[1].trim(); continue; }

    if (/^arena cards\s*$/i.test(line)) { section = 'arena'; continue; }
    if (/^deck cards\s*$/i.test(line)) { section = 'deck'; continue; }

    if (isNoiseLine(line)) continue;

    const pitchMatch = line.match(PITCH_RE);
    if (pitchMatch) {
      const qty = parseInt(pitchMatch[1], 10) || 1;
      const name = pitchMatch[2].trim();
      const pitch = pitchMatch[3].toLowerCase();
      mergeInto(deck, name, pitch, qty);
      continue;
    }

    // No pitch tag → equipment / arena card. Only accept "Nx Name" shapes.
    const qtyMatch = line.match(QTY_RE);
    if (qtyMatch) {
      const qty = parseInt(qtyMatch[1], 10) || 1;
      const name = qtyMatch[2].trim();
      mergeInto(equipment, name, null, qty);
    }
    // otherwise: unrecognized line, ignore.
  }

  return { hero, deck, equipment };
}

function mergeInto(list, name, pitch, qty) {
  const existing = list.find(e => e.name === name && e.pitch === pitch);
  if (existing) existing.qty += qty;
  else list.push({ name, pitch, qty });
}

function intellectForHero(hero) {
  if (!hero) return DEFAULT_INTELLECT;
  const key = hero.trim().toLowerCase();
  if (key in HERO_INTELLECT) return HERO_INTELLECT[key];
  // also try first-name match
  const first = key.split(',')[0].trim();
  for (const k in HERO_INTELLECT) {
    if (k.split(',')[0].trim() === first) return HERO_INTELLECT[k];
  }
  return DEFAULT_INTELLECT;
}

/* ============================================================
   Game state
   ============================================================ */

let uid = 0;
function makeCard(name, pitch) {
  return { id: ++uid, name, pitch }; // each physical copy is its own object
}

const State = {
  hero: '',
  intellect: DEFAULT_INTELLECT,
  // review-stage editable list (name/pitch/qty) before the session starts:
  reviewDeck: [],
  equipment: [],
  // live zones (arrays of card objects). Deck index 0 = TOP.
  deck: [],
  hand: [],
  arsenal: [],
  pitch: [],
  graveyard: [],
  banished: [],
  turn: 1,
  started: false,
};

function buildDeckFromReview() {
  const cards = [];
  for (const row of State.reviewDeck) {
    for (let i = 0; i < row.qty; i++) cards.push(makeCard(row.name, row.pitch));
  }
  return cards;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function startSession() {
  State.deck = shuffle(buildDeckFromReview());
  State.hand = [];
  State.arsenal = [];
  State.pitch = [];
  State.graveyard = [];
  State.banished = [];
  State.turn = 1;
  State.started = true;
  // draw opening hand to intellect
  drawN(State.intellect);
}

function drawN(n) {
  let drawn = 0;
  for (let i = 0; i < n && State.deck.length > 0; i++) {
    State.hand.push(State.deck.shift());
    drawn++;
  }
  return drawn;
}

/* ============================================================
   Card art / data — CardVault API (api.cardvault.fabtcg.com)
   ------------------------------------------------------------
   Chosen because it's the official live database, CORS-enabled
   for browser fetches, needs no API key, and returns the card
   image + pitch/cost/type keyed by name. The /advanced-search
   endpoint is FULL-TEXT, so we always exact-match printed_name
   client-side. Unmatched names (e.g. fictional cards) fall back
   to the styled placeholder face. Results are cached in-memory.
   ============================================================ */

const CARDVAULT_SEARCH = 'https://api.cardvault.fabtcg.com/carddb/api/v1/advanced-search/?page_size=60&orderby=name&q=';
const CardCache = new Map(); // normName -> { state, image, cost, type }

function normName(n) {
  return String(n || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function cardvaultLookup(name) {
  // try the full name first, then each face of a "A // B" double-faced card
  const queries = [name];
  if (name.includes('//')) {
    for (const part of name.split('//')) queries.push(part.trim());
  }
  for (const q of queries) {
    if (!q) continue;
    let data;
    try {
      const res = await fetch(CARDVAULT_SEARCH + encodeURIComponent(q));
      if (!res.ok) continue;
      data = await res.json();
    } catch (_) { continue; }
    const results = data.results || [];
    const want = normName(q);
    const hit = results.find(r => normName(r.printed_name) === want)
             || results.find(r => normName(r.printed_name).startsWith(want));
    if (hit) {
      const img = hit.faces && hit.faces[0] && hit.faces[0].image;
      return {
        image: img ? (img.normal || img.large || img.small) : null,
        cost: hit.printed_cost,
        type: hit.printed_typebox,
      };
    }
  }
  return null;
}

/** Resolve a card's data once, caching the result. Returns a Promise<entry>. */
function resolveCard(name) {
  const key = normName(name);
  const existing = CardCache.get(key);
  if (existing) return existing.promise || Promise.resolve(existing);
  const entry = { state: 'pending', image: null, cost: null, type: null };
  entry.promise = (async () => {
    try {
      const found = await cardvaultLookup(name);
      if (found) {
        entry.image = found.image;
        entry.cost = found.cost;
        entry.type = found.type;
        entry.state = 'done';
        if (entry.image) { const im = new Image(); im.src = entry.image; } // warm the browser image cache
      } else {
        entry.state = 'none';
      }
    } catch (_) {
      entry.state = 'none';
    }
    delete entry.promise;
    return entry;
  })();
  CardCache.set(key, entry);
  return entry.promise;
}

/** Kick off resolution for every face-up card on screen, then repaint each. */
function hydrateVisibleCards() {
  const seen = new Set();
  document.querySelectorAll('.card[data-cardname]').forEach(el => {
    const key = el.dataset.cardname;
    if (seen.has(key)) return;
    seen.add(key);
    const entry = CardCache.get(key);
    if (entry && entry.state !== 'pending') return; // already resolved
    resolveCard(el.dataset.realname).then(() => repaintCards(key));
  });
}

/** Replace every on-screen copy of a card with a freshly rendered face. */
function repaintCards(key) {
  document.querySelectorAll('.card[data-cardname]').forEach(el => {
    if (el.dataset.cardname !== key) return;
    const card = { name: el.dataset.realname, pitch: el.dataset.pitch };
    el.outerHTML = cardFaceHTML(card, { compact: el.classList.contains('compact') });
  });
}

/** Called from an <img onerror> — drop the broken art and fall back to placeholder. */
window.__cardImgFail = function (img) {
  const el = img.closest('.card');
  if (!el) return;
  const key = el.dataset.cardname;
  const entry = CardCache.get(key);
  if (entry) entry.image = null; // keep cost/type, just lose the image
  repaintCards(key);
};

/* ============================================================
   Card rendering
   - Real art when CardVault resolved an image for this name.
   - Otherwise the stylized placeholder (Card.dc.html), which
     always carries the card name + pitch color.
   ============================================================ */

function cardFaceHTML(card, opts = {}) {
  const p = PITCH[card.pitch] || PITCH.red;
  const compact = opts.compact ? ' compact' : '';
  const key = normName(card.name);
  const realname = escapeHtml(card.name);
  const dataAttrs = `data-cardname="${escapeAttr(key)}" data-realname="${escapeAttr(card.name)}" data-pitch="${card.pitch}"`;
  const entry = CardCache.get(key);

  // --- real card art ---
  if (entry && entry.state === 'done' && entry.image) {
    return `
    <div class="card pitch-${card.pitch}${compact} has-art" ${dataAttrs}>
      <div class="card-art">
        <img src="${escapeAttr(entry.image)}" alt="${realname}" onerror="window.__cardImgFail(this)">
      </div>
      <div class="card-frame"></div>
    </div>`;
  }

  // --- styled placeholder fallback ---
  const kind = (entry && entry.type) ? entry.type : (opts.kind || '');
  const costVal = (entry && entry.cost != null && entry.cost !== '') ? entry.cost
                  : (opts.cost != null ? opts.cost : null);
  const cost = (costVal != null) ? `<div class="card-cost">${escapeHtml(costVal)}</div>` : '';
  return `
    <div class="card pitch-${card.pitch}${compact}" ${dataAttrs}>
      <div class="card-art">
        <div class="tint"></div>
        ${kind ? `<div class="kind">${escapeHtml(kind)}</div>` : ''}
      </div>
      <div class="card-frame"></div>
      <div class="card-pip left">${p.value}</div>
      <div class="card-pip right">${p.value}</div>
      <div class="card-name">${realname}</div>
      ${cost}
    </div>`;
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function cardBackHTML(label = 'DECK') {
  return `
    <div class="card back">
      <div class="inner-frame"></div>
      <div class="glyph"><div><div></div></div></div>
      <div class="back-label">${escapeHtml(label)}</div>
    </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ============================================================
   Screen routing
   ============================================================ */

const app = () => document.getElementById('app');

function show(html) { app().innerHTML = html; }

function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ---------- Import screen ---------- */
function renderImport(prefill = '', errorMsg = '') {
  show(`
    <div class="setup-wrap screen">
      <div class="setup-head">
        <div class="diamond"><i></i></div>
        <span class="brand-name">F.A.R.T.</span>
      </div>

      <div>
        <div class="setup-title">Import Deck</div>
        <div class="setup-step">Step 1 of 2 · paste &amp; go</div>
      </div>

      <div class="paste-box">
        <div class="paste-label"><span class="dot"></span><span>Deck list</span></div>
        <textarea class="paste" id="paste" spellcheck="false"
          placeholder="Paste your Fabrary deck list here">${escapeHtml(prefill)}</textarea>
      </div>

      <div class="helper ${errorMsg ? 'error' : ''}">
        <span class="i">i</span>
        <span>${errorMsg ? escapeHtml(errorMsg) : 'Use Fabrary&rsquo;s &ldquo;copy deck list&rdquo; button.'}</span>
      </div>

      <div class="setup-actions">
        <div class="btn btn-primary btn-lg" id="import-btn">Import <span style="font-size:16px">&rarr;</span></div>
      </div>
    </div>
  `);

  document.getElementById('import-btn').onclick = () => {
    const text = document.getElementById('paste').value;
    const parsed = parseDecklist(text);
    if (parsed.deck.length === 0) {
      renderImport(text, 'No deck cards found. Make sure cards have a pitch tag like (red).');
      return;
    }
    State.hero = parsed.hero;
    State.intellect = intellectForHero(parsed.hero);
    State.reviewDeck = parsed.deck;
    State.equipment = parsed.equipment;
    prefetchDeck();   // warm card data + art now, while the user reviews the deck
    renderReview();
  };
}

/** Resolve every unique deck card's data + image up front so the session is fast. */
function prefetchDeck() {
  const seen = new Set();
  for (const row of State.reviewDeck) {
    const key = normName(row.name);
    if (seen.has(key)) continue;
    seen.add(key);
    resolveCard(row.name);   // fire-and-forget: caches data and preloads the image
  }
}

/* ---------- Review screen ---------- */
function deckTotal() {
  return State.reviewDeck.reduce((n, r) => n + r.qty, 0);
}

function renderReview() {
  const heroName = State.hero || 'Unknown hero';
  const rows = State.reviewDeck.map((r, i) => {
    const dot = (PITCH[r.pitch] || PITCH.red).dot;
    return `
      <div class="deck-row">
        <span class="swatch" style="background:${dot}; box-shadow:0 0 8px -1px ${dot}"></span>
        <span class="nm">${escapeHtml(r.name)}</span>
        <div class="qctrls">
          <div class="minus" data-i="${i}">&ndash;</div>
          <span class="qty">&times;${r.qty}</span>
        </div>
      </div>`;
  }).join('');

  const equip = State.equipment.length ? `
    <div class="equip-box">
      <div class="eh"><span class="t">Equipment</span><span class="note">not drawn &middot; reference only</span></div>
      ${State.equipment.map(e => `
        <div class="equip-row">
          <span class="d"></span>
          <span class="nm">${escapeHtml(e.name)}</span>
          <span style="font:500 10px var(--font-mono); color:#6f6452">${e.qty > 1 ? '&times;' + e.qty : ''}</span>
        </div>`).join('')}
    </div>` : '';

  show(`
    <div class="setup-wrap screen">
      <div class="setup-head" style="justify-content:space-between; width:100%">
        <div style="display:flex; align-items:center; gap:9px">
          <div class="diamond" style="width:22px;height:22px"><i style="width:6px;height:6px"></i></div>
          <span class="brand-name">F.A.R.T.</span>
        </div>
        <span style="font:500 10px var(--font-mono); letter-spacing:1px; color:var(--muted-2)">Step 2 of 2</span>
      </div>

      <div class="hero-band">
        <div class="info">
          <span class="eyebrow-sm">Hero detected</span>
          <span class="hero-name">${escapeHtml(heroName)}</span>
          <span class="hero-sub">Draw-up hand size from intellect</span>
        </div>
        <div class="intellect">
          <span class="lbl">Intellect</span>
          <div class="stepper">
            <button id="int-minus">&ndash;</button>
            <div class="val" id="int-val">${State.intellect}</div>
            <button id="int-plus">+</button>
          </div>
          <span class="cap">cards / hand</span>
        </div>
      </div>

      <div class="review-listhead">
        <span class="eyebrow">Deck list</span>
        <div class="count-chip">
          <span class="k">Deck</span>
          <span class="n" id="deck-total">${deckTotal()}</span>
          <span class="u">cards</span>
        </div>
      </div>

      <div class="deck-rows" id="deck-rows">${rows}</div>
      ${equip}

      <div class="setup-actions">
        <div class="btn btn-primary btn-lg" id="start-btn">Start Session <span style="font-size:16px">&rarr;</span></div>
        <div class="text-link" id="back-btn">&lsaquo; Back &amp; re-paste</div>
      </div>
    </div>
  `);

  document.getElementById('int-minus').onclick = () => {
    State.intellect = Math.max(0, State.intellect - 1);
    document.getElementById('int-val').textContent = State.intellect;
  };
  document.getElementById('int-plus').onclick = () => {
    State.intellect = Math.min(20, State.intellect + 1);
    document.getElementById('int-val').textContent = State.intellect;
  };
  document.getElementById('back-btn').onclick = () => renderImport();
  document.getElementById('start-btn').onclick = () => {
    startSession();
    renderPlay();
  };

  document.querySelectorAll('#deck-rows .minus').forEach(btn => {
    btn.onclick = () => {
      const i = parseInt(btn.dataset.i, 10);
      const row = State.reviewDeck[i];
      if (!row) return;
      row.qty -= 1;
      if (row.qty <= 0) State.reviewDeck.splice(i, 1);
      renderReview();
    };
  });
}

/* ---------- Play screen ---------- */
function isMobile() { return window.matchMedia('(max-width: 760px)').matches; }

function renderPlay() {
  if (isMobile()) renderPlayMobile();
  else renderPlayDesktop();
}

/* shared fragments used by both layouts */
function pitchResourceTotal() {
  return State.pitch.reduce((s, c) => s + (PITCH[c.pitch] ? PITCH[c.pitch].value : 0), 0);
}
function handCardsHTML() {
  return State.hand.map(c => `<div class="slot" data-id="${c.id}">${cardFaceHTML(c, {})}</div>`).join('');
}
/** staged pitch cards in order; `controls` adds the inline ◀ ↩ ▶ (desktop). */
function stagedPitchHTML(controls) {
  return State.pitch.map((c, i) => {
    const arrow = i < State.pitch.length - 1 ? '<div class="staged-arrow">&rarr;</div>' : '';
    const ctrls = controls ? `
        <div class="staged-ctrls">
          <button class="sc-move" data-id="${c.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="Move earlier">&#9664;</button>
          <button class="sc-remove" data-id="${c.id}" title="Return to hand">&#8629;</button>
          <button class="sc-move" data-id="${c.id}" data-dir="1" ${i === State.pitch.length - 1 ? 'disabled' : ''} title="Move later">&#9654;</button>
        </div>` : '';
    return `
      <div class="staged" data-id="${c.id}" draggable="true">
        <div class="order-num">${i + 1}</div>
        ${cardFaceHTML(c, {})}${ctrls}
      </div>${arrow}`;
  }).join('');
}

/* "N staged" pill — lets you review/reorder the pitch mid-turn (pitch commits on End Turn) */
function stagedPillHTML() {
  if (!State.pitch.length) return '';
  return `<div class="btn staged-pill" id="staged-pill"><span class="sp-dot">&#9670;</span> ${State.pitch.length} staged · ${pitchResourceTotal()}</div>`;
}
/* a clickable pile for graveyard/banished — opens the full-zone viewer */
function zonePileHTML(zone, label, w) {
  const arr = State[zone];
  const inner = arr.length
    ? `<div class="stack-shadow" style="left:3px;top:3px;width:${w}px;aspect-ratio:451/629"></div>
       <div style="position:relative">${cardFaceHTML(arr[arr.length - 1], {})}</div>
       <div class="pile-count">${arr.length}</div>`
    : '<div class="empty-slot">empty</div>';
  return `<div class="zone-pile" data-zoneview="${zone}">
      <span class="rail-label">${label}</span>
      <div class="pile card-clickable" style="width:${w}px">${inner}</div>
    </div>`;
}
function deckPileHTML() {
  return `<div class="zone-pile">
      <span class="rail-label">Deck</span>
      <div class="pile" style="width:108px">
        <div class="stack-shadow" style="left:8px; top:8px; width:108px; aspect-ratio:451/629"></div>
        <div class="stack-shadow" style="left:4px; top:4px; width:108px; aspect-ratio:451/629; background:#1b140c"></div>
        <div style="position:relative">${cardBackHTML('DECK')}</div>
        <div class="pile-count" id="deck-count">${State.deck.length}</div>
      </div>
      <div class="btn" id="peek-order-btn" style="margin-top:8px">
        <span style="width:7px;height:7px;border:1.5px solid var(--accent);transform:rotate(45deg);display:inline-block"></span>
        Peek order
      </div>
    </div>`;
}
function arsenalBlockHTML() {
  return `<div class="arsenal-under">
      <span class="rail-label">Arsenal</span>
      <div class="arsenal-cards row">
        ${State.arsenal.length
          ? State.arsenal.map(c => `<div class="arsenal-frame" data-id="${c.id}">${cardFaceHTML(c, {})}</div>`).join('')
          : '<div class="arsenal-frame"><div class="empty-slot">empty</div></div>'}
      </div>
    </div>`;
}

/* ---------- Desktop (deck right · arsenal under hand · pitch via End-Turn popup) ---------- */
function renderPlayDesktop() {
  const handCards = handCardsHTML();

  show(`
    <div class="play screen">
      <div class="topbar">
        <div class="brandmark">
          <div class="diamond"><i></i></div>
          <div style="display:flex; flex-direction:column; gap:2px">
            <span class="brand-name">F.A.R.T.</span>
            <span class="brand-sub">Faux Again Repetition Tool${State.hero ? ' · ' + escapeHtml(State.hero) : ''}</span>
          </div>
        </div>
        <div class="right">
          <div class="stat"><span class="k">Turn</span><span class="v" id="turn-v">${String(State.turn).padStart(2,'0')}</span></div>
          <div class="stat"><span class="k">Hand</span><span class="v" id="hand-v">${State.hand.length}</span></div>
          ${stagedPillHTML()}
          <div class="divider-v"></div>
          <div class="btn" id="peek-btn">Peek Deck</div>
          <div class="btn" id="reset-btn">Reset</div>
          <div class="btn btn-outline" id="endturn-btn">End Turn &uarr;</div>
          <div class="btn btn-primary" id="draw-btn">Draw</div>
        </div>
      </div>

      <div class="field">
        <!-- left spacer keeps the hand centered -->
        <div class="rail left spacer"></div>

        <!-- center: hand + arsenal underneath -->
        <div class="center">
          <div class="hand-wrap">
            <span class="rail-label" style="margin:0">Hand</span>
            <div class="hand" id="hand">${handCards || '<span style="color:var(--muted-3); font:500 12px var(--font-mono)">empty</span>'}</div>
          </div>
          ${arsenalBlockHTML()}
        </div>

        <!-- right rail: graveyard / deck / banished (stacked) -->
        <div class="rail right">
          ${zonePileHTML('graveyard', 'Graveyard', 92)}
          ${deckPileHTML()}
          ${zonePileHTML('banished', 'Banished', 92)}
        </div>
      </div>
    </div>
  `);

  wirePlayHandlers();
}

/* ---------- handler wiring shared by both layouts (same element ids) ---------- */
function wirePlayHandlers() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };

  on('draw-btn', () => {
    if (State.deck.length === 0) { toast('Deck is empty'); return; }
    drawN(1);
    renderPlay();
  });
  on('reset-btn', () => {
    startSession();
    renderPlay();
    toast('Reshuffled · new opening hand');
  });
  // End Turn: only show the pitch-order popup when there are 2+ cards to order;
  // with 0 or 1 staged there's nothing to arrange, so just commit + draw up.
  on('endturn-btn', () => {
    if (State.pitch.length > 1) openPitchPopup({ endTurn: true });
    else finishTurnWithPitch();
  });
  on('staged-pill', () => openPitchPopup({ endTurn: false }));  // review/reorder mid-turn
  on('peek-btn', togglePeek);
  on('peek-order-btn', togglePeek);          // desktop only
  on('deck-chip', togglePeek);               // mobile: tap deck pile to peek

  // --- hand: tap a card to zoom + act on it ---
  document.querySelectorAll('#hand .slot').forEach(slot => {
    slot.addEventListener('click', () => showCardZoom(handCardById(slot.dataset.id), 'hand'));
  });

  // --- arsenal: tap a card to zoom + act ---
  document.querySelectorAll('.arsenal-frame[data-id]').forEach(el => {
    el.addEventListener('click', () => showCardZoom(zoneCardById('arsenal', el.dataset.id), 'arsenal'));
  });
  // --- arsenal pile chip (mobile): zoom the set-aside card ---
  document.querySelectorAll('[data-zoneclick]').forEach(el => {
    el.addEventListener('click', () => {
      const zone = el.dataset.zoneclick;
      const arr = State[zone];
      if (!arr.length) return;
      showCardZoom(arr[arr.length - 1], zone);
    });
  });
  // --- graveyard / banished: open the full-zone viewer ---
  document.querySelectorAll('[data-zoneview]').forEach(el => {
    el.addEventListener('click', () => openZoneViewer(el.dataset.zoneview));
  });

  // fetch real card art for everything currently on the table
  hydrateVisibleCards();
}

/* ---------- Mobile (stacked, scroll + bottom action bar) ---------- */
function renderPlayMobile() {
  const pitchTotal = pitchResourceTotal();
  const handCards = handCardsHTML();

  const miniBack = `<div style="width:38px">${cardBackHTML('')}</div>`;
  const miniTop = (zone) => {
    const arr = State[zone];
    if (!arr.length) return '<div style="width:38px"><div class="empty-slot" style="font-size:7px">·</div></div>';
    return `<div style="width:38px">${cardFaceHTML(arr[arr.length - 1], { compact: true })}</div>`;
  };
  // deck → peek; graveyard/banished → full-zone viewer; arsenal → act on set-aside card
  const chipAttr = (zone) =>
    zone === 'deck' ? 'id="deck-chip"'
    : (zone === 'graveyard' || zone === 'banished') ? `data-zoneview="${zone}"`
    : `data-zoneclick="${zone}"`;
  const pileChip = (zone, label, count, inner, extra = '') =>
    `<div class="m-pile ${extra}" ${chipAttr(zone)}>
       ${inner}
       <div class="m-pile-meta"><span class="rail-label">${label}</span><span class="m-pile-count">${count}</span></div>
     </div>`;

  show(`
    <div class="play mobile screen">
      <div class="m-header">
        <div class="brandmark">
          <div class="diamond" style="width:24px;height:24px;border-width:1.4px"><i style="width:7px;height:7px"></i></div>
          <span class="brand-name" style="font-size:15px;letter-spacing:2px">F.A.R.T.</span>
        </div>
        <div class="m-chips">
          <div class="chip"><span>Turn</span><b id="turn-v">${String(State.turn).padStart(2, '0')}</b></div>
          <div class="chip"><span>Hand</span><b id="hand-v">${State.hand.length}</b></div>
        </div>
      </div>

      <div class="m-scroll">
        <div class="m-piles">
          ${pileChip('deck', 'Deck', State.deck.length, miniBack)}
          ${pileChip('graveyard', 'Graveyard', State.graveyard.length, miniTop('graveyard'))}
          ${pileChip('banished', 'Banished', State.banished.length, miniTop('banished'))}
          ${pileChip('arsenal', 'Arsenal', State.arsenal.length, miniTop('arsenal'), 'accent')}
        </div>

        ${State.pitch.length ? `<div class="m-staged" id="staged-pill"><span class="sp-dot">&#9670;</span> ${State.pitch.length} staged to pitch · ${pitchTotal} resources <span class="m-staged-go">review &rsaquo;</span></div>` : ''}

        <div class="m-hand">
          <span class="rail-label">Hand &middot; ${State.hand.length}</span>
          <div class="m-hand-grid" id="hand">${handCards || '<span style="color:var(--muted-3); font:500 12px var(--font-mono)">empty</span>'}</div>
        </div>
      </div>

      <div class="m-actionbar">
        <div class="btn btn-primary" id="draw-btn" style="flex:1.4">Draw</div>
        <div class="btn btn-outline" id="endturn-btn" style="flex:1.2">End Turn</div>
        <div class="btn" id="reset-btn" style="flex:1">Reset</div>
        <div class="btn" id="peek-btn" style="flex:1">Peek</div>
      </div>
    </div>
  `);

  wirePlayHandlers();
}

/* ---------- card action menu + pitch actions ---------- */
function handCardById(id) {
  return State.hand.find(c => String(c.id) === String(id));
}

/** The actions available for a card depending on which zone it's in. */
function cardActionItems(card, zone) {
  const items = [];
  if (zone === 'hand') {
    items.push({ label: 'Pitch', sub: 'stage → bottom of deck', on: () => pitchCard(card.id, 'hand') });
    items.push({ label: 'Play / Discard', sub: '→ graveyard', on: () => discardCard(card.id, 'hand') });
    items.push({ label: 'Arsenal', sub: 'set aside', on: () => arsenalCard(card.id, 'hand') });
    items.push({ label: 'Banish', sub: 'remove from play', on: () => banishCard(card.id, 'hand') });
  } else if (zone === 'arsenal') {
    items.push({ label: 'Play / Discard', sub: '→ graveyard', on: () => discardCard(card.id, 'arsenal') });
    items.push({ label: 'Pitch', sub: 'stage → bottom', on: () => pitchCard(card.id, 'arsenal') });
    items.push({ label: 'Return to hand', on: () => returnToHand(card.id, 'arsenal') });
    items.push({ label: 'Banish', sub: 'remove from play', on: () => banishCard(card.id, 'arsenal') });
  } else if (zone === 'graveyard') {
    items.push({ label: 'Return to hand', on: () => returnToHand(card.id, 'graveyard') });
    items.push({ label: 'Banish', sub: 'remove from play', on: () => banishCard(card.id, 'graveyard') });
  } else if (zone === 'banished') {
    items.push({ label: 'Return to hand', on: () => returnToHand(card.id, 'banished') });
    items.push({ label: 'To graveyard', on: () => discardCard(card.id, 'banished') });
  }
  return items;
}

function closeCardZoom() {
  const z = document.getElementById('card-zoom');
  if (z) z.remove();
}

/** Tap a card → big readable version + its actions. Tap anywhere (not a button) to dismiss. */
function showCardZoom(card, zone) {
  closeCardZoom();
  if (!card) return;
  const items = cardActionItems(card, zone);
  const pv = PITCH[card.pitch] ? PITCH[card.pitch].value : '';
  const actions = items.length
    ? `<div class="cz-actions">${items.map((it, i) =>
        `<button class="cz-btn" data-idx="${i}">${escapeHtml(it.label)}${it.sub ? `<span class="cz-sub">${escapeHtml(it.sub)}</span>` : ''}</button>`
      ).join('')}</div>`
    : '';

  const el = document.createElement('div');
  el.id = 'card-zoom';
  el.className = 'card-zoom';
  el.innerHTML = `
    <div class="cz-inner">
      <div class="cz-meta"><span class="cz-name">${escapeHtml(card.name)}</span><span class="cz-pitch pitch-${card.pitch}">${pv}</span></div>
      <div class="cz-card">${cardFaceHTML(card, {})}</div>
      ${actions}
      <div class="cz-hint">tap anywhere to close</div>
    </div>`;
  document.body.appendChild(el);

  // tap anywhere except an action button closes the zoom
  el.addEventListener('click', (e) => { if (!e.target.closest('.cz-btn')) closeCardZoom(); });
  el.querySelectorAll('.cz-btn').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); const it = items[+btn.dataset.idx]; closeCardZoom(); it.on(); };
  });
  hydrateVisibleCards();
}

/** Move a card from one zone array to the end of another, then re-render. */
function moveCard(id, fromZone, toZone) {
  const arr = State[fromZone];
  const i = arr.findIndex(c => String(c.id) === String(id));
  if (i < 0) return null;
  const [card] = arr.splice(i, 1);
  State[toZone].push(card);
  renderPlay();
  // if a zone viewer is open, refresh it (a card just left/entered a zone)
  if (openZone) openZoneViewer(openZone);
  return card;
}

function zoneCardById(zone, id) {
  return State[zone].find(c => String(c.id) === String(id));
}

function pitchCard(id, fromZone = 'hand') {
  const arr = State[fromZone];
  const i = arr.findIndex(c => String(c.id) === String(id));
  if (i < 0) return;
  const [card] = arr.splice(i, 1);
  State.pitch.push(card);
  renderPlay();
}

function discardCard(id, fromZone = 'hand') {
  const c = moveCard(id, fromZone, 'graveyard');
  if (c) toast(`${c.name} → graveyard`);
}
function arsenalCard(id, fromZone = 'hand') {
  const c = moveCard(id, fromZone, 'arsenal');
  if (c) toast(`${c.name} → arsenal`);
}
function banishCard(id, fromZone = 'hand') {
  const c = moveCard(id, fromZone, 'banished');
  if (c) toast(`${c.name} → banished`);
}
function returnToHand(id, fromZone) {
  const c = moveCard(id, fromZone, 'hand');
  if (c) toast(`${c.name} → hand`);
}
function unstagePitch(id) {
  const i = State.pitch.findIndex(c => String(c.id) === String(id));
  if (i < 0) return;
  const [card] = State.pitch.splice(i, 1);
  State.hand.push(card);
  renderPlay();
}
function movePitch(id, dir) {
  const i = State.pitch.findIndex(c => String(c.id) === String(id));
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= State.pitch.length) return;
  [State.pitch[i], State.pitch[j]] = [State.pitch[j], State.pitch[i]];
  renderPlay();
}
function reorderPitch(fromId, toId) {
  if (String(fromId) === String(toId)) return;
  const from = State.pitch.findIndex(c => String(c.id) === String(fromId));
  const to = State.pitch.findIndex(c => String(c.id) === String(toId));
  if (from < 0 || to < 0) return;
  const [card] = State.pitch.splice(from, 1);
  State.pitch.splice(to, 0, card);
  renderPlay();
}
/** Move staged pitch cards to the BOTTOM of the deck in their staged order. */
function commitPitchCards() {
  if (!State.pitch.length) return 0;
  const n = State.pitch.length;
  State.deck.push(...State.pitch);   // index 0 = top, so push = bottom; order #1 cycles back first
  State.pitch = [];
  return n;
}
function commitPitch() {
  const n = commitPitchCards();
  renderPlay();
  if (n) toast(`${n} card${n > 1 ? 's' : ''} sent to bottom of deck`);
}

/* ---------- pitch popup (modal on desktop, bottom sheet on mobile) ----------
   Pitch is finalized here: arrange the cards staged this turn, then either
   commit them to the bottom of the deck, or confirm + end the turn. */
function openPitchPopup(opts) { renderPitchPopup(opts || {}); }
function closePitchSheet() {
  const s = document.getElementById('pitch-sheet');
  if (s) s.remove();
}
function finishTurnWithPitch() {
  const committed = commitPitchCards();
  const need = State.intellect - State.hand.length;
  if (need > 0) drawN(need);
  State.turn += 1;
  closePitchSheet();
  renderPlay();
  const parts = [];
  if (committed) parts.push(`pitched ${committed} to bottom`);
  parts.push(need > 0 ? `drew up to ${State.intellect}` : `turn ${State.turn}`);
  toast(parts.join(' · '));
}
function renderPitchPopup(opts) {
  closePitchSheet();
  const endTurn = !!opts.endTurn;
  const has = State.pitch.length > 0;
  const total = pitchResourceTotal();

  const rows = has ? State.pitch.map((c, i) => {
    const pv = PITCH[c.pitch] ? PITCH[c.pitch].value : '';
    return `
      <div class="ps-row" data-id="${c.id}" draggable="true">
        <div class="order-num">${i + 1}</div>
        <div class="ps-card">${cardFaceHTML(c, { compact: true })}</div>
        <div class="ps-info">
          <span class="ps-name">${escapeHtml(c.name)}</span>
          <span class="ps-sub">pitch ${pv} &middot; ${c.pitch}</span>
        </div>
        <div class="ps-arrows">
          <button class="ps-up" data-id="${c.id}" ${i === 0 ? 'disabled' : ''}>&#9650;</button>
          <button class="ps-rm" data-id="${c.id}" title="Return to hand">&#8629;</button>
          <button class="ps-down" data-id="${c.id}" ${i === State.pitch.length - 1 ? 'disabled' : ''}>&#9660;</button>
        </div>
      </div>`;
  }).join('') : `<div class="ps-empty">No cards staged to pitch.<br>Use a card&rsquo;s <b>Pitch</b> action during your turn to stack it here.</div>`;

  let foot;
  if (endTurn) {
    foot = `
      <div class="btn" id="ps-cancel" style="flex:1">Cancel</div>
      <div class="btn btn-primary" id="ps-confirm" style="flex:1.7">${has ? `Pitch ${State.pitch.length} &amp; End Turn &uarr;` : 'End Turn · draw up &uarr;'}</div>`;
  } else {
    foot = `
      ${has ? '<div class="btn" id="ps-pitchnow" style="flex:1">Send to bottom now &darr;</div>' : ''}
      <div class="btn btn-primary" id="ps-done" style="flex:1.6">Done</div>`;
  }

  const sheet = document.createElement('div');
  sheet.id = 'pitch-sheet';
  sheet.className = 'sheet';
  sheet.innerHTML = `
    <div class="sheet-scrim" id="ps-scrim"></div>
    <div class="sheet-panel">
      <div class="sheet-grip"></div>
      <div class="sheet-head">
        <div>
          <div class="sheet-title">PITCH SEQUENCE</div>
          <div class="sheet-sub">${endTurn ? 'set the order they return to the bottom of the deck' : 'tap &#9650;&#9660; or drag to set resolve order'}</div>
        </div>
        <div class="ring">${total}</div>
      </div>
      <div class="sheet-body">${rows}</div>
      <div class="sheet-foot">${foot}</div>
    </div>`;
  document.body.appendChild(sheet);

  document.getElementById('ps-scrim').onclick = closePitchSheet;
  const reopen = () => renderPitchPopup(opts);
  const onId = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  onId('ps-cancel', closePitchSheet);
  onId('ps-done', closePitchSheet);
  onId('ps-confirm', finishTurnWithPitch);
  onId('ps-pitchnow', () => { closePitchSheet(); commitPitch(); });
  sheet.querySelectorAll('.ps-up').forEach(b => b.onclick = () => { movePitch(+b.dataset.id, -1); reopen(); });
  sheet.querySelectorAll('.ps-down').forEach(b => b.onclick = () => { movePitch(+b.dataset.id, 1); reopen(); });
  sheet.querySelectorAll('.ps-rm').forEach(b => b.onclick = () => { unstagePitch(+b.dataset.id); reopen(); });
  sheet.querySelectorAll('.ps-row').forEach(el => {
    el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', el.dataset.id); el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', e => e.preventDefault());
    el.addEventListener('drop', e => { e.preventDefault(); reorderPitch(+e.dataTransfer.getData('text/plain'), +el.dataset.id); reopen(); });
  });
  hydrateVisibleCards();
}

/* ---------- zone viewer: show ALL cards in graveyard / banished ---------- */
let openZone = null;
function closeZoneViewer() {
  const e = document.getElementById('zone-viewer');
  if (e) e.remove();
  openZone = null;
}
function openZoneViewer(zone) {
  closeZoneViewer();
  openZone = zone;
  const cards = State[zone];
  const label = zone.charAt(0).toUpperCase() + zone.slice(1);
  const grid = cards.length
    ? cards.map(c => `<div class="zv-card" data-id="${c.id}">${cardFaceHTML(c, {})}</div>`).join('')
    : '<div class="ps-empty">No cards here yet.</div>';

  const el = document.createElement('div');
  el.id = 'zone-viewer';
  el.className = 'sheet';
  el.innerHTML = `
    <div class="sheet-scrim" id="zv-scrim"></div>
    <div class="sheet-panel">
      <div class="sheet-grip"></div>
      <div class="sheet-head">
        <div>
          <div class="sheet-title">${label.toUpperCase()}</div>
          <div class="sheet-sub">${cards.length} card${cards.length !== 1 ? 's' : ''}${cards.length ? ' · tap a card to act' : ''}</div>
        </div>
        <div class="zv-close" id="zv-close">&times;</div>
      </div>
      <div class="sheet-body"><div class="zv-grid">${grid}</div></div>
    </div>`;
  document.body.appendChild(el);

  document.getElementById('zv-scrim').onclick = closeZoneViewer;
  document.getElementById('zv-close').onclick = closeZoneViewer;
  el.querySelectorAll('.zv-card').forEach(cardEl => {
    cardEl.addEventListener('click', () => showCardZoom(zoneCardById(zone, cardEl.dataset.id), zone));
  });
  hydrateVisibleCards();
}

/* ---------- Peek panel ---------- */
let peekOpen = false;
function togglePeek() {
  peekOpen = !peekOpen;
  const existing = document.getElementById('peek-panel');
  if (existing) existing.remove();
  if (!peekOpen) return;

  const items = State.deck.map((c, i) => {
    const dot = (PITCH[c.pitch] || PITCH.red).dot;
    return `
      <div class="peek-item">
        <span class="pos">${String(i + 1).padStart(2, '0')}</span>
        <span class="swatch" style="background:${dot}; box-shadow:0 0 7px -1px ${dot}"></span>
        <span class="nm">${escapeHtml(c.name)}</span>
      </div>`;
  }).join('');

  const panel = document.createElement('div');
  panel.id = 'peek-panel';
  panel.className = 'peek-panel';
  panel.innerHTML = `
    <div class="peek-head">
      <div>
        <div class="t">DECK ORDER</div>
        <div class="s">top &rarr; bottom &middot; ${State.deck.length} cards</div>
      </div>
      <div class="peek-close" id="peek-close">&times;</div>
    </div>
    <div class="peek-list">${items || '<div style="color:var(--muted-3); padding:10px; font:500 12px var(--font-mono)">deck empty</div>'}</div>
  `;
  document.body.appendChild(panel);
  document.getElementById('peek-close').onclick = togglePeek;
}

/* ---------- easter egg: click the F.A.R.T. logo for a puff of gas + a brap ---------- */
let _fartCtx = null;
function playFart() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    _fartCtx = _fartCtx || new AC();
    const ctx = _fartCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const dur = 0.42 + Math.random() * 0.18;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150 + Math.random() * 40, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + dur);
    // square LFO on the frequency makes the sputter
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.setValueAtTime(16, now);
    lfo.frequency.linearRampToValueAtTime(34, now + dur);
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 45;
    lfo.connect(lfoGain).connect(osc.frequency);
    // lowpass softens the buzz over time
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1100, now);
    lp.frequency.exponentialRampToValueAtTime(400, now + dur);
    // amplitude envelope
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.55, now + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(lp).connect(g).connect(ctx.destination);
    osc.start(now); lfo.start(now);
    osc.stop(now + dur); lfo.stop(now + dur);
  } catch (_) {}
}
function spawnGasPuff(anchor) {
  const r = anchor.getBoundingClientRect();
  const cont = document.createElement('div');
  cont.className = 'gas-burst';
  cont.style.left = (r.left + r.width / 2) + 'px';
  cont.style.top = (r.top + r.height / 2) + 'px';
  for (let i = 0; i < 7; i++) {
    const p = document.createElement('span');
    p.className = 'gas-puff';
    const ang = (-90 + (Math.random() * 110 - 55)) * Math.PI / 180; // spread upward
    const dist = 26 + Math.random() * 50;
    p.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
    p.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
    p.style.setProperty('--s', (0.7 + Math.random() * 0.9).toFixed(2));
    p.style.animationDelay = Math.round(Math.random() * 90) + 'ms';
    cont.appendChild(p);
  }
  document.body.appendChild(cont);
  setTimeout(() => cont.remove(), 1200);
}
function fartEasterEgg(anchor) { playFart(); spawnGasPuff(anchor); }

/* ---------- boot ---------- */
window.addEventListener('DOMContentLoaded', () => renderImport());

// the logo (diamond + wordmark) is the easter-egg trigger on every screen
document.addEventListener('click', (e) => {
  const logo = e.target.closest('.brand-name, .diamond');
  if (logo) fartEasterEgg(logo);
});

// re-render the play screen when crossing the mobile/desktop breakpoint
let _wasMobile = isMobile();
window.addEventListener('resize', () => {
  const m = isMobile();
  if (m === _wasMobile) return;
  _wasMobile = m;
  if (State.started) { closePitchSheet(); closeZoneViewer(); closeCardZoom(); renderPlay(); }
});
