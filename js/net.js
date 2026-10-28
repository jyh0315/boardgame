// 네트워크 계층: Firebase Realtime Database (온라인) / 메모리 (한 화면 로컬 테스트)
// 게임 상태 전체를 JSON 문자열 하나로 저장 → RTDB의 빈 배열/희소 배열 문제를 피함
import { applyAction, createGame } from './engine.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';

export function getUid() {
  let id = null;
  try { id = localStorage.getItem('tol_uid'); } catch { }
  if (!id) {
    id = 'u' + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem('tol_uid', id); } catch { }
  }
  return id;
}

const randomCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');

export class FirebaseNet {
  constructor(config) { this.config = config; this.uid = getUid(); this.unsubs = []; }

  async init() {
    const app = await import(SDK + 'firebase-app.js');
    this.f = await import(SDK + 'firebase-database.js');
    this.app = app.initializeApp(this.config);
    this.db = this.f.getDatabase(this.app);
  }
  r(path) { return this.f.ref(this.db, path); }

  async createRoom(name) {
    const { get, set } = this.f;
    let code;
    for (let i = 0; i < 10; i++) {
      code = randomCode();
      if (!(await get(this.r(`rooms/${code}/info`))).exists()) break;
    }
    await set(this.r(`rooms/${code}/info`), { host: this.uid, status: 'lobby', created: Date.now() });
    await set(this.r(`rooms/${code}/players/${this.uid}`), { name, t: Date.now() });
    return code;
  }

  async joinRoom(code, name) {
    const { get, set } = this.f;
    const info = (await get(this.r(`rooms/${code}/info`))).val();
    if (!info) throw new Error('없는 방 코드입니다.');
    const me = (await get(this.r(`rooms/${code}/players/${this.uid}`))).val();
    if (info.status !== 'lobby' && !me) return { spectator: true };
    if (!me) {
      const ps = (await get(this.r(`rooms/${code}/players`))).val() || {};
      if (Object.keys(ps).length >= 6) throw new Error('방이 가득 찼습니다 (최대 6인).');
    }
    await set(this.r(`rooms/${code}/players/${this.uid}`), { name, t: me?.t || Date.now() });
    return { spectator: false };
  }

  watch(code, cb) {
    const { onValue } = this.f;
    this.stop();
    const room = { info: null, players: {}, state: null, chat: [] };
    const emit = () => cb({ ...room });
    this.unsubs.push(onValue(this.r(`rooms/${code}/info`), s => { room.info = s.val(); emit(); }));
    this.unsubs.push(onValue(this.r(`rooms/${code}/players`), s => { room.players = s.val() || {}; emit(); }));
    this.unsubs.push(onValue(this.r(`rooms/${code}/state`), s => { const v = s.val(); room.state = v ? JSON.parse(v) : null; emit(); }));
    this.unsubs.push(onValue(this.r(`rooms/${code}/chat`), s => {
      const v = s.val() || {}; room.chat = Object.values(v).sort((a, b) => a.t - b.t).slice(-80); emit();
    }));
  }
  stop() { this.unsubs.forEach(u => u()); this.unsubs = []; }

  async start(code, players) {
    const { runTransaction, update } = this.f;
    await runTransaction(this.r(`rooms/${code}/state`), cur => {
      if (cur) return undefined; // 이미 시작됨
      return JSON.stringify(createGame(players));
    });
    await update(this.r(`rooms/${code}/info`), { status: 'playing' });
  }

  async act(code, action) {
    const { runTransaction } = this.f;
    let err = null;
    await runTransaction(this.r(`rooms/${code}/state`), cur => {
      err = null;
      if (cur == null) return cur; // 로컬 캐시가 비어 있으면 서버 값으로 재시도됨
      try { return JSON.stringify(applyAction(JSON.parse(cur), this.uid, action)); }
      catch (e) { err = e; return undefined; }
    });
    if (err) throw err;
  }

  async chat(code, name, text) {
    const { push } = this.f;
    await push(this.r(`rooms/${code}/chat`), { uid: this.uid, name, text: String(text).slice(0, 300), t: Date.now() });
  }

  async leaveLobby(code) {
    const { remove } = this.f;
    await remove(this.r(`rooms/${code}/players/${this.uid}`));
  }
}

// 한 화면에서 여러 명이 번갈아 하는 로컬 테스트 모드 (Firebase 불필요)
export class LocalNet {
  constructor() { this.uid = null; this.room = null; this.cb = null; }
  async init() { }
  setup(names) {
    const players = names.map((n, i) => ({ id: 'L' + i, name: n }));
    this.room = { info: { host: 'L0', status: 'playing' }, players: {}, state: createGame(players), chat: [] };
    players.forEach(p => this.room.players[p.id] = { name: p.name, t: 0 });
    this.save();
  }
  restore() {
    try { const v = localStorage.getItem('tol_local'); if (v) { this.room = JSON.parse(v); return true; } } catch { }
    return false;
  }
  save() { try { localStorage.setItem('tol_local', JSON.stringify(this.room)); } catch { } }
  watch(code, cb) { this.cb = cb; cb({ ...this.room }); }
  stop() { this.cb = null; }
  async act(code, action, asPid) {
    this.room.state = applyAction(this.room.state, asPid, action);
    this.save();
    this.cb?.({ ...this.room });
  }
  async chat(code, name, text) { this.room.chat.push({ uid: 'L', name, text, t: Date.now() }); this.cb?.({ ...this.room }); }
}
