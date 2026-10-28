// 생명의 계통수 — 규칙 엔진 (DOM 없음, 순수 상태 변환)
// applyAction(state, pid, action) → 새 상태 반환, 규칙 위반 시 Error throw
import {
  TERRAIN, NODES, NODE_ORDER, CARDS, STARTER_PILES, SUPPLY, LINEAGE_COPIES, lineageCards,
  TRAITS, TRAIT_COST, TRAIT_SCORE, RESEARCH, ACHIEVEMENTS, PLAYER_COLORS, MARKERS, MAP_LAYOUT, LINEAGES,
} from './data.js';

// 베타 수정안: 기본 행동 2회 (설명서 원안은 1회)
export const BASE_ACTIONS = 2;

const clone = o => JSON.parse(JSON.stringify(o));
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fail = msg => { throw new Error(msg); };
const cname = id => CARDS[id]?.name ?? id;

// ───────────────────────── 준비 ─────────────────────────
export function createGame(playerList) {
  const n = playerList.length;
  if (n < 2 || n > 6) fail('2~6인만 가능합니다.');
  const tiles = buildMap(n);
  const cols = MAP_LAYOUT[n];
  const players = shuffle([...playerList]).map((p, i) => {
    const deck = shuffle([...Array(7).fill('RS01'), ...Array(3).fill('VP01')]);
    return {
      id: p.id, name: p.name, color: PLAYER_COLORS[i], ai: !!p.ai,
      deck, hand: deck.splice(0, 5), discard: [], slots: [], evoPaid: [],
      nodes: ['LUCA'], evoTarget: null, evoProg: { dna: 0, prot: 0 },
      research: 0, traitStage: 0, traits: [], ach: [], removal: 0, achPts: 0,
    };
  });
  const lineagePiles = {};
  for (const lin of Object.keys(LINEAGES)) if (lin !== 'ST') for (const id of lineageCards(lin)) lineagePiles[id] = LINEAGE_COPIES;
  const s = {
    phase: 'setup', setupStep: 0, players, turn: 0, round: 1, actions: 0,
    tf: {}, roundUse: {}, dormant: {},
    map: { cols, tiles },
    supply: scaledSupply(n), lineagePiles, display: [], displaySeq: 0,
    starOwner: {}, achTaken: {}, traitTaken: {},
    endTrack: 0, endTarget: n * 5, endTriggered: false,
    pending: null, trashCount: 0, log: [], seq: 0, final: null,
  };
  log(s, `게임 시작! 시작 플레이어: ${players[0].name}. 역순으로 첫 개체를 배치합니다.`);
  return s;
}

// 공급 수량: 자원은 인원수에 비례 (data.js SUPPLY는 2인 기준)
function scaledSupply(n) {
  const s = { ...SUPPLY };
  s.RS01 += (n - 2) * 10; s.RS02 += (n - 2) * 10; s.RS03 += (n - 2) * 10; s.VP04 += (n - 2) * 4;
  return s;
}

function buildMap(n) {
  const count = n * 3 + 6;
  const pool = shuffle(['G', 'W', 'F', 'D'].flatMap(t => Array(6).fill(t)));
  const pick = ['G', 'W', 'F', 'D'].flatMap(t => [t, t]);
  for (const t of pick) pool.splice(pool.indexOf(t), 1);
  const chosen = shuffle([...pick, ...pool.slice(0, count - 8)]);
  return chosen.map(t => ({ t, kb: 0, pcs: {} }));
}

// ───────────────────────── 유틸 ─────────────────────────
export function log(s, msg) {
  s.log.push({ i: s.seq++, r: s.round, m: msg });
  if (s.log.length > 150) s.log.splice(0, s.log.length - 150);
}
export const curPlayer = s => s.players[s.turn];
export const pIndex = (s, pid) => s.players.findIndex(p => p.id === pid);
const P = (s, pid) => s.players[pIndex(s, pid)];
export const hasTrait = (p, t) => p.traits.includes(t);
export const hasAch = (p, a) => p.ach.includes(a);
export const hasSlot = (p, id) => p.slots.includes(id);
const count = (arr, id) => arr.filter(x => x === id).length;
const removeOne = (arr, id) => { const i = arr.indexOf(id); if (i < 0) return false; arr.splice(i, 1); return true; };
const removeN = (arr, id, n) => { for (let i = 0; i < n; i++) if (!removeOne(arr, id)) fail('카드가 부족합니다.'); };

export function draw(s, p, n) {
  let got = 0;
  for (let i = 0; i < n; i++) {
    if (!p.deck.length) {
      if (!p.discard.length) break;
      p.deck = shuffle(p.discard); p.discard = [];
    }
    p.hand.push(p.deck.pop()); got++;
  }
  return got;
}

function gainToHand(s, p, id, n) {
  const k = Math.min(n, s.supply[id] ?? 0);
  s.supply[id] -= k;
  for (let i = 0; i < k; i++) p.hand.push(id);
  return k;
}
// 자원 생산 효과 (다세포화: 산출량 +1)
function produce(s, p, gains, src) {
  const parts = [];
  gains.forEach(([id, n], i) => {
    const amt = n + (i === 0 && hasAch(p, 'A4') && n > 0 ? 1 : 0);
    if (amt <= 0) return;
    const k = gainToHand(s, p, id, amt);
    if (k) parts.push(`${cname(id)} ${k}`);
  });
  log(s, `${p.name}: ${src} → ${parts.length ? parts.join(', ') + ' 획득' : '공급 부족으로 획득 없음'}`);
}

export const slotCap = p => Math.min(6, 2 + (p.nodes.length - 1) + (hasAch(p, 'A2') ? 1 : 0));
export const openedCount = p => p.nodes.length - 1;
export const markersOnMap = (s, pid) => s.map.tiles.reduce((a, t) => a + (t.pcs[pid] || 0), 0);
export const markersLeft = (s, pid) => MARKERS - markersOnMap(s, pid);
export const tileTotal = t => Object.values(t.pcs).reduce((a, b) => a + b, 0);
export const ownedCards = p => [...p.deck, ...p.hand, ...p.discard, ...p.slots, ...p.evoPaid];

export function roundUsed(s, pid, key) { return s.roundUse[pid + ':' + key] === s.round; }
function useRound(s, pid, key) { s.roundUse[pid + ':' + key] = s.round; }

// ───────────────────────── 지도 ─────────────────────────
export function tileXY(s, i) { return [i % s.map.cols, Math.floor(i / s.map.cols)]; }
export function dist(s, a, b) {
  const [ax, ay] = tileXY(s, a), [bx, by] = tileXY(s, b);
  return Math.abs(ax - bx) + Math.abs(ay - by);
}
export function adjacent(s, a, b) { return dist(s, a, b) === 1; }

export function enhanced(s, p, terrs) {
  if (!terrs) return false;
  if (terrs.includes('ALL')) return true;
  if (hasTrait(p, 'TR14') && p.nodes.some(n => NODES[n].top)) return true;
  return terrs.some(t => {
    if (hasTrait(p, 'TR08') && (t === 'W' || t === 'D')) return true;
    return s.map.tiles.some(tile => tile.t === t && (tile.pcs[p.id] || 0) > 0);
  });
}

export function effK(s, pid, i) {
  const t = s.map.tiles[i];
  const p = P(s, pid);
  let k = TERRAIN[t.t].k + t.kb;
  if (hasTrait(p, 'TR08') && (t.t === 'W' || t.t === 'D')) k += 1;
  for (const q of s.players) if (q.id !== pid && hasTrait(q, 'TR13') && (t.pcs[q.id] || 0) > 0) { k -= 1; break; }
  return k;
}

// 배치 가능 여부. opts: ignoreAdj, overK(+n), free(초기 배치)
export function canPlace(s, pid, i, opts = {}) {
  const t = s.map.tiles[i];
  if (!t) return '없는 타일';
  const p = P(s, pid);
  if (markersLeft(s, pid) <= 0) return '남은 개체 마커가 없습니다.';
  for (const q of s.players) if (q.id !== pid && hasTrait(q, 'TR11') && (t.pcs[q.id] || 0) >= 2) return `${q.name}의 세력권입니다.`;
  const others = Object.entries(t.pcs).some(([id, c]) => id !== pid && c > 0);
  const parasite = hasTrait(p, 'TR07') && others;
  if (!parasite && tileTotal(t) >= effK(s, pid, i) + (opts.overK || 0)) return '환경수용력(K)이 가득 찼습니다.';
  if (opts.free || opts.ignoreAdj || hasTrait(p, 'TR06') || hasAch(p, 'A7')) return null;
  if (markersOnMap(s, pid) === 0) return null;
  const range = hasTrait(p, 'TR05') ? 2 : 1;
  for (let j = 0; j < s.map.tiles.length; j++)
    if ((s.map.tiles[j].pcs[pid] || 0) > 0 && dist(s, i, j) <= range) return null;
  return '자기 개체가 있는 타일이나 인접 타일에만 놓을 수 있습니다.';
}
export function canMove(s, pid, from, to, opts = {}) {
  if ((s.map.tiles[from]?.pcs[pid] || 0) <= 0) return '그 타일에 자기 개체가 없습니다.';
  if (from === to) return '같은 타일입니다.';
  const t = s.map.tiles[to];
  const p = P(s, pid);
  for (const q of s.players) if (q.id !== pid && hasTrait(q, 'TR11') && (t.pcs[q.id] || 0) >= 2) return `${q.name}의 세력권입니다.`;
  const others = Object.entries(t.pcs).some(([id, c]) => id !== pid && c > 0);
  if (!(hasTrait(p, 'TR07') && others) && tileTotal(t) >= effK(s, pid, to)) return '환경수용력(K)이 가득 찼습니다.';
  if (opts.adj && !hasTrait(p, 'TR06') && !adjacent(s, from, to)) return '인접 타일로만 옮길 수 있습니다.';
  return null;
}
function addPc(s, pid, i, n = 1) { const t = s.map.tiles[i]; t.pcs[pid] = (t.pcs[pid] || 0) + n; }
function subPc(s, pid, i, n = 1) { const t = s.map.tiles[i]; t.pcs[pid] = (t.pcs[pid] || 0) - n; if (t.pcs[pid] <= 0) delete t.pcs[pid]; }

export function doPlace(s, pid, i, opts = {}) {
  const why = canPlace(s, pid, i, opts);
  if (why) fail(`${i + 1}번 타일: ${why}`);
  addPc(s, pid, i);
}
export function doMove(s, pid, from, to, opts = {}) {
  const why = canMove(s, pid, from, to, opts);
  if (why) fail(`${from + 1}→${to + 1}번: ${why}`);
  if (s.dormant[pid] === from && (s.map.tiles[from].pcs[pid] || 0) <= 1) delete s.dormant[pid];
  subPc(s, pid, from); addPc(s, pid, to);
}

// 자동 재배치 (포자·재생): 자기 개체가 많은 타일 우선, 없으면 아무 곳
function autoReplace(s, pid, exclude) {
  const cand = s.map.tiles.map((t, i) => i).filter(i => i !== exclude && !canPlace(s, pid, i, { ignoreAdj: true }));
  if (!cand.length) return null;
  cand.sort((a, b) => (s.map.tiles[b].pcs[pid] || 0) - (s.map.tiles[a].pcs[pid] || 0));
  addPc(s, pid, cand[0]);
  return cand[0];
}

// 개체 제거 해결. victims: [{tile, owner}]. 반환: 실제 제거된 상대 개체 수
export function resolveRemoval(s, remover, victims, src) {
  const R = P(s, remover);
  const byOwner = {};
  for (const v of victims) (byOwner[v.owner] ??= []).push(v.tile);
  let removedOpp = 0;
  for (const [oid, tilesList] of Object.entries(byOwner)) {
    const O = P(s, oid);
    let list = [...tilesList];
    // 라운드당 1회 무효화 (세포벽 / 내생 포자 / 보호색)
    const negs = [['PK02', hasSlot(O, 'PK02'), '세포벽'], ['BA02', hasSlot(O, 'BA02'), '내생 포자'],
      ['TR01', hasTrait(O, 'TR01') && s.map.tiles.some(t => (t.t === 'F' || t.t === 'D') && (t.pcs[oid] || 0) > 0), '보호색']];
    const neg = negs.find(([k, ok]) => ok && !roundUsed(s, oid, k));
    if (neg) { useRound(s, oid, neg[0]); log(s, `${O.name}: 「${neg[2]}」로 개체 제거를 무효화!`); continue; }
    if (hasTrait(O, 'TR02') && list.length) { list.pop(); log(s, `${O.name}: 「외골격」으로 제거 수 -1`); }
    let removedHere = 0;
    for (const ti of list) {
      const t = s.map.tiles[ti];
      let have = t.pcs[oid] || 0;
      const protectedOne = s.dormant[oid] === ti ? 1 : 0;
      if (have - protectedOne <= 0) { log(s, `${O.name}의 ${ti + 1}번 타일 개체는 휴면 중이라 제거되지 않습니다.`); continue; }
      // 의태
      if (hasTrait(O, 'TR03') && !roundUsed(s, oid, 'TR03')) {
        const alt = Object.entries(t.pcs).filter(([id, c]) => id !== oid && c > 0 && !(s.dormant[id] === ti && c <= 1))
          .sort((a, b) => (b[0] === remover) - (a[0] === remover) || b[1] - a[1])[0];
        if (alt) {
          useRound(s, oid, 'TR03');
          subPc(s, alt[0], ti);
          log(s, `${O.name}: 「의태」! 대신 ${P(s, alt[0]).name}의 개체가 ${ti + 1}번 타일에서 제거됨`);
          if (alt[0] !== remover) removedOpp++;
          continue;
        }
      }
      subPc(s, oid, ti);
      removedHere++;
      if (oid !== remover) removedOpp++;
      log(s, `${O.name}의 개체 1개가 ${ti + 1}번 타일에서 제거됨 (${src})`);
      if (hasTrait(R, 'TR15') && oid !== remover && !canPlace(s, remover, ti, { ignoreAdj: true })) {
        addPc(s, remover, ti); log(s, `${R.name}: 「침입종」으로 ${ti + 1}번 타일에 개체 배치`);
      }
    }
    if (removedHere) {
      if (hasTrait(O, 'TR13') && oid !== remover && (s.supply.VP04 || 0) > 0) {
        s.supply.VP04--; R.discard.push('VP04'); log(s, `${O.name}의 「독성」: ${R.name}이(가) 유해 돌연변이를 받음`);
      }
      if (hasSlot(O, 'FU03')) { const r = autoReplace(s, oid, list[0]); if (r != null) log(s, `${O.name}: 「포자」로 ${r + 1}번 타일에 재배치`); }
      if (hasTrait(O, 'TR10')) { const r = autoReplace(s, oid, -1); if (r != null) log(s, `${O.name}: 「재생」으로 ${r + 1}번 타일에 재배치`); }
    }
  }
  if (removedOpp > 0) { R.removal += 1; log(s, `${R.name}: 개체 제거 즉시 점수 +1`); }
  return removedOpp;
}

// ───────────────────────── 비용 ─────────────────────────
export function money(s, p) {
  const r = count(p.hand, 'RS01');
  const pcr = p.research >= 2 && !s.tf.pcrUsed && r > 0;
  return r * 2 + (pcr ? 2 : 0);
}
// RNA 카드로 amount 만큼 지불 (최소 장수 자동 계산)
function payMoney(s, p, amount) {
  if (amount <= 0) return 0;
  if (money(s, p) < amount) fail(`RNA가 부족합니다 (필요 ${amount}, 보유 ${money(s, p)}).`);
  let left = amount, used = 0;
  if (p.research >= 2 && !s.tf.pcrUsed) { left -= 4; used++; s.tf.pcrUsed = true; }
  while (left > 0) { left -= 2; used++; }
  removeN(p.hand, 'RS01', used);
  for (let i = 0; i < used; i++) p.discard.push('RS01');
  return used;
}
export const protNeed = (p, id) => Math.max(0, (CARDS[id].prot || 0) - (hasSlot(p, 'EK02') ? 1 : 0));
function payProt(p, n, dest) {
  if (count(p.hand, 'RS02') < n) fail(`단백질이 부족합니다 (필요 ${n}).`);
  removeN(p.hand, 'RS02', n);
  for (let i = 0; i < n; i++) dest.push('RS02');
}

export function buyCost(s, p, id) {
  const c = CARDS[id];
  let cost = c.cost;
  if (hasAch(p, 'A8') && p.nodes.includes(c.lin)) cost -= 1;
  return Math.max(0, cost);
}
// 계통 카드 구매 가능 여부
export function lineageBuyable(s, p, id) {
  const c = CARDS[id];
  const research3 = p.research >= 3;
  if (!p.nodes.includes(c.lin) && !research3) return `${LINEAGES[c.lin]} 노드를 개방해야 합니다.`;
  if (c.star && s.starOwner[c.lin] !== p.id && !research3) return '★ 카드는 그 계통을 처음 개방한 사람만 살 수 있습니다.';
  return null;
}

// ───────────────────────── 진열대 ─────────────────────────
export function displayOptions(s, lin) {
  return lineageCards(lin).filter(id => s.lineagePiles[id] > 0 && !s.display.some(d => d.card === id));
}
function displayPile(s, p, id) {
  const lin = CARDS[id].lin;
  if (!displayOptions(s, lin).includes(id)) fail('진열할 수 없는 더미입니다.');
  if (s.display.length >= 6) {
    const victim = [...s.display].sort((a, b) => s.lineagePiles[a.card] - s.lineagePiles[b.card] || a.at - b.at)[0];
    s.display.splice(s.display.indexOf(victim), 1);
    log(s, `진열대가 가득 차 「${cname(victim.card)}」 더미를 치웠습니다.`);
  }
  s.display.push({ card: id, at: s.displaySeq++, by: p.id });
  log(s, `${p.name}: 「${cname(id)}」 더미(${s.lineagePiles[id]}장)를 계통 진열대에 올림`);
  const add = NODES[lin].end;
  if (add) {
    s.endTrack += add;
    log(s, `종료 트랙 +${add} → ${s.endTrack}/${s.endTarget}`);
    if (!s.endTriggered && s.endTrack >= s.endTarget) {
      s.endTriggered = true;
      log(s, '⚑ 종료 조건 달성! 이번 라운드를 마지막 플레이어까지 진행한 뒤 게임이 끝납니다.');
    }
  }
}

// ───────────────────────── 업적 ─────────────────────────
function grantAch(s, p, a) {
  if (s.achTaken[a]) return;
  s.achTaken[a] = p.id; p.ach.push(a); p.achPts += ACHIEVEMENTS[a].pts;
  log(s, `🏆 ${p.name}: 업적 「${ACHIEVEMENTS[a].name}」 달성 (+${ACHIEVEMENTS[a].pts}점)`);
}
function checkMapAch(s) {
  for (const p of s.players) {
    const terrs = new Set(s.map.tiles.filter(t => (t.pcs[p.id] || 0) > 0).map(t => t.t));
    if (terrs.has('G') && terrs.has('F') && terrs.has('D')) grantAch(s, p, 'A6');
    if (s.map.tiles.filter(t => (t.pcs[p.id] || 0) > 0).length >= 5) grantAch(s, p, 'A7');
    if (p.slots.length >= 3) grantAch(s, p, 'A4');
  }
}

// ───────────────────────── 진화 ─────────────────────────
export function evoReq(p, node) {
  const n = NODES[node];
  return { dna: Math.max(0, n.dna - (hasAch(p, 'A1') ? 1 : 0)), prot: n.prot };
}
export function canTarget(p, node) {
  if (node === 'LUCA' || !NODES[node]) return '선택할 수 없는 노드';
  if (p.nodes.includes(node)) return '이미 개방한 노드입니다.';
  if (!p.nodes.includes(NODES[node].pre)) return `선행 노드(${NODES[NODES[node].pre].name})가 필요합니다.`;
  if (node === 'HU') {
    const own = ownedCards(p);
    if (!own.some(id => CARDS[id].lin === 'PL') || !own.some(id => CARDS[id].lin === 'FU'))
      return '인간은 식물 카드 1장 이상 + 균류 카드 1장 이상을 보유해야 합니다.';
  }
  return null;
}
function openNode(s, p, node, displayCard) {
  p.nodes.push(node);
  p.evoTarget = null; p.evoProg = { dna: 0, prot: 0 };
  log(s, `🧬 ${p.name}: 「${NODES[node].name}」 노드 개방! (능력 슬롯 ${slotCap(p)}칸)`);
  if (!s.starOwner[node]) s.starOwner[node] = p.id;
  if (node === 'PK') grantAch(s, p, 'A1');
  if (node === 'EK') grantAch(s, p, 'A2');
  if (NODES[node].top && node !== 'HU') grantAch(s, p, 'A8');
  if (node === 'HU') grantAch(s, p, 'A9');
  const opts = displayOptions(s, node);
  if (opts.length) displayPile(s, p, opts.includes(displayCard) ? displayCard : opts[0]);
}

// ───────────────────────── 특성 / 연구 ─────────────────────────
export function traitAvail(s, p) {
  const stage = p.traitStage + 1;
  if (stage > 4) return { err: '특성 발현 트랙을 모두 진행했습니다.' };
  if (openedCount(p) < stage) return { err: `진화 노드 ${stage}개 이상 개방이 필요합니다.` };
  if (money(s, p) < TRAIT_COST[stage]) return { err: `RNA ${TRAIT_COST[stage]} 필요` };
  const list = Object.keys(TRAITS).filter(k => TRAITS[k].tier <= stage && !s.traitTaken[k]);
  if (!list.length) return { err: '가져갈 수 있는 특성 카드가 없습니다.' };
  return { stage, list };
}
export function researchAvail(s, p) {
  const r = RESEARCH[p.research + 1];
  if (!r) return '연구 트랙을 모두 진행했습니다.';
  if (money(s, p) < r.rna) return `RNA ${r.rna} 필요`;
  if (count(p.hand, 'RS02') < r.prot) return `단백질 ${r.prot} 필요`;
  return null;
}

// ───────────────────────── 턴 흐름 ─────────────────────────
// 매 턴 효과를 가진 [지속] 카드
export const PER_TURN = ['EK01', 'EK04', 'PR03', 'PL01', 'AN01', 'FU04', 'HU02'];
function perTurn(s, p, id) {
  const c = CARDS[id];
  switch (id) {
    case 'EK01': draw(s, p, 1); log(s, `${p.name}: 「세포핵」 카드 1장 더 뽑음`); break;
    case 'EK04': draw(s, p, 2); addDiscard(s, p, 1, '감수분열'); log(s, `${p.name}: 「감수분열」 2장 뽑고 1장 버리기`); break;
    case 'PR03': produce(s, p, [['RS01', 1]], c.name); break;
    case 'PL01': produce(s, p, [['RS01', enhanced(s, p, c.terr) ? 2 : 1]], c.name); break;
    case 'AN01': s.actions += 1; log(s, `${p.name}: 「신경계」 추가 행동 +1`); break;
    case 'FU04': {
      const n = Math.min(3, s.map.tiles.filter(t => t.t === 'F').reduce((a, t) => a + (t.pcs[p.id] || 0), 0));
      produce(s, p, [['RS01', n]], c.name); break;
    }
    case 'HU02': produce(s, p, [['RS01', 2], ['RS02', 1]], c.name); break;
  }
}
function addDiscard(s, p, n, why) {
  if (s.pending && s.pending.kind === 'discard' && s.pending.pid === p.id) { s.pending.n += n; s.pending.why += ', ' + why; }
  else s.pending = { kind: 'discard', pid: p.id, n, why };
  s.pending.n = Math.min(s.pending.n, p.hand.length);
  if (s.pending.n <= 0) s.pending = null;
}

function startTurn(s) {
  const p = curPlayer(s);
  s.actions = BASE_ACTIONS; s.tf = {};
  delete s.dormant[p.id];
  log(s, `── ${p.name}의 턴 (라운드 ${s.round}) ──`);
  for (const id of p.slots) if (PER_TURN.includes(id)) perTurn(s, p, id);
  if (hasAch(p, 'A5')) { draw(s, p, 1); addDiscard(s, p, 1, '유성생식'); log(s, `${p.name}: 「유성생식의 등장」 1장 뽑고 1장 버리기`); }
}

function endTurn(s, p, a) {
  // 정리 단계
  if (a.trash) {
    if (p.research < 1) fail('제한 효소 연구가 필요합니다.');
    if (!removeOne(p.hand, a.trash)) fail('손패에 없는 카드입니다.');
    s.trashCount++; log(s, `${p.name}: 「제한 효소」로 「${cname(a.trash)}」 영구 제거`);
  }
  if (a.culture != null) {
    if (p.research < 4) fail('조직 배양 연구가 필요합니다.');
    doPlace(s, p.id, a.culture); log(s, `${p.name}: 「조직 배양」으로 ${a.culture + 1}번 타일에 개체 배치`);
  }
  p.discard.push(...p.hand); p.hand = [];
  draw(s, p, 5);
  checkMapAch(s);
  // 다음 플레이어
  s.turn = (s.turn + 1) % s.players.length;
  if (s.turn === 0) {
    if (s.endTriggered) return finishGame(s);
    s.round++;
  }
  startTurn(s);
}

function finishGame(s) {
  s.phase = 'ended';
  s.final = s.players.map(p => ({ id: p.id, ...computeScore(s, p) }));
  const ranked = rankPlayers(s);
  s.final.forEach(f => f.rank = ranked.findIndex(r => r.id === f.id) + 1);
  log(s, `🏁 게임 종료! 승자: ${P(s, ranked[0].id).name} (${ranked[0].total}점)`);
}
export function rankPlayers(s) {
  const rows = s.players.map(p => ({ id: p.id, ...computeScore(s, p), depth: depth(p) }));
  rows.sort((a, b) => b.total - a.total || b.eco - a.eco || b.pieces - a.pieces || b.depth - a.depth);
  return rows;
}
const depth = p => Math.max(...p.nodes.map(n => ({ LUCA: 0, PK: 1, EK: 2, PR: 3, BA: 2, AR: 2, PL: 4, AN: 4, FU: 4, HU: 5 }[n])));

// ───────────────────────── 점수 ─────────────────────────
export function computeScore(s, p) {
  const own = ownedCards(p);
  const card = own.reduce((a, id) => a + (CARDS[id]?.vp || 0), 0);
  const pieces = markersOnMap(s, p.id);
  const rate = p.nodes.includes('HU') ? 5 : p.nodes.includes('AN') ? 3 : p.nodes.includes('PL') ? 2 : 1;
  let dom = 0;
  s.map.tiles.forEach(t => {
    const mine = t.pcs[p.id] || 0;
    if (!mine) return;
    const best = Math.max(...Object.entries(t.pcs).filter(([id]) => id !== p.id).map(([, c]) => c), 0);
    if (mine > best) dom += 3 + (t.t === 'D' ? 2 : 0);
  });
  let mapBonus = 0;
  const onT = tt => s.map.tiles.filter(t => tt.includes(t.t)).reduce((a, t) => a + (t.pcs[p.id] || 0), 0);
  if (hasAch(p, 'A6')) mapBonus += onT(['G', 'F', 'D']);
  if (hasAch(p, 'A9')) mapBonus += pieces;
  if (hasSlot(p, 'AR03')) mapBonus += onT(['D']) * 2;
  const map = pieces * rate + dom + mapBonus;
  const genetic = new Set(own.filter(id => CARDS[id].kind === 'ability')).size * 2;
  const species = openedCount(p) * 3;
  const terrN = new Set(s.map.tiles.filter(t => (t.pcs[p.id] || 0) > 0).map(t => t.t)).size;
  const eco = [0, 1, 4, 9, 16][terrN];
  const genome = Math.floor(own.length / 5);
  const div = genetic + species + eco + genome;
  const tech = p.achPts + p.research * 2 + TRAIT_SCORE[p.traitStage];
  const total = card + map + div + tech + p.removal;
  return { total, card, map, pieces, rate, dom, mapBonus, div, genetic, species, eco, genome, tech, achPts: p.achPts, research: p.research * 2, trait: TRAIT_SCORE[p.traitStage], removal: p.removal };
}

// ───────────────────────── 카드 사용 ─────────────────────────
function placeList(s, p, list, max, opts = {}, label) {
  if (!Array.isArray(list)) list = [];
  if (list.length > max) fail(`최대 ${max}개까지 배치할 수 있습니다.`);
  let over = opts.overKTile;
  for (const i of list) {
    const o = { ignoreAdj: opts.ignoreAdj };
    if (over != null && over === i && canPlace(s, p.id, i, o) && !canPlace(s, p.id, i, { ...o, overK: 1 })) { o.overK = 1; over = null; }
    doPlace(s, p.id, i, o);
  }
  if (list.length) log(s, `${p.name}: ${label} → ${list.map(i => i + 1).join(', ')}번 타일에 개체 배치`);
}
// 다산: 배치 카드 효과마다 +1
const fert = p => (hasTrait(p, 'TR12') ? 1 : 0);
export const PLACE_CARDS = { ST05: 1, ST09: 1, PK01: 2, PL04: 2, AN02: 1, FU01: 2, BA01: 3, AR01: 2, HU01: 2 };

function useCard(s, p, id, prm = {}) {
  const c = CARDS[id];
  if (c.kind !== 'ability') fail('능력 카드가 아닙니다.');
  if (c.tags.includes('defense')) fail('[방어] 카드는 다른 플레이어의 공격을 받을 때만 사용합니다.');
  if (!p.hand.includes(id)) fail('손패에 없는 카드입니다.');
  const isPersist = c.tags.includes('persist');
  if (isPersist && p.slots.length >= slotCap(p)) fail('능력 슬롯이 가득 찼습니다.');
  const need = protNeed(p, id);
  if (count(p.hand, 'RS02') < need) fail(`단백질 ${need}장이 필요합니다.`);
  // 사전 검증이 필요한 카드
  if (id === 'ST06' && (!prm.trash || prm.trash === id && count(p.hand, id) < 2 || !p.hand.includes(prm.trash))) fail('영구 제거할 손패를 고르세요.');
  removeOne(p.hand, id);
  payProt(p, need, p.discard);
  s.actions -= 1;
  if (isPersist) {
    p.slots.push(id);
    log(s, `${p.name}: 「${c.name}」 능력 슬롯에 장착 (${p.slots.length}/${slotCap(p)})`);
    if (c.photo) grantAch(s, p, 'A3');
    if (id === 'EK04') grantAch(s, p, 'A5');
    checkMapAch(s);
    return;
  }
  log(s, `${p.name}: 「${c.name}」 사용`);
  const enh = enhanced(s, p, c.terr);
  const F = fert(p);
  switch (id) {
    case 'ST01': s.actions += 1; draw(s, p, 1); break;
    case 'ST02': s.actions += 2; break;
    case 'ST03': produce(s, p, [['RS02', 1]], c.name); break;
    case 'ST05': placeList(s, p, prm.places, 1 + F, {}, c.name); break;
    case 'ST06':
      removeOne(p.hand, prm.trash); s.trashCount++;
      log(s, `${p.name}: 「${cname(prm.trash)}」 영구 제거`); draw(s, p, 1); break;
    case 'ST07': draw(s, p, 2); addDiscard(s, p, 1, '돌연변이'); break;
    case 'ST08':
      if (prm.mode === 'move') {
        const [f, t] = prm.move || [];
        doMove(s, p.id, f, t); log(s, `${p.name}: 개체를 ${f + 1}→${t + 1}번 타일로 이동`);
        if (F) placeList(s, p, prm.places, F, {}, '다산');
      } else placeList(s, p, prm.places, 1 + F, {}, c.name);
      break;
    case 'ST09': {
      if (prm.display) {
        const lin = CARDS[prm.display]?.lin;
        if (!p.nodes.includes(lin) || lin === 'LUCA') fail('자기가 개방한 계통만 진열할 수 있습니다.');
        displayPile(s, p, prm.display);
      }
      placeList(s, p, prm.places, 1 + F, {}, c.name); break;
    }
    case 'PK01': placeList(s, p, prm.places, 2 + F, {}, c.name); break;
    case 'PK03': {
      produce(s, p, [['RS02', 1]], c.name);
      const holder = s.achTaken.A3;
      if (holder && holder !== p.id && removeOne(p.hand, 'RS01')) { p.discard.push('RS01'); log(s, `${p.name}: 「대산소화 사건」 때문에 RNA 1장을 버림`); }
      break;
    }
    case 'EK03': produce(s, p, [['RS02', 2]], c.name); break;
    case 'PR01': case 'AN02': {
      const mv = Array.isArray(prm.moves) ? prm.moves : [];
      if (mv.length > 2) fail('최대 2개까지 옮깁니다.');
      for (const [f, t] of mv) { doMove(s, p.id, f, t, { adj: true }); log(s, `${p.name}: 개체 ${f + 1}→${t + 1}번 이동`); }
      if (id === 'AN02') placeList(s, p, prm.places, 1 + F, {}, c.name);
      break;
    }
    case 'PR02': {
      const v = prm.victim;
      if (!v) break;
      checkVictims(s, p, [v]);
      resolveRemoval(s, p.id, [v], c.name); break;
    }
    case 'PL02': placeList(s, p, prm.places, (enh ? 3 : 2) + F, {}, c.name); break;
    case 'PL03': produce(s, p, [['RS02', enh ? 3 : 2]], c.name); break;
    case 'PL04': placeList(s, p, (prm.places || []).slice(0, 2), 2, { ignoreAdj: true }, c.name);
      placeList(s, p, (prm.places || []).slice(2), F, {}, '다산'); draw(s, p, 2); break;
    case 'AN04': {
      const vs = Array.isArray(prm.victims) ? prm.victims : [];
      if (vs.length > 2) fail('최대 2개까지 제거합니다.');
      checkVictims(s, p, vs, true);
      produce(s, p, [['RS02', 1]], c.name);
      if (vs.length) startAttack(s, p, id, [...new Set(vs.map(v => v.owner))], { victims: vs });
      break;
    }
    case 'FU01': {
      const pl = Array.isArray(prm.places) ? prm.places : [];
      const base = pl.slice(0, 2);
      if (new Set(base).size !== base.length) fail('균사는 서로 다른 타일에 1개씩 배치합니다.');
      for (const i of base) {
        const ok = s.map.tiles.some((t, j) => (t.pcs[p.id] || 0) > 0 && adjacent(s, i, j));
        if (!ok) fail('균사는 자기 개체가 있는 타일과 인접한 타일에만 배치합니다.');
      }
      placeList(s, p, base, 2, {}, c.name);
      placeList(s, p, pl.slice(2), F, {}, '다산');
      break;
    }
    case 'FU02': {
      const take = Array.isArray(prm.take) ? prm.take : [];
      if (take.length > (enh ? 2 : 1)) fail('가져올 수 있는 장수를 넘었습니다.');
      for (const t of take) { if (!removeOne(p.discard, t)) fail('버림더미에 없는 카드입니다.'); p.hand.push(t); }
      log(s, `${p.name}: 버림더미에서 ${take.map(cname).join(', ') || '없음'}을(를) 손패로`);
      break;
    }
    case 'BA01': placeList(s, p, prm.places, 3 + F, { overKTile: prm.overTile }, c.name); break;
    case 'BA03': {
      const tk = prm.take;
      if (tk) {
        const d = s.display.find(x => x.card === tk);
        if (!d) fail('진열대에 없는 카드입니다.');
        const lin = CARDS[tk].lin;
        if (!s.players.some(q => q.id !== p.id && q.nodes.includes(lin))) fail('상대가 개방한 계통의 카드만 가져올 수 있습니다.');
        if (CARDS[tk].star && s.starOwner[lin] !== p.id && p.research < 3) fail('★ 카드는 가져올 수 없습니다.');
        takeFromDisplay(s, tk); p.discard.push(tk);
        log(s, `${p.name}: 「${cname(tk)}」을(를) 비용 없이 가져옴`);
      }
      break;
    }
    case 'AR01': {
      const t = prm.tile;
      if (t != null) {
        const tile = s.map.tiles[t];
        if (!tile || !['D', 'W'].includes(tile.t)) fail('사막 또는 수생태계 타일을 골라야 합니다.');
        tile.kb += 1; log(s, `${t + 1}번 타일의 환경수용력 영구 +1`);
        const pl = Array.isArray(prm.places) ? prm.places : [];
        if (pl.slice(0, 2).some(x => x !== t)) fail('그 타일에 배치해야 합니다.');
        placeList(s, p, pl.slice(0, 2), 2, {}, c.name);
        placeList(s, p, pl.slice(2), F, {}, '다산');
      }
      break;
    }
    case 'AR02': produce(s, p, [['RS01', enh ? 2 : 1], ['RS02', enh ? 2 : 1]], c.name); break;
    case 'HU01': placeList(s, p, (prm.places || []).slice(0, 2), 2, { ignoreAdj: true }, c.name);
      placeList(s, p, (prm.places || []).slice(2), F, {}, '다산'); break;
    case 'HU03': startAttack(s, p, id, s.players.filter(q => q.id !== p.id).map(q => q.id), {}); break;
    default: fail('구현되지 않은 카드');
  }
  p.discard.push(id);
  checkMapAch(s);
}
function checkVictims(s, p, vs, sameTile) {
  if (sameTile && new Set(vs.map(v => v.tile)).size > 1) fail('같은 타일의 개체만 제거할 수 있습니다.');
  const need = {};
  for (const v of vs) {
    const t = s.map.tiles[v.tile];
    if (!t) fail('잘못된 타일');
    if (v.owner === p.id) fail('자기 개체는 제거할 수 없습니다.');
    if ((t.pcs[p.id] || 0) <= 0) fail('같은 타일에 자기 개체가 있어야 합니다(경쟁 배타).');
    const k = v.tile + ':' + v.owner; need[k] = (need[k] || 0) + 1;
    if ((t.pcs[v.owner] || 0) < need[k]) fail('그 타일에 상대 개체가 부족합니다.');
  }
}
function takeFromDisplay(s, id) {
  s.lineagePiles[id]--;
  if (s.lineagePiles[id] <= 0) s.display = s.display.filter(d => d.card !== id);
}

// ───────────────────────── 공격 / 방어 ─────────────────────────
export const DEFENSE_CARDS = ['ST04', 'AN03'];
function startAttack(s, p, card, targets, data) {
  const resp = {};
  for (const tid of targets) {
    const T = P(s, tid);
    if (hasSlot(T, 'ST10') && !roundUsed(s, tid, 'ST10')) {
      useRound(s, tid, 'ST10'); resp[tid] = 'auto';
      log(s, `${T.name}: 「항상성」으로 공격 무효화`);
    } else if (!T.hand.some(h => DEFENSE_CARDS.includes(h))) resp[tid] = 'pass';
    else resp[tid] = null;
  }
  s.pending = { kind: 'attack', by: p.id, card, targets, resp, data };
  log(s, `⚔ ${p.name}의 「${cname(card)}」 공격! 대상: ${targets.map(t => P(s, t).name).join(', ')}`);
  maybeResolveAttack(s);
}
function maybeResolveAttack(s) {
  const pd = s.pending;
  if (!pd || pd.kind !== 'attack') return;
  if (pd.targets.some(t => pd.resp[t] == null)) return;
  s.pending = null;
  const hit = pd.targets.filter(t => pd.resp[t] === 'pass');
  if (pd.card === 'AN04') {
    const vs = pd.data.victims.filter(v => hit.includes(v.owner));
    if (vs.length) resolveRemoval(s, pd.by, vs, '포식자');
  } else if (pd.card === 'HU03') {
    for (const t of hit) {
      if ((s.supply.VP04 || 0) <= 0) { log(s, '유해 돌연변이 공급이 바닥났습니다.'); break; }
      s.supply.VP04--; P(s, t).discard.push('VP04');
      log(s, `${P(s, t).name}: 유해 돌연변이 1장을 버림더미에 받음`);
    }
  }
  checkMapAch(s);
}

// ───────────────────────── 메인 디스패처 ─────────────────────────
export function applyAction(state, pid, a) {
  const s = clone(state);
  const p = P(s, pid);
  if (!p) fail('이 게임의 플레이어가 아닙니다.');
  if (s.phase === 'ended') fail('게임이 끝났습니다.');

  // 공격에 대한 응답 (자기 턴이 아니어도 가능)
  if (a.type === 'defend') {
    const pd = s.pending;
    if (!pd || pd.kind !== 'attack' || !pd.targets.includes(pid) || pd.resp[pid] != null) fail('응답할 공격이 없습니다.');
    if (a.card) {
      if (!DEFENSE_CARDS.includes(a.card) || !removeOne(p.hand, a.card)) fail('방어 카드가 손패에 없습니다.');
      p.discard.push(a.card); draw(s, p, 1);
      pd.resp[pid] = 'defend';
      log(s, `🛡 ${p.name}: 「${cname(a.card)}」로 공격을 무효화하고 1장 뽑음`);
    } else { pd.resp[pid] = 'pass'; log(s, `${p.name}: 방어하지 않음`); }
    maybeResolveAttack(s);
    return s;
  }

  if (s.phase === 'setup') {
    if (a.type !== 'setupPlace') fail('초기 배치 중입니다.');
    const order = s.players.length - 1 - s.setupStep;
    if (s.players[order].id !== pid) fail('지금은 다른 플레이어가 배치할 차례입니다.');
    doPlace(s, pid, a.tile, { free: true });
    log(s, `${p.name}: ${a.tile + 1}번 타일(${TERRAIN[s.map.tiles[a.tile].t].name})에 첫 개체 배치`);
    s.setupStep++;
    if (s.setupStep >= s.players.length) { s.phase = 'play'; s.turn = 0; startTurn(s); }
    return s;
  }

  if (curPlayer(s).id !== pid) fail('당신의 턴이 아닙니다.');
  if (s.pending) {
    if (s.pending.kind === 'discard' && a.type === 'discardChoice') {
      const cards = a.cards || [];
      if (cards.length !== s.pending.n) fail(`${s.pending.n}장을 골라야 합니다.`);
      for (const c of cards) { if (!removeOne(p.hand, c)) fail('손패에 없는 카드'); p.discard.push(c); }
      log(s, `${p.name}: ${cards.map(cname).join(', ')} 버림`);
      s.pending = null;
      return s;
    }
    fail(s.pending.kind === 'attack' ? '상대의 방어 응답을 기다리는 중입니다.' : '먼저 버릴 카드를 고르세요.');
  }

  const needAction = ['buy', 'use', 'evolve', 'research', 'trait'];
  if (needAction.includes(a.type) && s.actions < 1) fail('남은 행동이 없습니다. 턴을 종료하세요.');

  switch (a.type) {
    case 'buy': {
      const id = a.card, c = CARDS[id];
      if (!c || c.cost == null) fail('구매할 수 없는 카드입니다.');
      if (c.lin === 'RS' || c.lin === 'VP' || c.lin === 'ST') {
        if (!STARTER_PILES.includes(id)) fail('구매할 수 없는 카드');
        if ((s.supply[id] || 0) <= 0) fail('더미가 비었습니다.');
      } else {
        if (!s.display.some(d => d.card === id)) fail('진열대에 없는 카드입니다.');
        const why = lineageBuyable(s, p, id); if (why) fail(why);
      }
      const cost = buyCost(s, p, id);
      payMoney(s, p, cost);
      if (c.lin === 'RS' || c.lin === 'VP' || c.lin === 'ST') s.supply[id]--; else takeFromDisplay(s, id);
      p.discard.push(id); s.actions--;
      log(s, `${p.name}: 「${c.name}」 구매 (${cost})`);
      break;
    }
    case 'use': useCard(s, p, a.card, a.params || {}); break;
    case 'evolve': {
      if (!p.evoTarget) {
        const why = canTarget(p, a.target); if (why) fail(why);
        p.evoTarget = a.target;
      } else if (a.target && a.target !== p.evoTarget) fail('진행 중인 목표 노드는 개방할 때까지 바꿀 수 없습니다.');
      const req = evoReq(p, p.evoTarget);
      const dna = Math.max(0, Math.min(a.dna | 0, req.dna - p.evoProg.dna));
      const prot = Math.max(0, Math.min(a.prot | 0, req.prot - p.evoProg.prot));
      if (count(p.hand, 'RS03') < dna) fail('DNA가 부족합니다.');
      if (count(p.hand, 'RS02') < prot) fail('단백질이 부족합니다.');
      const done = p.evoProg.dna + dna >= req.dna && p.evoProg.prot + prot >= req.prot;
      if (dna + prot === 0 && !done) fail('낼 DNA 또는 단백질을 고르세요.');
      removeN(p.hand, 'RS03', dna); for (let i = 0; i < dna; i++) p.evoPaid.push('RS03');
      payProt(p, prot, p.evoPaid);
      p.evoProg.dna += dna; p.evoProg.prot += prot; s.actions--;
      log(s, `${p.name}: 「${NODES[p.evoTarget].name}」 진화에 DNA ${dna}, 단백질 ${prot} 지불 (${p.evoProg.dna}/${req.dna}, ${p.evoProg.prot}/${req.prot})`);
      if (done) openNode(s, p, p.evoTarget, a.display);
      break;
    }
    case 'research': {
      const why = researchAvail(s, p); if (why) fail(why);
      const r = RESEARCH[p.research + 1];
      payMoney(s, p, r.rna); payProt(p, r.prot, p.discard);
      p.research++; s.actions--;
      log(s, `🔬 ${p.name}: 연구 ${p.research}단계 「${r.name}」 완료`);
      break;
    }
    case 'trait': {
      const av = traitAvail(s, p); if (av.err) fail(av.err);
      if (!av.list.includes(a.trait)) fail('고를 수 없는 특성입니다.');
      payMoney(s, p, TRAIT_COST[av.stage]);
      p.traitStage = av.stage; p.traits.push(a.trait); s.traitTaken[a.trait] = p.id; s.actions--;
      log(s, `🧩 ${p.name}: 특성 발현 ${av.stage}단계 — 「${TRAITS[a.trait].name}」 획득`);
      break;
    }
    case 'nuclear': {
      if (p.research < 5) fail('핵치환 연구가 필요합니다.');
      if (s.tf.nuclear) fail('이번 턴에 이미 사용했습니다.');
      if (!p.slots.includes(a.card) || !PER_TURN.includes(a.card)) fail('매 턴 효과가 있는 장착 카드를 고르세요.');
      s.tf.nuclear = true; log(s, `${p.name}: 「핵치환」으로 「${cname(a.card)}」 한 번 더 발동`);
      perTurn(s, p, a.card);
      break;
    }
    case 'hibernate': {
      if (!hasTrait(p, 'TR04')) fail('동면 특성이 없습니다.');
      if (s.tf.hibernate) fail('이번 턴에 이미 사용했습니다.');
      if ((s.map.tiles[a.tile]?.pcs[pid] || 0) <= 0) fail('자기 개체가 있는 타일을 고르세요.');
      s.dormant[pid] = a.tile; s.tf.hibernate = true;
      log(s, `${p.name}: ${a.tile + 1}번 타일의 개체 1개를 휴면 상태로`);
      break;
    }
    case 'migrate': {
      if (!hasTrait(p, 'TR09')) fail('회유 특성이 없습니다.');
      if (s.tf.migrate) fail('이번 턴에 이미 사용했습니다.');
      const n = s.map.tiles[a.from]?.pcs[pid] || 0;
      if (n <= 0 || a.from === a.to || !s.map.tiles[a.to]) fail('잘못된 이동입니다.');
      const t = s.map.tiles[a.to];
      const others = Object.entries(t.pcs).some(([id, c]) => id !== pid && c > 0);
      if (!(hasTrait(p, 'TR07') && others) && tileTotal(t) + n > effK(s, pid, a.to)) fail('도착 타일의 환경수용력이 부족합니다.');
      subPc(s, pid, a.from, n); addPc(s, pid, a.to, n);
      if (s.dormant[pid] === a.from) s.dormant[pid] = a.to;
      s.tf.migrate = true; log(s, `${p.name}: 「회유」로 개체 ${n}개를 ${a.from + 1}→${a.to + 1}번 타일로 이동`);
      break;
    }
    case 'endTurn': endTurn(s, p, a); break;
    default: fail('알 수 없는 행동: ' + a.type);
  }
  if (s.phase !== 'ended') checkMapAch(s);
  return s;
}
