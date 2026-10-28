// 생명의 계통수 — 컴퓨터 플레이어 (규칙 기반 휴리스틱)
// aiAction(state, pid) → 지금 그 AI가 할 행동 하나. 항상 규칙상 가능한 행동을 돌려주도록
// 후보를 엔진으로 미리 적용해 보고 실패하면 다음 후보로 넘어간다.
import * as E from './engine.js';
import { CARDS, NODES, TRAITS, RESEARCH, TRAIT_COST } from './data.js';

const P = (s, pid) => s.players.find(p => p.id === pid);
const cnt = (arr, id) => arr.filter(x => x === id).length;
const clone = o => JSON.parse(JSON.stringify(o));
const tryAct = (s, pid, a) => { try { E.applyAction(s, pid, a); return true; } catch { return false; } };

// 버릴 때 덜 아까운 카드 순서
const DISCARD_ORDER = ['VP04', 'VP01', 'VP02', 'VP03', 'ST04', 'AN03', 'ST06', 'ST07', 'ST01', 'RS01'];
function discardRank(id) {
  const i = DISCARD_ORDER.indexOf(id);
  return i >= 0 ? i : 20 + (CARDS[id].cost || 0);
}

// 각 AI의 진화 경로 성향 (id에서 결정 → 매 판 일정)
function preferredTops(pid) {
  const h = [...pid].reduce((a, c) => a + c.charCodeAt(0), 0);
  return [['AN', 'PL', 'FU'], ['PL', 'FU', 'AN'], ['FU', 'AN', 'PL']][h % 3];
}
function nextEvoTarget(p) {
  if (p.evoTarget) return p.evoTarget;
  const order = ['PK', 'EK', 'PR', ...preferredTops(p.id), 'HU', 'BA', 'AR'];
  return order.find(n => !E.canTarget(p, n)) || null;
}

// ───────── 지도 평가 ─────────
function tileValue(s, p, i) {
  const t = s.map.tiles[i];
  const mine = t.pcs[p.id] || 0;
  const best = Math.max(0, ...Object.entries(t.pcs).filter(([id]) => id !== p.id).map(([, c]) => c));
  const myTerr = new Set(s.map.tiles.filter(x => (x.pcs[p.id] || 0) > 0).map(x => x.t));
  let v = Math.random() * 0.5;
  if (mine + 1 > best && mine <= best) v += t.t === 'D' ? 6 : 4; // 우점 획득
  else if (mine > best) v -= 1;                                    // 이미 우점 → 낭비
  if (!myTerr.has(t.t)) v += 5;                                    // 생태계 다양성
  if (mine === 0) v += 1.5;                                        // 새 타일 (적응 방산 업적 등)
  if (['G', 'F', 'D'].includes(t.t) && !s.achTaken.A6) v += 1;
  v += (E.effK(s, p.id, i) - E.tileTotal(t)) * 0.2;                // 여유 공간
  return v;
}
function bestPlaces(s, p, n, opts = {}) {
  const sim = clone(s), out = [];
  for (let k = 0; k < n; k++) {
    const ign = opts.ignoreAdj && k < (opts.ignoreAdjN ?? n);
    let best = null, bv = -1e9;
    sim.map.tiles.forEach((_, i) => {
      if (opts.filter && !opts.filter(i, out)) return;
      if (E.canPlace(sim, p.id, i, { ignoreAdj: ign })) return;
      const v = tileValue(sim, P(sim, p.id), i);
      if (v > bv) { bv = v; best = i; }
    });
    if (best == null) break;
    sim.map.tiles[best].pcs[p.id] = (sim.map.tiles[best].pcs[p.id] || 0) + 1;
    out.push(best);
  }
  return out;
}
function removalTarget(s, p) {
  let best = null, bv = -1;
  s.map.tiles.forEach((t, i) => {
    if ((t.pcs[p.id] || 0) <= 0) return;
    for (const [id, c] of Object.entries(t.pcs)) {
      if (id === p.id || c <= 0) continue;
      const v = c + (c >= (t.pcs[p.id] || 0) ? 3 : 0) + (t.t === 'D' ? 1 : 0);
      if (v > bv) { bv = v; best = { tile: i, owner: id, n: c }; }
    }
  });
  return best;
}

// ───────── 카드 사용 파라미터 ─────────
function useParams(s, p, id) {
  const F = E.hasTrait(p, 'TR12') ? 1 : 0;
  const enh = E.enhanced(s, p, CARDS[id].terr);
  switch (id) {
    case 'ST05': return { places: bestPlaces(s, p, 1 + F) };
    case 'ST06': { const t = [...p.hand].filter(h => h !== id || cnt(p.hand, id) > 1).sort((a, b) => discardRank(a) - discardRank(b))[0]; return t && discardRank(t) <= 1 ? { trash: t } : null; }
    case 'ST08': return { mode: 'place', places: bestPlaces(s, p, 1 + F) };
    case 'ST09': {
      const opts = p.nodes.filter(n => n !== 'LUCA').flatMap(l => E.displayOptions(s, l));
      return { display: opts.sort((a, b) => (CARDS[b].star - CARDS[a].star))[0] || null, places: bestPlaces(s, p, 1 + F) };
    }
    case 'PK01': return { places: bestPlaces(s, p, 2 + F) };
    case 'PL02': return { places: bestPlaces(s, p, (enh ? 3 : 2) + F) };
    case 'PL04': case 'HU01': return { places: bestPlaces(s, p, 2 + F, { ignoreAdj: true, ignoreAdjN: 2 }) };
    case 'BA01': return { places: bestPlaces(s, p, 3 + F) };
    case 'FU01': {
      const adjOwn = i => s.map.tiles.some((t, j) => (t.pcs[p.id] || 0) > 0 && E.adjacent(s, i, j));
      return { places: bestPlaces(s, p, 2, { filter: (i, out) => !out.includes(i) && adjOwn(i) }) };
    }
    case 'AR01': {
      const cand = s.map.tiles.map((t, i) => i).filter(i => ['D', 'W'].includes(s.map.tiles[i].t));
      for (const t of cand.sort((a, b) => tileValue(s, p, b) - tileValue(s, p, a))) {
        const sim = clone(s); sim.map.tiles[t].kb++;
        const pl = bestPlaces(sim, p, 2, { filter: i => i === t });
        if (pl.length) return { tile: t, places: pl };
      }
      return null;
    }
    case 'AN02': return { moves: [], places: bestPlaces(s, p, 1 + F) };
    case 'PR01': return null; // 이동만 하는 카드는 쓰지 않음
    case 'PR02': { const r = removalTarget(s, p); return r ? { victim: { tile: r.tile, owner: r.owner } } : null; }
    case 'AN04': {
      const r = removalTarget(s, p); if (!r) return null;
      return { victims: Array(Math.min(2, r.n)).fill(0).map(() => ({ tile: r.tile, owner: r.owner })) };
    }
    case 'FU02': {
      const take = [...p.discard].sort((a, b) => cardWorth(s, p, b) - cardWorth(s, p, a)).slice(0, enh ? 2 : 1);
      return take.length ? { take } : null;
    }
    case 'BA03': {
      const opts = s.display.map(d => d.card).filter(c => s.players.some(q => q.id !== p.id && q.nodes.includes(CARDS[c].lin)) && (!CARDS[c].star || s.starOwner[CARDS[c].lin] === p.id || p.research >= 3));
      return opts.length ? { take: opts.sort((a, b) => CARDS[b].cost - CARDS[a].cost)[0] } : null;
    }
    case 'ST07': return p.hand.length > 1 ? {} : null;
    default: return {};
  }
}

// 다음 두 노드까지 더 필요한 DNA·단백질 (덱에 이미 있는 것 제외)
function need(p) {
  const order = ['PK', 'EK', 'PR', ...preferredTops(p.id), 'HU'];
  let dna = 0, prot = 0, k = 0;
  for (const n of order) {
    if (p.nodes.includes(n) || k >= 2) continue;
    const r = E.evoReq(p, n);
    dna += r.dna; prot += r.prot; k++;
    if (p.evoTarget === n) { dna -= p.evoProg.dna; prot -= p.evoProg.prot; }
  }
  const live = [...p.deck, ...p.hand, ...p.discard];
  return { dna: dna - cnt(live, 'RS03'), prot: prot + 2 - cnt(live, 'RS02') };
}

// 카드 가치 (구매·회수 판단용)
function cardWorth(s, p, id) {
  const c = CARDS[id];
  const late = s.endTrack / s.endTarget;
  const tgt = nextEvoTarget(p);
  const owned = E.ownedCards(p);
  const deck = owned.length - p.evoPaid.length - p.slots.length;
  const bloat = Math.max(0, deck - 18) * 0.25;   // 덱이 커질수록 자잘한 카드는 손해
  switch (id) {
    case 'RS01': return (cnt(owned, 'RS01') < 9 ? 3.5 : 0.5) - bloat;
    case 'RS02': { const n = need(p); return (n.prot > 0 ? 8 : p.research < 5 ? 4 : 1.5) - bloat * 0.3; }
    case 'RS03': { const n = need(p); return n.dna > 0 ? 8.5 : 1.5; }
    case 'VP02': return 1.5 + late * 6;
    case 'VP03': return 4 + late * 9;
    case 'VP04': return -5;
    case 'VP01': return 0;
  }
  if (c.kind !== 'ability') return 0;
  let v = 2 + c.cost * 0.6 - bloat;
  const copies = cnt(owned, id);
  if (!copies) v += 2.5;                          // 유전적 다양성 +2
  else v -= copies * 1.5;
  if (c.tags.includes('persist')) v += E.PER_TURN.includes(id) ? 4 : 1.5;
  if (c.tags.includes('defense')) v -= 2;
  if (['ST01', 'ST02'].includes(id)) v += 1.5;
  if (id === 'ST09' && p.nodes.some(n => NODES[n].top)) v += 4; // 최상위 더미 진열 → 종료 가속
  if (id === 'PR01') v -= 4;
  if (late > .7) v -= 3;
  return v;
}

// ───────── 메인 ─────────
export function aiAction(s, pid) {
  const p = P(s, pid);
  const pd = s.pending;

  if (pd?.kind === 'attack' && pd.targets.includes(pid) && pd.resp[pid] == null) {
    const d = p.hand.find(h => E.DEFENSE_CARDS.includes(h));
    return { type: 'defend', card: d || null };
  }
  if (s.phase === 'setup') {
    const valid = s.map.tiles.map((_, i) => i).filter(i => !E.canPlace(s, pid, i, { free: true }));
    valid.sort((a, b) => tileValue(s, p, b) + (s.map.tiles[b].t === 'G' ? 2 : 0) - tileValue(s, p, a) - (s.map.tiles[a].t === 'G' ? 2 : 0));
    return { type: 'setupPlace', tile: valid[0] };
  }
  if (pd?.kind === 'discard' && pd.pid === pid) {
    return { type: 'discardChoice', cards: [...p.hand].sort((a, b) => discardRank(a) - discardRank(b)).slice(0, pd.n) };
  }
  if (E.curPlayer(s).id !== pid || pd) return null;

  const cands = candidates(s, p);
  for (const a of cands) if (tryAct(s, pid, a)) return a;
  return endTurnAction(s, p);
}

function endTurnAction(s, p) {
  const a = { type: 'endTurn' };
  if (p.research >= 1) { const t = p.hand.find(h => h === 'VP04' || h === 'VP01'); if (t) a.trash = t; }
  if (p.research >= 4) { const pl = bestPlaces(s, p, 1); if (pl.length) a.culture = pl[0]; }
  return a;
}

function candidates(s, p) {
  const out = [];
  const hand = p.hand;
  const free = [];
  // 무료 행동
  if (p.research >= 5 && !s.tf.nuclear) { const c = p.slots.find(id => E.PER_TURN.includes(id)); if (c) free.push({ type: 'nuclear', card: c }); }
  if (E.hasTrait(p, 'TR04') && !s.tf.hibernate) {
    const t = s.map.tiles.map((x, i) => [i, x.pcs[p.id] || 0]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1])[0];
    if (t) free.push({ type: 'hibernate', tile: t[0] });
  }
  out.push(...free);
  if (s.actions < 1) return out;

  const use = id => { const prm = useParams(s, p, id); if (prm) out.push({ type: 'use', card: id, params: prm }); };
  const has = id => hand.includes(id);

  // 1) 행동을 늘려 주는 카드
  ['ST02', 'ST01'].forEach(id => has(id) && use(id));

  // 2) 진화: 완성되거나 2장 이상 낼 수 있으면
  const tgt = nextEvoTarget(p);
  if (tgt) {
    const req = E.evoReq(p, tgt);
    const d = Math.min(cnt(hand, 'RS03'), req.dna - (p.evoTarget ? p.evoProg.dna : 0));
    const pr = Math.min(cnt(hand, 'RS02'), req.prot - (p.evoTarget ? p.evoProg.prot : 0));
    const done = (p.evoTarget ? p.evoProg.dna : 0) + d >= req.dna && (p.evoTarget ? p.evoProg.prot : 0) + pr >= req.prot;
    const opts = E.displayOptions(s, tgt).sort((a, b) => CARDS[b].star - CARDS[a].star);
    const ev = { type: 'evolve', target: tgt, dna: d, prot: pr, display: opts[0] };
    if (done || d + pr >= 2) out.push(ev);
    else if (d + pr >= 1 && s.actions >= 2) out.push(ev);
  }

  // 3) [지속] 장착 (매 턴 효과 우선)
  if (p.slots.length < E.slotCap(p)) {
    hand.filter(id => CARDS[id].tags.includes('persist')).sort((a, b) => E.PER_TURN.includes(b) - E.PER_TURN.includes(a)).forEach(use);
  }

  // 4) 특성 발현 / 연구 (여유 있을 때)
  const money = E.money(s, p);
  const av = E.traitAvail(s, p);
  if (!av.err) {
    const pick = av.list.sort((a, b) => TRAITS[b].tier - TRAITS[a].tier || (['TR02', 'TR12', 'TR06', 'TR11'].includes(b) - ['TR02', 'TR12', 'TR06', 'TR11'].includes(a)))[0];
    out.push({ type: 'trait', trait: pick });
  }
  const r = RESEARCH[p.research + 1];
  if (r && money >= r.rna && cnt(hand, 'RS02') >= r.prot + (tgt ? 1 : 0)) out.push({ type: 'research' });

  // 5) 쓸 만한 능력 카드 사용 (단백질이 진화에 더 급하면 아낌)
  const abil = [...new Set(hand)].filter(id => CARDS[id].kind === 'ability' && CARDS[id].tags.includes('once'));
  abil.sort((a, b) => cardWorth(s, p, b) - cardWorth(s, p, a)).forEach(use);

  // 6) 구매: 살 수 있는 것 중 가치 최고
  const buys = [];
  for (const id of ['RS01', 'RS02', 'RS03', 'VP02', 'VP03', 'ST01', 'ST02', 'ST03', 'ST05', 'ST07', 'ST08', 'ST09', 'ST10', 'ST04', 'ST06'])
    if ((s.supply[id] || 0) > 0 && E.buyCost(s, p, id) <= money) buys.push(id);
  for (const d of s.display) if (!E.lineageBuyable(s, p, d.card) && E.buyCost(s, p, d.card) <= money) buys.push(d.card);
  buys.sort((a, b) => (cardWorth(s, p, b) + E.buyCost(s, p, b) * 0.3) - (cardWorth(s, p, a) + E.buyCost(s, p, a) * 0.3));
  for (const id of buys) if (cardWorth(s, p, id) > 2.5) out.push({ type: 'buy', card: id });

  // 7) 진화 1장이라도
  if (tgt) {
    const req = E.evoReq(p, tgt);
    const d = Math.min(cnt(hand, 'RS03'), req.dna - (p.evoTarget ? p.evoProg.dna : 0));
    const pr = Math.min(cnt(hand, 'RS02'), req.prot - (p.evoTarget ? p.evoProg.prot : 0));
    if (d + pr >= 1) out.push({ type: 'evolve', target: tgt, dna: d, prot: pr, display: E.displayOptions(s, tgt)[0] });
  }
  return out;
}

// 이 클라이언트가 지금 처리해야 할 AI (없으면 null)
export function aiToMove(s) {
  if (!s || s.phase === 'ended') return null;
  const isAI = id => s.players.find(p => p.id === id)?.ai;
  const pd = s.pending;
  if (pd?.kind === 'attack') { const t = pd.targets.find(t => pd.resp[t] == null); return t && isAI(t) ? t : null; }
  if (s.phase === 'setup') { const id = s.players[s.players.length - 1 - s.setupStep].id; return isAI(id) ? id : null; }
  const cur = E.curPlayer(s).id;
  return isAI(cur) ? cur : null;
}
