// 생명의 계통수 — 화면 / 입력 처리
import * as E from './engine.js';
import {
  CARDS, TERRAIN, NODES, LINEAGES, TRAITS, TRAIT_COST, RESEARCH, ACHIEVEMENTS, STARTER_PILES, MARKERS,
} from './data.js';
import { FirebaseNet, LocalNet, getUid } from './net.js';
import { aiAction, aiToMove } from './ai.js';
import { firebaseConfig } from './firebase-config.js';

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const img = id => `img/cards/${id}.jpg`;
const AI_NAMES = ['다윈', '멘델', '린네', '월리스', '라마르크'];
const TICON = { G: '🌾', W: '🌊', F: '🌲', D: '🏜️' };
const configured = !!firebaseConfig?.databaseURL && !/your-project/i.test(firebaseConfig.databaseURL);

const V = {
  screen: 'home', net: null, mode: null, code: null, room: null, uid: getUid(),
  name: (() => { try { return localStorage.getItem('tol_name') || ''; } catch { return ''; } })(),
  picking: null, busy: false, spectator: false, tab: 'log', showScores: false, lastLogSeq: -1,
};

// ───────────────────────── 공용 헬퍼 ─────────────────────────
const S = () => V.room?.state;
function actorId() {
  const s = S();
  if (!s) return V.uid;
  if (V.mode !== 'local') return V.uid;
  // 로컬: 지금 행동해야 하는 사람 플레이어. AI 차례면 마지막으로 조작한 사람 시점 유지
  const pd = s.pending;
  let id;
  if (pd?.kind === 'attack') id = pd.targets.find(t => pd.resp[t] == null);
  if (!id) id = s.phase === 'setup' ? s.players[s.players.length - 1 - s.setupStep].id : s.phase === 'play' ? E.curPlayer(s).id : null;
  const human = id && !s.players.find(p => p.id === id)?.ai ? id : null;
  if (human) V.lastHuman = human;
  if (!s.players.some(p => p.id === V.lastHuman && !p.ai)) V.lastHuman = s.players.find(p => !p.ai)?.id;
  return human || V.lastHuman || s.players[0].id;
}
const meP = () => S()?.players.find(p => p.id === actorId());
const pById = id => S()?.players.find(p => p.id === id);
const myTurn = () => { const s = S(); return s && s.phase === 'play' && E.curPlayer(s).id === actorId(); };
const canAct = () => myTurn() && !S().pending;

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), ms);
}

async function act(action) {
  if (V.busy) return;
  V.busy = true;
  try { await V.net.act(V.code, action, actorId()); }
  catch (e) { toast('⚠ ' + e.message, 4000); }
  finally { V.busy = false; }
}

// ───────────────────────── 모달 ─────────────────────────
function modal({ title, body = '', buttons = [], wide = false, onMount }) {
  return new Promise(resolve => {
    const root = $('#modal-root');
    const wrap = document.createElement('div');
    wrap.className = 'modal-back';
    wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}"><h3>${title}</h3><div class="modal-body">${body}</div>
      <div class="modal-btns">${buttons.map((b, i) => `<button data-i="${i}" class="${b.cls || ''}" ${b.disabled ? 'disabled' : ''}>${b.label}</button>`).join('')}</div></div>`;
    root.appendChild(wrap);
    const close = v => { wrap.remove(); resolve(v); };
    wrap.addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if (b) { const btn = buttons[+b.dataset.i]; close(btn.value !== undefined ? (typeof btn.value === 'function' ? btn.value(wrap) : btn.value) : undefined); }
      else if (e.target === wrap && buttons.some(b => b.cancel)) close(null);
    });
    onMount?.(wrap, close);
  });
}
const alertBox = (title, body) => modal({ title, body, buttons: [{ label: '확인', value: true }] });

// 여러 항목 중 min~max개 고르기
function chooseMulti({ title, items, min = 0, max = 1, note = '', cancel = true }) {
  const body = `${note ? `<p class="note">${note}</p>` : ''}<div class="pick-grid">${items.map((it, i) =>
    `<label class="pick-item ${it.img ? 'with-img' : ''}"><input type="checkbox" data-k="${i}">${it.img ? `<img src="${it.img}" alt="">` : ''}<span>${it.label}</span></label>`).join('')}</div>
    <p class="note">선택: <b class="cnt">0</b> / ${min === max ? max : `${min}~${max}`}</p>`;
  return modal({
    title, body, wide: items.some(i => i.img),
    buttons: [
      ...(cancel ? [{ label: '취소', value: null, cancel: true, cls: 'ghost' }] : []),
      { label: '확인', cls: 'primary', value: w => [...w.querySelectorAll('input:checked')].map(x => items[+x.dataset.k].value) },
    ],
    onMount: (w, close) => {
      const ok = w.querySelector('.modal-btns button.primary');
      const upd = () => {
        const n = w.querySelectorAll('input:checked').length;
        w.querySelector('.cnt').textContent = n;
        ok.disabled = n < min || n > max;
        if (n >= max) w.querySelectorAll('input:not(:checked)').forEach(x => x.disabled = true);
        else w.querySelectorAll('input').forEach(x => x.disabled = false);
      };
      w.addEventListener('change', upd); upd();
    },
  });
}
function chooseOne({ title, options, note = '', cancel = true }) {
  return modal({
    title, body: note ? `<p class="note">${note}</p>` : '',
    buttons: [...options.map(o => ({ label: o.label, value: o.value, disabled: o.disabled, cls: o.cls || '' })),
      ...(cancel ? [{ label: '취소', value: null, cancel: true, cls: 'ghost' }] : [])],
  });
}
const CANCEL = Symbol('cancel');
async function must(p) { const v = await p; if (v === null || v === undefined) throw CANCEL; return v; }

// ───────────────────────── 타일 고르기 ─────────────────────────
function pickTile({ title, valid, skippable = false, sim }) {
  return new Promise((resolve, reject) => {
    V.picking = { title, valid, skippable, sim, resolve, reject };
    render();
  });
}
function endPick(v, cancel) {
  const pk = V.picking; if (!pk) return;
  V.picking = null; render();
  cancel ? pk.reject(CANCEL) : pk.resolve(v);
}

async function pickPlaces(n, o = {}) {
  const me = meP(), out = [];
  const sim = clone(S());
  o.prepare?.(sim);
  for (let k = 0; k < n; k++) {
    if (E.markersLeft(sim, me.id) <= 0) { toast('남은 개체 마커가 없습니다.'); break; }
    const ignoreAdj = o.ignoreAdj && k < (o.ignoreAdjN ?? n);
    const valid = i => {
      if (o.filter) { const f = o.filter(i, out); if (f) return f; }
      const why = E.canPlace(sim, me.id, i, { ignoreAdj });
      if (!why) return null;
      if (o.overOnce && out.overTile == null && !E.canPlace(sim, me.id, i, { ignoreAdj, overK: 1 })) return null;
      return why;
    };
    if (!sim.map.tiles.some((_, i) => !valid(i))) { toast('더 놓을 수 있는 타일이 없습니다.'); break; }
    const t = await pickTile({ title: `${o.label || '배치'} — 개체를 놓을 타일을 고르세요 (${k + 1}/${n})`, valid, skippable: true, sim });
    if (t == null) break;
    if (o.overOnce && out.overTile == null && E.canPlace(sim, me.id, t, { ignoreAdj })) out.overTile = t;
    sim.map.tiles[t].pcs[me.id] = (sim.map.tiles[t].pcs[me.id] || 0) + 1;
    out.push(t);
  }
  return out;
}
async function pickMoves(n, { adj, label }) {
  const me = meP(), out = [];
  const sim = clone(S());
  for (let k = 0; k < n; k++) {
    const from = await pickTile({
      title: `${label} — 옮길 자기 개체가 있는 타일 (${k + 1}/${n})`, skippable: true, sim,
      valid: i => (sim.map.tiles[i].pcs[me.id] || 0) > 0 ? null : '자기 개체가 없습니다.',
    });
    if (from == null) break;
    const to = await pickTile({
      title: `${label} — ${from + 1}번 타일의 개체를 옮길 곳`, skippable: true, sim,
      valid: i => E.canMove(sim, me.id, from, i, { adj }),
    });
    if (to == null) break;
    sim.map.tiles[from].pcs[me.id]--; if (!sim.map.tiles[from].pcs[me.id]) delete sim.map.tiles[from].pcs[me.id];
    sim.map.tiles[to].pcs[me.id] = (sim.map.tiles[to].pcs[me.id] || 0) + 1;
    out.push([from, to]);
  }
  return out;
}
function oppPiecesOn(s, me, i) {
  const t = s.map.tiles[i];
  return Object.entries(t.pcs).filter(([id, c]) => id !== me.id && c > 0);
}
async function pickRemovalTile(label) {
  const s = S(), me = meP();
  return must(pickTile({
    title: `${label} — 제거할 상대 개체가 있는 타일 (내 개체도 있어야 함)`,
    valid: i => (s.map.tiles[i].pcs[me.id] || 0) <= 0 ? '같은 타일에 자기 개체가 있어야 합니다.' : oppPiecesOn(s, me, i).length ? null : '상대 개체가 없습니다.',
  }));
}

// ───────────────────────── 카드 사용 흐름 ─────────────────────────
async function collectParams(id) {
  const s = S(), me = meP(), c = CARDS[id];
  const F = E.hasTrait(me, 'TR12') ? 1 : 0;
  const enh = E.enhanced(s, me, c.terr);
  const L = c.name;
  switch (id) {
    case 'ST05': return { places: await pickPlaces(1 + F, { label: L }) };
    case 'ST06': {
      const rest = [...me.hand]; rest.splice(rest.indexOf(id), 1);
      if (!rest.length) throw new Error('제거할 손패가 없습니다.');
      const [t] = await must(chooseMulti({ title: '영구 제거할 손패 1장', items: rest.map(h => ({ label: CARDS[h].name, value: h, img: img(h) })), min: 1, max: 1 }));
      return { trash: t };
    }
    case 'ST08': {
      const mode = await must(chooseOne({ title: '확산(이주)', options: [{ label: '자기 개체 1개를 임의의 타일로 옮기기', value: 'move' }, { label: '새 개체 1개 배치', value: 'place' }] }));
      if (mode === 'move') {
        const mv = await pickMoves(1, { adj: false, label: L });
        if (!mv.length) throw CANCEL;
        return { mode, move: mv[0], places: F ? await pickPlaces(F, { label: '다산', prepare: sm => { const [a, b] = mv[0]; sm.map.tiles[a].pcs[me.id]--; sm.map.tiles[b].pcs[me.id] = (sm.map.tiles[b].pcs[me.id] || 0) + 1; } }) : [] };
      }
      return { mode, places: await pickPlaces(1 + F, { label: L }) };
    }
    case 'ST09': {
      const opts = me.nodes.filter(n => n !== 'LUCA').flatMap(l => E.displayOptions(s, l));
      let display = null;
      if (opts.length) {
        const r = await chooseMulti({ title: '진열할 계통 더미 1종', note: '자기가 개방한 계통만 진열할 수 있습니다. 최상위 계통은 종료 트랙이 전진합니다.', items: opts.map(o => ({ label: `${CARDS[o].name} (${LINEAGES[CARDS[o].lin]}, ${s.lineagePiles[o]}장)`, value: o, img: img(o) })), min: 0, max: 1 });
        if (r === null) throw CANCEL;
        display = r[0] || null;
      } else toast('진열할 수 있는 계통 더미가 없습니다.');
      return { display, places: await pickPlaces(1 + F, { label: L }) };
    }
    case 'PK01': return { places: await pickPlaces(2 + F, { label: L }) };
    case 'PR01': return { moves: await pickMoves(2, { adj: true, label: L }) };
    case 'AN02': {
      const moves = await pickMoves(2, { adj: true, label: L });
      return { moves, places: await pickPlaces(1 + F, { label: L, prepare: sm => moves.forEach(([a, b]) => { sm.map.tiles[a].pcs[me.id]--; if (!sm.map.tiles[a].pcs[me.id]) delete sm.map.tiles[a].pcs[me.id]; sm.map.tiles[b].pcs[me.id] = (sm.map.tiles[b].pcs[me.id] || 0) + 1; }) }) };
    }
    case 'PR02': {
      const t = await pickRemovalTile(L);
      const opp = oppPiecesOn(s, me, t);
      const owner = opp.length === 1 ? opp[0][0] : await must(chooseOne({ title: '누구의 개체를 제거할까요?', options: opp.map(([id, n]) => ({ label: `${esc(pById(id).name)} (${n}개)`, value: id })) }));
      return { victim: { tile: t, owner } };
    }
    case 'AN04': {
      const t = await pickRemovalTile(L);
      const items = oppPiecesOn(s, me, t).flatMap(([id, n]) => Array.from({ length: n }, (_, k) => ({ label: `${esc(pById(id).name)}의 개체 ${k + 1}`, value: id })));
      const sel = await must(chooseMulti({ title: '제거할 상대 개체 (최대 2개)', items, min: 1, max: 2 }));
      return { victims: sel.map(owner => ({ tile: t, owner })) };
    }
    case 'PL02': return { places: await pickPlaces((enh ? 3 : 2) + F, { label: L }) };
    case 'PL04': return { places: await pickPlaces(2 + F, { label: L, ignoreAdj: true, ignoreAdjN: 2 }) };
    case 'HU01': return { places: await pickPlaces(2 + F, { label: L, ignoreAdj: true, ignoreAdjN: 2 }) };
    case 'FU01': {
      const adjOwn = i => s.map.tiles.some((t, j) => (t.pcs[me.id] || 0) > 0 && E.adjacent(s, i, j));
      return { places: await pickPlaces(2 + F, { label: L, filter: (i, out) => out.length >= 2 ? null : out.includes(i) ? '서로 다른 타일에 놓아야 합니다.' : adjOwn(i) ? null : '자기 개체가 있는 타일과 인접해야 합니다.' }) };
    }
    case 'FU02': {
      if (!me.discard.length) { toast('버림더미가 비어 있습니다.'); return { take: [] }; }
      const n = enh ? 2 : 1;
      const take = await must(chooseMulti({ title: `버림더미에서 손패로 가져올 카드 (최대 ${n}장)`, items: me.discard.map(h => ({ label: CARDS[h].name, value: h, img: img(h) })), min: 0, max: n }));
      return { take };
    }
    case 'BA01': {
      const places = await pickPlaces(3 + F, { label: L + ' (한 타일은 K+1 가능)', overOnce: true });
      return { places, overTile: places.overTile };
    }
    case 'BA03': {
      const opts = s.display.map(d => d.card).filter(cid => s.players.some(q => q.id !== me.id && q.nodes.includes(CARDS[cid].lin)) && (!CARDS[cid].star || s.starOwner[CARDS[cid].lin] === me.id || me.research >= 3));
      if (!opts.length) { toast('가져올 수 있는 카드가 진열대에 없습니다.'); return {}; }
      const r = await must(chooseMulti({ title: '비용 없이 가져올 카드', items: opts.map(o => ({ label: CARDS[o].name, value: o, img: img(o) })), min: 1, max: 1 }));
      return { take: r[0] };
    }
    case 'AR01': {
      const tile = await must(pickTile({ title: `${L} — 사막 또는 수생태계 타일 (K 영구 +1)`, valid: i => ['D', 'W'].includes(s.map.tiles[i].t) ? null : '사막·수생태계만 가능' }));
      const places = await pickPlaces(2, { label: L, prepare: sm => sm.map.tiles[tile].kb++, filter: i => i === tile ? null : '선택한 타일에만 놓습니다.' });
      const extra = F ? await pickPlaces(F, { label: '다산', prepare: sm => { sm.map.tiles[tile].kb++; places.forEach(p => sm.map.tiles[p].pcs[me.id] = (sm.map.tiles[p].pcs[me.id] || 0) + 1); } }) : [];
      return { tile, places: [...places, ...extra] };
    }
    default: return {};
  }
}

async function useCardFlow(id) {
  try {
    const params = await collectParams(id);
    await act({ type: 'use', card: id, params });
  } catch (e) {
    if (e !== CANCEL) toast('⚠ ' + e.message, 4000);
  }
}

// ───────────────────────── 카드 상세 ─────────────────────────
function cardInfoHTML(id, extra = '') {
  const c = CARDS[id];
  const tags = { once: '[1회]', persist: '[지속]', attack: '[공격]', defense: '[방어]' };
  const terr = c.terr ? c.terr.map(t => t === 'ALL' ? '모든 지형' : TERRAIN[t].name).join('·') : '';
  return `<div class="card-detail"><img src="${img(id)}" alt="${esc(c.name)}">
    <div><div class="cd-name">${esc(c.name)} ${c.star ? '★' : ''}</div>
    <div class="cd-meta">${c.lin === 'RS' ? '자원' : c.lin === 'VP' ? '승점' : LINEAGES[c.lin]} ${c.tags.map(t => tags[t]).join('')}
    ${c.cost != null ? ` · 구매 ${c.cost}` : ''}${c.prot ? ` · 단백질 ${c.prot}` : ''}${c.vp ? ` · ${c.vp}점` : ''}</div>
    ${terr ? `<div class="cd-terr">강화/조건 지형: ${terr}</div>` : ''}
    <p class="cd-text">${esc(c.text)}</p>${extra}</div></div>`;
}

async function onHandCard(id) {
  const s = S(), me = meP(), c = CARDS[id];
  const btns = [{ label: '닫기', value: null, cancel: true, cls: 'ghost' }];
  let extra = '';
  if (c.kind === 'ability' && !c.tags.includes('defense') && canAct()) {
    const need = E.protNeed(me, id);
    const have = me.hand.filter(h => h === 'RS02').length;
    const full = c.tags.includes('persist') && me.slots.length >= E.slotCap(me);
    const why = s.actions < 1 ? '남은 행동이 없습니다.' : have < need ? `단백질 ${need}장 필요 (보유 ${have})` : full ? '능력 슬롯이 가득 찼습니다.' : '';
    if (c.terr) extra += `<p class="note">강화 조건: ${E.enhanced(s, me, c.terr) ? '<b class="ok">충족</b>' : '미충족'}</p>`;
    extra += `<p class="note">사용 비용: 행동 1 + 단백질 ${need}${why ? ` — <b class="bad">${why}</b>` : ''}</p>`;
    btns.push({ label: c.tags.includes('persist') ? '사용 (슬롯에 장착)' : '사용', value: 'use', cls: 'primary', disabled: !!why });
  } else if (c.tags.includes('defense')) extra += '<p class="note">다른 플레이어가 공격하면 이 카드로 막을 수 있다는 안내가 뜹니다.</p>';
  const r = await modal({ title: '카드', body: cardInfoHTML(id, extra), buttons: btns, wide: true });
  if (r === 'use') useCardFlow(id);
}

async function onMarketCard(id, fromDisplay) {
  const s = S(), me = meP(), c = CARDS[id];
  const btns = [{ label: '닫기', value: null, cancel: true, cls: 'ghost' }];
  let extra = '';
  if (me && c.cost != null) {
    const cost = E.buyCost(s, me, id);
    const remain = fromDisplay ? s.lineagePiles[id] : s.supply[id];
    let why = '';
    if (!canAct()) why = myTurn() ? '진행 중인 처리를 먼저 끝내세요.' : '내 턴이 아닙니다.';
    else if (s.actions < 1) why = '남은 행동이 없습니다.';
    else if (remain <= 0) why = '더미가 비었습니다.';
    else if (fromDisplay) why = E.lineageBuyable(s, me, id) || '';
    if (!why && E.money(s, me) < cost) why = `RNA 부족 (보유 화폐 ${E.money(s, me)})`;
    extra += `<p class="note">남은 수량: ${remain}장 · 구매 비용: <b>${cost}</b>${why ? ` — <b class="bad">${why}</b>` : ''}</p>`;
    btns.push({ label: `구매 (${cost})`, value: 'buy', cls: 'primary', disabled: !!why });
  } else if (id === 'VP04') extra += '<p class="note">구매하지 않고 공격으로만 받습니다.</p>';
  const r = await modal({ title: fromDisplay ? '계통 진열대' : '스타터 진열대', body: cardInfoHTML(id, extra), buttons: btns, wide: true });
  if (r === 'buy') act({ type: 'buy', card: id });
}

// ───────────────────────── 진화 / 연구 / 특성 / 턴 종료 ─────────────────────────
async function onNode(node) {
  const s = S(), me = meP();
  if (!me || !canAct()) return;
  if (me.nodes.includes(node)) return;
  const target = me.evoTarget || node;
  if (me.evoTarget && me.evoTarget !== node) return toast(`진행 중인 목표(${NODES[me.evoTarget].name})를 개방할 때까지 바꿀 수 없습니다.`);
  if (!me.evoTarget) { const why = E.canTarget(me, node); if (why) return toast(why); }
  if (s.actions < 1) return toast('남은 행동이 없습니다.');
  const req = E.evoReq(me, target);
  const needD = req.dna - me.evoProg.dna, needP = req.prot - me.evoProg.prot;
  const haveD = me.hand.filter(h => h === 'RS03').length, haveP = me.hand.filter(h => h === 'RS02').length;
  const maxD = Math.min(needD, haveD), maxP = Math.min(needP, haveP);
  const opts = E.displayOptions(s, target);
  const body = `<p>목표: <b>${NODES[target].name}</b> — 필요 DNA ${req.dna} / 단백질 ${req.prot} (진행 ${me.evoProg.dna}/${me.evoProg.prot})</p>
    <p class="note">손패의 DNA·단백질을 원하는 만큼 내려놓습니다. 낸 카드는 진화 지불 더미로 가며(종료 시 승점 인정) 회수할 수 없습니다.</p>
    <div class="stepper-row"><label>DNA <input type="number" id="ev-d" min="0" max="${maxD}" value="${maxD}"> / 최대 ${maxD}</label>
    <label>단백질 <input type="number" id="ev-p" min="0" max="${maxP}" value="${maxP}"> / 최대 ${maxP}</label></div>
    ${opts.length > 1 ? `<p>개방 시 진열할 더미: <select id="ev-disp">${opts.map(o => `<option value="${o}">${esc(CARDS[o].name)}${CARDS[o].star ? ' ★' : ''}</option>`).join('')}</select></p>` : ''}`;
  const r = await modal({
    title: '진화', body, buttons: [{ label: '취소', value: null, cancel: true, cls: 'ghost' },
      { label: '지불', cls: 'primary', value: w => ({ dna: +w.querySelector('#ev-d').value || 0, prot: +w.querySelector('#ev-p').value || 0, display: w.querySelector('#ev-disp')?.value }) }],
  });
  if (!r) return;
  act({ type: 'evolve', target, dna: Math.min(maxD, Math.max(0, r.dna)), prot: Math.min(maxP, Math.max(0, r.prot)), display: r.display || opts[0] });
}

async function onResearch() {
  const s = S(), me = meP();
  if (!canAct()) return;
  const why = E.researchAvail(s, me);
  if (why) return toast(why);
  const r = RESEARCH[me.research + 1];
  const ok = await modal({ title: `연구 ${me.research + 1}단계`, body: `<p><b>${r.name}</b> — RNA ${r.rna} / 단백질 ${r.prot}</p><p>${r.text}</p><p class="note">종료 시 +2점</p>`, buttons: [{ label: '취소', value: null, cancel: true, cls: 'ghost' }, { label: '연구', value: true, cls: 'primary' }] });
  if (ok) act({ type: 'research' });
}

async function onTrait() {
  const s = S(), me = meP();
  if (!canAct()) return;
  const av = E.traitAvail(s, me);
  if (av.err) return toast(av.err);
  const r = await chooseMulti({
    title: `특성 발현 ${av.stage}단계 (RNA ${TRAIT_COST[av.stage]})`, note: `등급 ${'Ⅰ Ⅱ Ⅲ Ⅳ'.split(' ').slice(0, av.stage).join('·')} 중 1장을 고릅니다. 특성은 지도 위에서만 작동합니다.`,
    items: av.list.map(k => ({ label: `<b>${TRAITS[k].name}</b> (${'ⅠⅡⅢⅣ'[TRAITS[k].tier - 1]})<br><small>${TRAITS[k].text}</small>`, value: k, img: `img/cards/${k}.jpg` })), min: 1, max: 1,
  });
  if (r?.length) act({ type: 'trait', trait: r[0] });
}

async function onEndTurn() {
  const s = S(), me = meP();
  if (!canAct()) return;
  const a = { type: 'endTurn' };
  try {
    if (s.actions > 0) {
      const ok = await modal({ title: '턴 종료', body: `<p>아직 행동이 <b>${s.actions}</b>번 남아 있습니다. 턴을 끝낼까요?</p>`, buttons: [{ label: '취소', value: null, cancel: true, cls: 'ghost' }, { label: '턴 종료', value: true, cls: 'primary' }] });
      if (!ok) return;
    }
    if (me.research >= 1 && me.hand.length) {
      const r = await must(chooseMulti({ title: '제한 효소 — 영구 제거할 손패 (선택)', note: '고르지 않으면 제거하지 않습니다.', items: me.hand.map(h => ({ label: CARDS[h].name, value: h, img: img(h) })), min: 0, max: 1 }));
      if (r[0]) a.trash = r[0];
    }
    if (me.research >= 4) {
      const pl = await pickPlaces(1, { label: '조직 배양(무료 배치)' });
      if (pl.length) a.culture = pl[0];
    }
    await act(a);
  } catch (e) { if (e !== CANCEL) toast('⚠ ' + e.message); }
}

async function onFree(kind) {
  const s = S(), me = meP();
  if (!canAct()) return;
  try {
    if (kind === 'nuclear') {
      const list = me.slots.filter(id => E.PER_TURN.includes(id));
      if (!list.length) return toast('매 턴 효과가 있는 장착 카드가 없습니다.');
      const r = await must(chooseMulti({ title: '핵치환 — 한 번 더 발동할 [지속] 카드', items: [...new Set(list)].map(id => ({ label: CARDS[id].name, value: id, img: img(id) })), min: 1, max: 1 }));
      await act({ type: 'nuclear', card: r[0] });
    } else if (kind === 'hibernate') {
      const t = await must(pickTile({ title: '동면 — 휴면 표시할 자기 개체의 타일', valid: i => (s.map.tiles[i].pcs[me.id] || 0) > 0 ? null : '자기 개체 없음' }));
      await act({ type: 'hibernate', tile: t });
    } else if (kind === 'migrate') {
      const from = await must(pickTile({ title: '회유 — 출발 타일 (자기 개체 전부 이동)', valid: i => (s.map.tiles[i].pcs[me.id] || 0) > 0 ? null : '자기 개체 없음' }));
      const n = s.map.tiles[from].pcs[me.id];
      const to = await must(pickTile({
        title: `회유 — 개체 ${n}개를 옮길 타일`, valid: i => {
          if (i === from) return '같은 타일';
          const t = s.map.tiles[i];
          const others = Object.entries(t.pcs).some(([id, c]) => id !== me.id && c > 0);
          if (E.hasTrait(me, 'TR07') && others) return null;
          return E.tileTotal(t) + n > E.effK(s, me.id, i) ? '환경수용력 부족' : null;
        },
      }));
      await act({ type: 'migrate', from, to });
    }
  } catch (e) { if (e !== CANCEL) toast('⚠ ' + e.message); }
}

// 대기 중인 처리(버리기 / 방어 응답) 자동 팝업
let pendingShown = null;
async function handlePending() {
  const s = S();
  if (!s || !s.pending) { pendingShown = null; return; }
  const pd = s.pending;
  const me = meP();
  if (!me) return;
  const key = JSON.stringify(pd) + actorId();
  if (pendingShown === key) return;
  if (pd.kind === 'discard' && pd.pid === me.id) {
    pendingShown = key;
    const r = await chooseMulti({ title: `버릴 카드 ${pd.n}장 (${pd.why})`, items: me.hand.map(h => ({ label: CARDS[h].name, value: h, img: img(h) })), min: pd.n, max: pd.n, cancel: false });
    await act({ type: 'discardChoice', cards: r });
    pendingShown = null;
  } else if (pd.kind === 'attack' && pd.targets.includes(me.id) && pd.resp[me.id] == null) {
    pendingShown = key;
    const by = pById(pd.by);
    const defs = [...new Set(me.hand.filter(h => E.DEFENSE_CARDS.includes(h)))];
    const what = pd.card === 'AN04' ? `내 개체 ${pd.data.victims.filter(v => v.owner === me.id).length}개를 제거하려 합니다` : '버림더미에 「유해 돌연변이」를 넣으려 합니다';
    const r = await modal({
      title: `⚔ ${esc(by.name)}의 「${CARDS[pd.card].name}」 공격!`,
      body: `${V.mode === 'local' ? `<p class="note">${esc(me.name)} 님의 응답 차례입니다.</p>` : ''}<p>${what}. [방어] 카드를 공개해 무효화할 수 있습니다.</p>`,
      buttons: [...defs.map(d => ({ label: `「${CARDS[d].name}」로 방어`, value: d, cls: 'primary' })), { label: '방어하지 않음', value: 'pass', cls: 'ghost' }],
    });
    await act({ type: 'defend', card: r === 'pass' ? null : r });
    pendingShown = null;
  }
}

// ───────────────────────── 렌더링: 홈 / 로비 ─────────────────────────
function renderHome() {
  const params = new URLSearchParams(location.search);
  const code = params.get('room') || '';
  $('#app').innerHTML = `<div class="home">
    <div class="home-card">
      <div class="logo">🌳</div>
      <h1>생명의 계통수</h1><p class="sub">Tree of Life — 온라인 베타테스트</p>
      <label class="field">닉네임<input id="nm" maxlength="12" value="${esc(V.name)}" placeholder="이름"></label>
      ${configured ? `
        <button class="primary big" data-act="create">새 방 만들기</button>
        <div class="join-row"><input id="code" maxlength="4" placeholder="방 코드" value="${esc(code)}"><button data-act="join">참가</button></div>
      ` : `<div class="warn">Firebase 설정이 아직 없습니다. <code>js/firebase-config.js</code>를 채우면 온라인 방을 만들 수 있어요. 지금은 아래 로컬 테스트만 가능합니다.</div>`}
      <hr>
      <div class="ai-box"><b>🤖 AI와 대전</b> <small>(혼자 연습, 인터넷 연결 불필요)</small>
        <div class="row"><label>AI 수 <select id="aicount">${[1, 2, 3, 4, 5].map(n => `<option ${n === 2 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label>속도 <select id="aispeed"><option value="1.6">느리게</option><option value="1" selected>보통</option><option value="0.4">빠르게</option></select></label>
        <button class="primary" data-act="vs-ai">AI와 시작</button></div>
      </div>
      <details><summary>한 화면 로컬 테스트 (오프라인)</summary>
        <p class="note">한 기기에서 여러 명이 번갈아 플레이합니다. 이름 앞에 <b>AI</b>를 붙이면(예: AI 철수) 컴퓨터가 맡습니다.</p>
        <textarea id="lnames" rows="3" placeholder="플레이어 이름을 줄마다 (2~6명)">플레이어1\n플레이어2\n플레이어3</textarea>
        <div class="row"><button data-act="local">로컬 게임 시작</button>
        <button data-act="local-resume" class="ghost">이어하기</button></div>
      </details>
    </div></div>`;
}

function renderLobby() {
  const r = V.room;
  const players = Object.entries(r.players || {}).sort((a, b) => a[1].t - b[1].t);
  const isHost = r.info?.host === V.uid;
  const link = `${location.origin}${location.pathname}?room=${V.code}`;
  $('#app').innerHTML = `<div class="home"><div class="home-card">
    <h2>대기실</h2>
    <div class="room-code">${V.code}</div>
    <p class="note">친구에게 방 코드나 링크를 보내세요.</p>
    <div class="join-row"><input readonly value="${esc(link)}" id="lnk"><button data-act="copy">복사</button></div>
    <ul class="lobby-list">${players.map(([id, p], i) => `<li><span class="dot" style="background:#999"></span>${p.ai ? '🤖 ' : ''}${esc(p.name)} ${id === r.info?.host ? '<em>(방장)</em>' : ''} ${id === V.uid ? '<em>(나)</em>' : ''}</li>`).join('')}</ul>
    <p class="note">${players.length}/6명 · 2명 이상이면 시작할 수 있습니다.</p>
    ${isHost ? `<div class="row"><button data-act="add-ai" ${players.length >= 6 ? 'disabled' : ''}>🤖 AI 추가</button><button class="ghost" data-act="remove-ai" ${players.some(([, p]) => p.ai) ? '' : 'disabled'}>AI 빼기</button></div>
      <p class="note">AI 차례는 방장 브라우저가 진행합니다. 방장이 창을 닫으면 AI가 멈춰요.</p>` : ''}
    ${isHost ? `<button class="primary big" data-act="start" ${players.length < 2 ? 'disabled' : ''}>게임 시작</button>` : '<p>방장이 시작하기를 기다리는 중…</p>'}
    <button class="ghost" data-act="leave">나가기</button>
  </div></div>`;
}

// ───────────────────────── 렌더링: 게임 ─────────────────────────
function tileHTML(s, t, i) {
  const pk = V.picking;
  let cls = '';
  let tip = '';
  if (pk) {
    const why = pk.valid(i);
    cls = why ? 'invalid' : 'valid';
    tip = why || '';
  } else if (s.phase === 'setup' && meP() && s.players[s.players.length - 1 - s.setupStep].id === meP().id) {
    cls = E.canPlace(s, meP().id, i, { free: true }) ? 'invalid' : 'valid';
  }
  const view = pk?.sim || s;
  const tv = view.map.tiles[i];
  const k = TERRAIN[tv.t].k + tv.kb;
  const dots = [];
  for (const p of s.players) for (let n = 0; n < (tv.pcs[p.id] || 0); n++) {
    const dorm = s.dormant[p.id] === i && n === 0;
    const isNew = pk?.sim && n >= (s.map.tiles[i].pcs[p.id] || 0);
    dots.push(`<span class="pc ${isNew ? 'new' : ''}" style="background:${p.color}" title="${esc(p.name)}">${dorm ? '💤' : ''}</span>`);
  }
  const total = dots.length;
  for (let n = total; n < k; n++) dots.push('<span class="pc empty"></span>');
  return `<div class="tile t-${tv.t} ${cls}" data-tile="${i}" title="${esc(tip)}">
    <div class="tile-top"><span class="ticon">${TICON[tv.t]}</span><span>${TERRAIN[tv.t].name}</span><b>#${i + 1}</b></div>
    <div class="pcs">${dots.join('')}</div>
    <div class="tile-k">K=${k}${tv.kb ? ` <small>(+${tv.kb})</small>` : ''} · ${total}/${k}</div></div>`;
}

function mapHTML(s) {
  return `<div class="map" style="grid-template-columns:repeat(${s.map.cols},1fr)">${s.map.tiles.map((t, i) => tileHTML(s, t, i)).join('')}</div>`;
}

function pileHTML(id, n, fromDisplay, extraCls = '') {
  const c = CARDS[id];
  return `<div class="pile ${n <= 0 ? 'empty' : ''} ${extraCls}" data-${fromDisplay ? 'disp' : 'mkt'}="${id}" data-zoom="${id}">
    <img src="${img(id)}" alt="${esc(c.name)}" loading="lazy">
    <div class="pile-info"><span class="cost">${c.cost ?? '—'}</span><span class="pname">${esc(c.name)}${c.star ? '★' : ''}</span><span class="cnt">×${n}</span></div></div>`;
}

function marketHTML(s) {
  const me = meP();
  const disp = [];
  for (let i = 0; i < 6; i++) {
    const d = s.display[i];
    if (!d) { disp.push('<div class="pile slot-empty">빈 칸</div>'); continue; }
    const ok = me && !E.lineageBuyable(s, me, d.card);
    disp.push(pileHTML(d.card, s.lineagePiles[d.card], true, ok ? 'can' : 'locked'));
  }
  return `<section class="panel market">
    <h4>스타터 진열대</h4><div class="piles starter">${STARTER_PILES.map(id => pileHTML(id, s.supply[id], false)).join('')}</div>
    <h4>계통 진열대 <small>(6칸 · 가득 차면 남은 장수가 가장 적은 더미를 치움)</small></h4><div class="piles lineage">${disp.join('')}</div>
  </section>`;
}

function endTrackHTML(s) {
  const pct = Math.min(100, s.endTrack / s.endTarget * 100);
  return `<div class="endtrack" title="식물·동물·균류·인간 더미 진열 +4 / 세균·고세균 +2"><span>종료 트랙</span>
    <div class="bar"><div style="width:${pct}%"></div></div><b>${s.endTrack}/${s.endTarget}</b>${s.endTriggered ? '<em>마지막 라운드!</em>' : ''}</div>`;
}

function playersHTML(s) {
  const cur = s.phase === 'play' ? E.curPlayer(s).id : null;
  return s.players.map(p => {
    const sc = E.computeScore(s, p);
    return `<div class="pbox ${p.id === cur ? 'current' : ''}" style="--pc:${p.color}">
      <div class="pb-head"><span class="dot" style="background:${p.color}"></span><b>${p.ai ? '🤖 ' : ''}${esc(p.name)}</b>${p.id === V.uid && V.mode !== 'local' ? '<em>나</em>' : ''}
        <span class="score" title="현재 기준 예상 점수">${sc.total}점</span></div>
      <div class="pb-stats">손패 ${p.hand.length} · 덱 ${p.deck.length} · 버림 ${p.discard.length} · 지불더미 ${p.evoPaid.length} · 개체 ${E.markersOnMap(s, p.id)}/${MARKERS}</div>
      <div class="pb-stats">계통: ${p.nodes.filter(n => n !== 'LUCA').map(n => NODES[n].name).join(', ') || 'LUCA'}${p.evoTarget ? ` <span class="tgt">→ ${NODES[p.evoTarget].name} (${p.evoProg.dna}/${E.evoReq(p, p.evoTarget).dna}·${p.evoProg.prot}/${E.evoReq(p, p.evoTarget).prot})</span>` : ''}</div>
      <div class="pb-stats">연구 ${p.research}/5 · 특성 ${p.traitStage}/4 · 제거점수 ${p.removal}</div>
      ${p.slots.length ? `<div class="pb-slots">${p.slots.map(id => `<img src="${img(id)}" data-zoom="${id}" title="${esc(CARDS[id].name)}">`).join('')}</div>` : ''}
      ${p.traits.length ? `<div class="pb-tags">${p.traits.map(t => `<span class="tag trait" title="${esc(TRAITS[t].text)}">${TRAITS[t].name}</span>`).join('')}</div>` : ''}
      ${p.ach.length ? `<div class="pb-tags">${p.ach.map(a => `<span class="tag ach" title="${esc(ACHIEVEMENTS[a].eff)}">🏆${ACHIEVEMENTS[a].name}</span>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
}

function achTraitHTML(s) {
  const owner = id => id ? pById(id) : null;
  return `<section class="panel"><h4>업적 <small>(최초 1인)</small></h4><div class="ach-grid">${Object.entries(ACHIEVEMENTS).map(([k, a]) => {
    const o = owner(s.achTaken[k]);
    return `<div class="ach ${o ? 'taken' : ''}" style="${o ? `--pc:${o.color}` : ''}" title="${esc(a.cond)} → ${esc(a.eff)}"><img src="img/ach/${k}.jpg" alt=""><div><b>${a.name}</b> +${a.pts}<br><small>${a.cond}</small>${o ? `<br><span class="owner">${esc(o.name)}</span>` : ''}</div></div>`;
  }).join('')}</div></section>
  <section class="panel"><h4>특성 카드 <small>(게임에 1장씩)</small></h4><div class="trait-list">${Object.entries(TRAITS).map(([k, t]) => {
    const o = owner(s.traitTaken[k]);
    return `<div class="trait ${o ? 'taken' : ''}" data-zoom="${k}" title="${esc(t.text)}"><span class="tier">${'ⅠⅡⅢⅣ'[t.tier - 1]}</span>${t.name}${o ? `<span class="dot" style="background:${o.color}"></span>` : ''}</div>`;
  }).join('')}</div></section>`;
}

function evoTreeHTML(s, me) {
  const pos = { LUCA: [1, 1], PK: [2, 1], EK: [3, 1], PR: [4, 1], PL: [5, 1], FU: [5, 2], AN: [5, 3], HU: [6, 3], BA: [2, 2], AR: [2, 3] };
  return `<div class="evo-tree">${Object.entries(pos).map(([n, [c, r]]) => {
    const node = NODES[n];
    const open = me.nodes.includes(n);
    const tgt = me.evoTarget === n;
    const avail = !open && !me.evoTarget && !E.canTarget(me, n);
    const req = n === 'LUCA' ? null : E.evoReq(me, n);
    return `<div class="node ${open ? 'open' : ''} ${tgt ? 'target' : ''} ${avail ? 'avail' : ''}" style="grid-column:${c};grid-row:${r}" data-node="${n}"
      title="${n === 'HU' ? '동물 개방 + 식물·균류 카드 각 1장 이상 보유 필요' : ''}">
      <b>${node.name}</b>${req ? `<small>DNA ${req.dna} / 단백질 ${req.prot}${node.end ? ` · 종료+${node.end}` : ''}</small>` : '<small>출발</small>'}
      ${tgt ? `<small class="prog">진행 ${me.evoProg.dna}/${req.dna} · ${me.evoProg.prot}/${req.prot}</small>` : ''}</div>`;
  }).join('')}</div>`;
}

function myBoardHTML(s, me) {
  const turn = myTurn();
  const cap = E.slotCap(me);
  const slots = [];
  for (let i = 0; i < 6; i++) {
    const id = me.slots[i];
    slots.push(id ? `<div class="slot filled" data-zoom="${id}"><img src="${img(id)}" alt=""></div>`
      : `<div class="slot ${i < cap ? '' : 'locked'}">${i < cap ? '빈 슬롯' : '🔒'}</div>`);
  }
  const research = RESEARCH.slice(1).map((r, i) => `<div class="rcell ${me.research > i ? 'done' : me.research === i ? 'next' : ''}" ${me.research === i ? 'data-act="research"' : ''}>
    <b>${i + 1}. ${r.name}</b><small>RNA ${r.rna} / 단백질 ${r.prot}</small><small>${r.text}</small></div>`).join('');
  const traits = [1, 2, 3, 4].map(st => `<div class="tcell ${me.traitStage >= st ? 'done' : me.traitStage + 1 === st ? 'next' : ''}" ${me.traitStage + 1 === st ? 'data-act="trait"' : ''}>
    <b>${st}단계</b><small>RNA ${TRAIT_COST[st]} · 노드 ${st}개↑</small></div>`).join('');
  const handSorted = [...me.hand].sort((a, b) => a.localeCompare(b));
  const free = [];
  if (turn && me.research >= 5 && !s.tf.nuclear) free.push('<button data-free="nuclear">핵치환</button>');
  if (turn && E.hasTrait(me, 'TR04') && !s.tf.hibernate) free.push('<button data-free="hibernate">동면</button>');
  if (turn && E.hasTrait(me, 'TR09') && !s.tf.migrate) free.push('<button data-free="migrate">회유</button>');
  const money = E.money(s, me);
  const cnt = id => me.hand.filter(h => h === id).length;
  const dock = `<div class="dock" style="--pc:${me.color}">
    <div class="actionbar">
      <span class="dot" style="background:${me.color}"></span><b>${esc(me.name)}</b>
      ${turn ? `<span class="acts">남은 행동 <b>${s.actions}</b></span>` : `<span class="wait">${s.phase === 'play' ? `${esc(E.curPlayer(s).name)}의 턴` : ''}</span>`}
      <span class="res">화폐 <b>${money}</b> · 단백질 ${cnt('RS02')} · DNA ${cnt('RS03')}</span>
      ${turn ? '<span class="hint">구매: 시장 카드 · 사용: 손패 · 진화: 노드 · 연구/특성: 트랙 클릭</span>' : '<span class="hint"></span>'}
      ${free.join('')}
      ${turn ? '<button class="primary" data-act="end">턴 종료</button>' : ''}
    </div>
    <div class="hand">${handSorted.map(id => `<div class="hcard ${CARDS[id].kind}" data-hand="${id}" data-zoom="${id}"><img src="${img(id)}" alt="${esc(CARDS[id].name)}"><span>${esc(CARDS[id].name)}</span></div>`).join('') || '<p class="note">손패 없음</p>'}</div>
  </div>`;
  return dock + `<section class="panel myboard" style="--pc:${me.color}">
    <div class="mb-head"><span class="dot" style="background:${me.color}"></span><b>${esc(me.name)}</b>의 보드
      ${V.mode === 'local' ? '<em class="hotseat">로컬: 지금 조작하는 플레이어</em>' : ''}
      <span class="res">덱 ${me.deck.length} · 버림더미 ${me.discard.length} · 진화 지불 더미 ${me.evoPaid.length} · 개체 ${E.markersLeft(s, me.id)}개 남음</span></div>
    <div class="mb-grid">
      <div><h5>진화 트랙 ${me.evoTarget ? `<small>목표: ${NODES[me.evoTarget].name}</small>` : '<small>노드를 클릭해 목표 지정 + 지불</small>'}</h5>${evoTreeHTML(s, me)}</div>
      <div><h5>능력 슬롯 <small>${me.slots.length}/${cap} (최대 6)</small></h5><div class="slots">${slots.join('')}</div></div>
      <div><h5>연구 트랙 <small>${me.research}/5 · 단계당 +2점</small></h5><div class="rtrack">${research}</div></div>
      <div><h5>특성 발현 <small>${me.traitStage}/4 · 1/3/6/10점</small></h5><div class="ttrack">${traits}</div>
        ${me.traits.length ? `<div class="pb-tags">${me.traits.map(t => `<span class="tag trait" data-zoom="${t}">${TRAITS[t].name}</span>`).join('')}</div>` : ''}</div>
    </div>
  </section>`;
}

function logHTML(s) {
  if (V.tab === 'chat') {
    const chat = V.room.chat || [];
    return `<div class="log chat">${chat.map(c => `<div><b>${esc(c.name)}</b>: ${esc(c.text)}</div>`).join('') || '<p class="note">메시지가 없습니다.</p>'}</div>
      <form class="chat-form" data-form="chat"><input name="m" maxlength="300" placeholder="메시지" autocomplete="off"><button>보내기</button></form>`;
  }
  return `<div class="log">${s.log.slice().reverse().map(l => `<div class="${l.m.startsWith('──') ? 'turn' : ''}">${esc(l.m)}</div>`).join('')}</div>`;
}

function scoreTableHTML(s, rows) {
  const name = id => esc(pById(id).name);
  const cols = [['card', '① 카드'], ['map', '② 지도'], ['div', '③ 다양성'], ['tech', '④ 업적·연구·특성'], ['removal', '⑤ 제거'], ['total', '총점']];
  return `<table class="scores"><tr><th>플레이어</th>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr>
    ${rows.map(r => `<tr><td><span class="dot" style="background:${pById(r.id).color}"></span>${name(r.id)}</td>${cols.map(([k]) => `<td>${r[k]}</td>`).join('')}</tr>
    <tr class="sub"><td></td><td colspan="6">개체 ${r.pieces}×${r.rate} + 우점 ${r.dom} + 보너스 ${r.mapBonus} · 유전적 ${r.genetic} / 종 ${r.species} / 생태계 ${r.eco} / 유전체 ${r.genome} · 업적 ${r.achPts} / 연구 ${r.research} / 특성 ${r.trait}</td></tr>`).join('')}</table>`;
}

function renderGame() {
  const s = S();
  if (!s) { $('#app').innerHTML = '<div class="home"><div class="home-card">게임을 불러오는 중…</div></div>'; return; }
  const me = meP();
  const cur = s.phase === 'play' ? E.curPlayer(s) : null;
  let banner = '';
  if (V.picking) banner = `<div class="banner pick">${esc(V.picking.title)} ${V.picking.skippable ? '<button data-act="pick-skip">그만 놓기/건너뛰기</button>' : ''}<button class="ghost" data-act="pick-cancel">취소</button></div>`;
  else if (s.phase === 'setup') {
    const sp = s.players[s.players.length - 1 - s.setupStep];
    banner = `<div class="banner">초기 배치: <b style="color:${sp.color}">${esc(sp.name)}</b>${me && sp.id === me.id ? ' — 첫 개체를 놓을 타일을 클릭하세요 (아무 타일이나 가능)' : ' 님이 첫 개체를 놓는 중…'}</div>`;
  } else if (s.phase === 'ended') banner = `<div class="banner end">🏁 게임 종료! <button data-act="scores">최종 점수 보기</button></div>`;
  else if (s.pending?.kind === 'attack') banner = `<div class="banner">⚔ 공격 응답 대기 중: ${s.pending.targets.filter(t => s.pending.resp[t] == null).map(t => esc(pById(t).name)).join(', ')}</div>`;
  else if (s.pending?.kind === 'discard') banner = `<div class="banner">${esc(pById(s.pending.pid).name)}: 버릴 카드 ${s.pending.n}장을 고르는 중</div>`;
  else if (cur && me && cur.id === me.id) banner = `<div class="banner mine">내 턴입니다! 남은 행동 ${s.actions}</div>`;

  document.body.classList.toggle('has-dock', !!me);
  $('#app').innerHTML = `
  <header class="top">
    <h1>🌳 생명의 계통수</h1>
    <span class="chip">${V.mode === 'local' ? '로컬 테스트' : `방 ${V.code}`}</span>
    <span class="chip">라운드 ${s.round}</span>
    ${cur ? `<span class="chip" style="border-color:${cur.color}">현재: <b style="color:${cur.color}">${esc(cur.name)}</b></span>` : ''}
    ${endTrackHTML(s)}
    <span class="grow"></span>
    ${V.spectator ? '<span class="chip">관전 중</span>' : ''}
    <button class="ghost" data-act="scores">점수표</button>
    <button class="ghost" data-act="rules">규칙 요약</button>
    <button class="ghost" data-act="home">나가기</button>
  </header>
  ${banner}
  <main class="layout">
    <aside class="left">${playersHTML(s)}${achTraitHTML(s)}</aside>
    <section class="center"><section class="panel"><h4>지도 <small>환경수용력 K · 인접 = 상하좌우</small></h4>${mapHTML(s)}</section>${marketHTML(s)}</section>
    <aside class="right panel"><div class="tabs"><button class="${V.tab === 'log' ? 'on' : ''}" data-tab="log">기록</button><button class="${V.tab === 'chat' ? 'on' : ''}" data-tab="chat">채팅</button></div>${logHTML(s)}</aside>
  </main>
  ${me ? myBoardHTML(s, me) : ''}`;
}

function render() {
  if (V.screen !== 'game') document.body.classList.remove('has-dock');
  if (V.screen === 'home') return renderHome();
  if (V.screen === 'lobby') return renderLobby();
  const scroll = { x: window.scrollX, y: window.scrollY };
  const chatVal = document.querySelector('.chat-form input')?.value;
  const focused = document.activeElement?.closest?.('.chat-form');
  renderGame();
  window.scrollTo(scroll.x, scroll.y);
  if (chatVal != null) { const i = document.querySelector('.chat-form input'); if (i) { i.value = chatVal; if (focused) i.focus(); } }
}

// ───────────────────────── AI 진행 ─────────────────────────
// 로컬 모드는 이 브라우저가, 온라인은 방장 브라우저가 AI 차례를 대신 진행한다
const AI_DELAY = { setupPlace: 500, discardChoice: 350, defend: 600, endTurn: 900 };
function scheduleAI() {
  const s = S();
  if (!s || V.aiTimer) return;
  if (V.mode === 'online' && V.room?.info?.host !== V.uid) return;
  const pid = aiToMove(s);
  if (!pid) return;
  const a0 = aiAction(s, pid);
  const delay = (AI_DELAY[a0?.type] ?? 800) * (V.aiSpeed || 1);
  V.aiTimer = setTimeout(async () => {
    V.aiTimer = null;
    const st = S();
    const id = aiToMove(st);
    if (!id) return;
    const a = aiAction(st, id) || { type: 'endTurn' };
    try { await V.net.act(V.code, a, id); }
    catch (e) {
      console.warn('AI 행동 실패', a, e);
      try { await V.net.act(V.code, aiToMove(S()) === id && S().pending ? { type: 'defend', card: null } : { type: 'endTurn' }, id); } catch { }
    }
    scheduleAI();
  }, delay);
}

// ───────────────────────── 방 상태 수신 ─────────────────────────
function onRoom(room) {
  V.room = room;
  if (V.mode === 'online') {
    if (!room.info) { toast('방이 사라졌습니다.'); return goHome(); }
    V.screen = room.state ? 'game' : 'lobby';
    if (room.state) V.spectator = !room.state.players.some(p => p.id === V.uid);
  }
  render();
  handlePending();
  scheduleAI();
  const s = room.state;
  if (s?.phase === 'ended' && !V.endShown) { V.endShown = true; showScores(); }
}

function goHome() {
  clearTimeout(V.aiTimer); V.aiTimer = null;
  V.net?.stop?.(); V.screen = 'home'; V.room = null; V.code = null; V.picking = null; V.endShown = false;
  history.replaceState(null, '', location.pathname);
  render();
}

async function showScores() {
  const s = S();
  const rows = s.phase === 'ended' && s.final ? [...s.final].sort((a, b) => a.rank - b.rank) : E.rankPlayers(s);
  modal({
    title: s.phase === 'ended' ? '🏁 최종 점수' : '현재 점수 (지금 끝난다면)', wide: true,
    body: scoreTableHTML(s, rows) + '<p class="note">동점: 생태계 다양성 → 개체 수 → 진화 트랙 깊이 순.</p>',
    buttons: [{ label: '닫기', value: true }],
  });
}

function showRules() {
  modal({
    title: '규칙 요약', wide: true, buttons: [{ label: '닫기', value: true }], body: `
    <ul class="rules">
      <li><b>턴</b>: 발동(지속 카드 매 턴 효과 자동) → 행동 1회(구매/사용/진화/연구/특성 발현) → 정리(손패 전부 버리고 5장)</li>
      <li><b>추가 행동</b>: 효소·ATP·신경계로 행동 횟수가 늘어납니다.</li>
      <li><b>화폐</b>: RNA 1장 = 2. 연구·특성의 RNA 비용도 화폐 값으로 계산합니다. 자동으로 최소 장수만 지불합니다.</li>
      <li><b>진화</b>: 목표 노드 1개만 진행, 부분 지불 가능, 낸 DNA·단백질은 진화 지불 더미로(종료 시 승점 인정). 개방 시 슬롯 +1, 그 계통 더미 1종 무료 진열.</li>
      <li><b>계통 카드 구매</b>: 그 계통 노드를 개방해야 하며, ★ 카드는 최초 개방자만(연구 3단계로 해제).</li>
      <li><b>지도</b>: 자기 개체가 있는 타일·인접 타일에만 배치, K 초과 불가. 상대 개체 제거는 같은 타일에 내 개체가 있어야 하며 발동 1회당 즉시 +1점.</li>
      <li><b>공격/방어</b>: [공격] 카드는 대상이 손패의 [방어] 카드(세포막·항체)로 막을 수 있습니다. 항상성은 자동 적용.</li>
      <li><b>종료</b>: 최상위 계통 더미 진열(식물·동물·균류·인간 +4, 세균·고세균 +2)이 인원수×5에 도달하면 그 라운드 끝까지 진행 후 종료.</li>
      <li><b>점수</b>: ① 카드 승점 + ② 지도(개체×단가, 우점 +3, 사막 우점 +2) + ③ 다양성 + ④ 업적·연구·특성 + ⑤ 제거 점수</li>
      <li><b>자동 처리</b>: 포자·재생의 재배치 위치와 세포벽·내생 포자·보호색·의태·항상성 같은 "라운드당 1회" 방어는 자동으로 적용됩니다.</li>
    </ul>` });
}

// ───────────────────────── 이벤트 ─────────────────────────
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act],[data-tile],[data-hand],[data-mkt],[data-disp],[data-node],[data-tab],[data-free]');
  if (!el || el.closest('.modal-back')) return;
  const d = el.dataset;
  if (d.tile != null) {
    const i = +d.tile;
    if (V.picking) {
      const why = V.picking.valid(i);
      if (why) return toast(why);
      return endPick(i);
    }
    const s = S();
    if (s?.phase === 'setup' && meP()) return act({ type: 'setupPlace', tile: i });
    return;
  }
  if (V.picking && !d.act?.startsWith('pick')) return toast('먼저 타일을 고르거나 취소하세요.');
  if (d.hand) return onHandCard(d.hand);
  if (d.mkt) return onMarketCard(d.mkt, false);
  if (d.disp) return onMarketCard(d.disp, true);
  if (d.node) return onNode(d.node);
  if (d.free) return onFree(d.free);
  if (d.tab) { V.tab = d.tab; return render(); }
  switch (d.act) {
    case 'create': case 'join': {
      const name = $('#nm').value.trim();
      if (!name) return toast('닉네임을 입력하세요.');
      V.name = name; try { localStorage.setItem('tol_name', name); } catch { }
      try {
        if (!V.net || V.mode !== 'online') { V.net = new FirebaseNet(firebaseConfig); await V.net.init(); }
        V.mode = 'online';
        if (d.act === 'create') V.code = await V.net.createRoom(name);
        else {
          V.code = $('#code').value.trim().toUpperCase();
          if (!V.code) return toast('방 코드를 입력하세요.');
          const r = await V.net.joinRoom(V.code, name);
          if (r.spectator) toast('이미 시작된 게임이라 관전으로 들어갑니다.');
        }
        history.replaceState(null, '', `?room=${V.code}`);
        V.screen = 'lobby';
        V.net.watch(V.code, onRoom);
      } catch (err) { console.error(err); toast('⚠ 연결 실패: ' + err.message, 5000); }
      break;
    }
    case 'vs-ai': case 'local': {
      let seats;
      if (d.act === 'vs-ai') {
        const name = $('#nm').value.trim() || '나';
        V.name = name; try { localStorage.setItem('tol_name', name); } catch { }
        V.aiSpeed = +$('#aispeed').value;
        seats = [{ name }, ...Array.from({ length: +$('#aicount').value }, (_, i) => ({ name: `AI ${AI_NAMES[i]}`, ai: true }))];
      } else {
        seats = $('#lnames').value.split('\n').map(x => x.trim()).filter(Boolean).map(n => ({ name: n, ai: /^AI(\s|$)/i.test(n) }));
        if (seats.length < 2 || seats.length > 6) return toast('2~6명의 이름을 입력하세요.');
        if (!seats.some(x => !x.ai)) return toast('사람 플레이어가 1명 이상 있어야 합니다.');
      }
      V.net = new LocalNet(); V.mode = 'local'; V.code = 'LOCAL'; V.lastHuman = null;
      V.net.setup(seats); V.screen = 'game'; V.endShown = false;
      V.net.watch(V.code, onRoom);
      break;
    }
    case 'local-resume': {
      const n = new LocalNet();
      if (!n.restore()) return toast('저장된 로컬 게임이 없습니다.');
      V.net = n; V.mode = 'local'; V.code = 'LOCAL'; V.screen = 'game'; V.endShown = false;
      V.net.watch(V.code, onRoom);
      break;
    }
    case 'copy': navigator.clipboard?.writeText($('#lnk').value).then(() => toast('링크를 복사했습니다.')); break;
    case 'start': {
      const players = Object.entries(V.room.players).sort((a, b) => a[1].t - b[1].t).map(([id, p]) => ({ id, name: p.name, ai: !!p.ai }));
      try { await V.net.start(V.code, players); } catch (err) { toast('⚠ ' + err.message); }
      break;
    }
    case 'add-ai': {
      const ais = Object.values(V.room.players).filter(p => p.ai).length;
      try { await V.net.addAI(V.code, `AI ${AI_NAMES[ais % AI_NAMES.length]}`); } catch (err) { toast('⚠ ' + err.message); }
      break;
    }
    case 'remove-ai': {
      const last = Object.entries(V.room.players).filter(([, p]) => p.ai).sort((a, b) => b[1].t - a[1].t)[0];
      if (last) try { await V.net.removeAI(V.code, last[0]); } catch (err) { toast('⚠ ' + err.message); }
      break;
    }
    case 'leave': try { await V.net.leaveLobby(V.code); } catch { } goHome(); break;
    case 'home': {
      const ok = await modal({ title: '나가기', body: '<p>홈 화면으로 나갈까요? (온라인 게임은 방 코드로 다시 들어올 수 있고, 로컬 게임은 "이어하기"로 복구됩니다)</p>', buttons: [{ label: '취소', value: null, cancel: true, cls: 'ghost' }, { label: '나가기', value: true, cls: 'primary' }] });
      if (ok) goHome();
      break;
    }
    case 'pick-skip': endPick(null); break;
    case 'pick-cancel': endPick(null, true); break;
    case 'end': onEndTurn(); break;
    case 'research': onResearch(); break;
    case 'trait': onTrait(); break;
    case 'scores': showScores(); break;
    case 'rules': showRules(); break;
  }
});

document.addEventListener('submit', async e => {
  const f = e.target.closest('[data-form="chat"]');
  if (!f) return;
  e.preventDefault();
  const m = f.m.value.trim();
  if (!m) return;
  f.m.value = '';
  const name = V.mode === 'local' ? (meP()?.name || '로컬') : V.name;
  try { await V.net.chat(V.code, name, m); } catch (err) { toast('⚠ ' + err.message); }
});

// 카드 확대 미리보기 (마우스 올리기)
document.addEventListener('mouseover', e => {
  const z = e.target.closest('[data-zoom]');
  const box = $('#zoom');
  if (!z || !matchMedia('(hover:hover)').matches) { box.classList.add('hidden'); return; }
  const id = z.dataset.zoom;
  box.innerHTML = `<img src="${img(id)}" alt="">`;
  const r = z.getBoundingClientRect();
  const w = 260, h = 395;
  let x = r.right + 10; if (x + w > innerWidth) x = r.left - w - 10;
  let y = Math.min(Math.max(8, r.top - 40), innerHeight - h - 8);
  box.style.left = Math.max(8, x) + 'px'; box.style.top = y + 'px';
  box.classList.remove('hidden');
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && V.picking) endPick(null, true); });

// ───────────────────────── 시작 ─────────────────────────
(async function boot() {
  const code = new URLSearchParams(location.search).get('room');
  if (code && configured && V.name) {
    try {
      V.net = new FirebaseNet(firebaseConfig); await V.net.init(); V.mode = 'online';
      V.code = code.toUpperCase();
      const r = await V.net.joinRoom(V.code, V.name);
      V.spectator = r.spectator;
      V.screen = 'lobby';
      V.net.watch(V.code, onRoom);
      return;
    } catch (err) { toast('⚠ ' + err.message); }
  }
  render();
})();
