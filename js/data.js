// 생명의 계통수 — 게임 데이터 (설명서 v3.2 + 카드 이미지 기준)
// tags: once=[1회], persist=[지속], attack=[공격], defense=[방어]
// terr: 강화/조건 지형 아이콘 (G 초원, W 수생태계, F 삼림, D 사막, ALL 모든 지형)

export const TERRAIN = {
  G: { name: '초원', k: 4 },
  W: { name: '수생태계', k: 3 },
  F: { name: '삼림', k: 3 },
  D: { name: '사막', k: 2 },
};

export const LINEAGES = {
  ST: '스타터', PK: '원핵생물', EK: '진핵생물', PR: '원생생물', PL: '식물',
  AN: '동물', FU: '균류', BA: '세균', AR: '고세균', HU: '인간',
};

// 진화 노드. end = 그 계통 더미가 진열될 때 종료 트랙 가산
// 베타 수정안: 진핵 2/2→1/1, 원생 3/2→2/1, 식물·동물·균류 4/3→3/2, 인간 6/4→4/3 (DNA/단백질)
export const NODES = {
  LUCA: { name: 'LUCA', pre: null, dna: 0, prot: 0, end: 0 },
  PK: { name: '원핵생물', pre: 'LUCA', dna: 1, prot: 1, end: 0 },
  EK: { name: '진핵생물', pre: 'PK', dna: 1, prot: 1, end: 0 },
  PR: { name: '원생생물', pre: 'EK', dna: 2, prot: 1, end: 0 },
  PL: { name: '식물', pre: 'PR', dna: 3, prot: 2, end: 4, top: true },
  AN: { name: '동물', pre: 'PR', dna: 3, prot: 2, end: 4, top: true },
  FU: { name: '균류', pre: 'PR', dna: 3, prot: 2, end: 4, top: true },
  BA: { name: '세균', pre: 'PK', dna: 2, prot: 2, end: 2, top: true },
  AR: { name: '고세균', pre: 'PK', dna: 2, prot: 2, end: 2, top: true },
  HU: { name: '인간', pre: 'AN', dna: 4, prot: 3, end: 4, top: true },
};
export const NODE_ORDER = ['LUCA', 'PK', 'EK', 'PR', 'PL', 'AN', 'FU', 'BA', 'AR', 'HU'];

const C = (id, name, lin, kind, cost, prot, tags, text, extra = {}) =>
  ({ id, name, lin, kind, cost, prot, tags, text, vp: 0, terr: null, star: false, ...extra });

export const CARDS = Object.fromEntries([
  // 자원
  C('RS01', 'RNA', 'RS', 'resource', 2, 0, [], '화폐 2로 사용한다.', { money: 2 }),
  C('RS02', '단백질', 'RS', 'resource', 4, 0, [], '능력 발동의 연료. 진화·연구 비용으로도 지불한다.', { vp: 1 }),
  C('RS03', 'DNA', 'RS', 'resource', 6, 0, [], '진화(계통 상승) 비용으로 지불한다.', { vp: 3 }),
  // 승점
  C('VP01', '변이', 'VP', 'vp', null, 0, [], '시작 덱에만 3장 들어간다.', { vp: 1 }),
  C('VP02', '적응', 'VP', 'vp', 5, 0, [], '승점 3', { vp: 3 }),
  C('VP03', '종분화', 'VP', 'vp', 8, 0, [], '승점 6', { vp: 6 }),
  C('VP04', '유해 돌연변이', 'VP', 'vp', null, 0, [], '공격 카드로 상대의 버림더미에 들어간다.', { vp: -1 }),
  // 스타터 능력
  C('ST01', '효소', 'ST', 'ability', 3, 0, ['once'], '추가 행동 +1. 카드 1장을 뽑는다.'),
  C('ST02', 'ATP', 'ST', 'ability', 4, 1, ['once'], '추가 행동 +2.'),
  C('ST03', '물질대사', 'ST', 'ability', 4, 0, ['once'], '단백질 카드 1장을 손패로 가져온다.'),
  C('ST04', '세포막', 'ST', 'ability', 3, 0, ['defense'], '공격 1회를 무효화하고 카드 1장을 뽑는다.'),
  C('ST05', '세포 분열', 'ST', 'ability', 4, 1, ['once'], '개체 1개를 배치한다.'),
  C('ST06', '자연 선택', 'ST', 'ability', 3, 0, ['once'], '손패 1장을 폐기 더미로 영구 제거하고 1장을 뽑는다.'),
  C('ST07', '돌연변이', 'ST', 'ability', 4, 0, ['once'], '카드 2장을 뽑고 손패 1장을 버린다.'),
  C('ST08', '확산 (이주)', 'ST', 'ability', 4, 1, ['once'], '자기 개체 1개를 임의의 타일로 옮기거나, 새로 1개 배치한다.'),
  C('ST09', '적응 방산', 'ST', 'ability', 5, 1, ['once'], '개방한 계통 덱 1종을 시장에 진열하고 개체 1개를 배치한다.'),
  C('ST10', '항상성', 'ST', 'ability', 5, 1, ['persist'], '라운드당 1회, 자신을 향한 공격을 무효화한다.'),
  // 원핵생물
  C('PK01', '이분법', 'PK', 'ability', 4, 1, ['once'], '개체 2개를 배치한다.'),
  C('PK02', '세포벽', 'PK', 'ability', 4, 0, ['persist'], '라운드당 1회, 자기 개체를 제거하는 효과를 무효화한다.'),
  C('PK03', '발효 (무산소 호흡)', 'PK', 'ability', 3, 0, ['once'], '단백질 1장을 손패로 가져온다. 「대산소화 사건」 보유자가 있으면 RNA 1장을 버린다.', { star: true }),
  // 진핵생물
  C('EK01', '세포핵', 'EK', 'ability', 5, 1, ['persist'], '매 턴 카드를 1장 더 뽑는다.'),
  C('EK02', '미토콘드리아 (세포 호흡)', 'EK', 'ability', 6, 2, ['persist'], '모든 카드의 단백질 요구량이 1 줄어든다(최소 0).'),
  C('EK03', '소포체와 골지체', 'EK', 'ability', 5, 0, ['once'], '단백질 2장을 손패로 가져온다.'),
  C('EK04', '감수 분열', 'EK', 'ability', 6, 2, ['persist'], '매 턴 카드 2장을 뽑고 1장을 버린다.', { star: true }),
  // 원생생물
  C('PR01', '섬모와 편모', 'PR', 'ability', 4, 1, ['once'], '자기 개체 2개를 인접 타일로 옮긴다.'),
  C('PR02', '식세포 작용 (포식)', 'PR', 'ability', 5, 2, ['once'], '같은 타일의 상대 개체 1개를 제거한다.'),
  C('PR03', '엽록체 (세포내 공생)', 'PR', 'ability', 6, 2, ['persist'], '매 턴 RNA 카드 1장을 손패로 가져온다.', { star: true, photo: true }),
  // 식물
  C('PL01', '광합성', 'PL', 'ability', 6, 2, ['persist'], '매 턴 RNA 1장을 얻는다. 강화: 2장.', { terr: ['G', 'F'], photo: true }),
  C('PL02', '관다발 조직', 'PL', 'ability', 6, 2, ['once'], '개체 2개를 배치한다. 강화(삼림): 3개.', { terr: ['F'] }),
  C('PL03', '질소 고정 (뿌리혹박테리아)', 'PL', 'ability', 5, 1, ['once'], '단백질 2장을 얻는다. 강화(초원): 3장.', { terr: ['G'] }),
  C('PL04', '종자와 열매', 'PL', 'ability', 7, 2, ['once'], '인접 규칙을 무시하고 개체 2개를 배치하고 카드 2장을 뽑는다.', { terr: ['G', 'F'], star: true }),
  // 동물
  C('AN01', '신경계', 'AN', 'ability', 6, 2, ['persist'], '매 턴 추가 행동 +1.', { terr: ['G', 'W'] }),
  C('AN02', '근육과 골격', 'AN', 'ability', 5, 1, ['once'], '자기 개체 2개를 옮기고 1개를 배치한다.', { terr: ['G', 'W'] }),
  C('AN03', '항체 (면역 반응)', 'AN', 'ability', 6, 1, ['defense'], '공격을 무효화하고 카드 1장을 뽑는다.'),
  C('AN04', '포식자', 'AN', 'ability', 7, 3, ['once', 'attack'], '같은 타일의 상대 개체 2개를 제거하고 단백질 1장을 얻는다.', { terr: ['G', 'W'], star: true }),
  // 균류
  C('FU01', '균사', 'FU', 'ability', 5, 1, ['once'], '자기 개체가 있는 타일과 인접한 타일에 개체를 1개씩(최대 2개) 배치한다.', { terr: ['F'] }),
  C('FU02', '분해자', 'FU', 'ability', 6, 1, ['once'], '버림더미에서 카드 1장을 손패로 가져온다. 강화(삼림): 2장.', { terr: ['F'] }),
  C('FU03', '포자', 'FU', 'ability', 5, 1, ['persist'], '자기 개체가 제거될 때 1개를 다른 타일에 재배치한다.', { terr: ['F'] }),
  C('FU04', '균근 공생', 'FU', 'ability', 7, 2, ['persist'], '매 턴 삼림 타일의 자기 개체 1개당 RNA 1장을 얻는다(최대 3장).', { terr: ['F'], star: true }),
  // 세균
  C('BA01', '빠른 증식', 'BA', 'ability', 4, 1, ['once'], '개체 3개를 배치한다. 이때 한 타일에 한해 환경수용력을 1 초과할 수 있다.'),
  C('BA02', '내생 포자', 'BA', 'ability', 4, 0, ['persist'], '라운드당 1회, 자기 개체의 제거를 무효화한다.'),
  C('BA03', '수평적 유전자 전달', 'BA', 'ability', 6, 2, ['once'], '상대가 개방한 계통 덱에서 카드 1장을 비용 없이 가져온다.', { star: true }),
  // 고세균
  C('AR01', '극한 환경 적응', 'AR', 'ability', 5, 1, ['once'], '사막 또는 수생태계 타일에 개체 2개를 배치하고, 그 타일의 환경수용력을 영구히 +1 한다.', { terr: ['D', 'W'] }),
  C('AR02', '메테인 생성', 'AR', 'ability', 5, 1, ['once'], 'RNA 1장과 단백질 1장을 얻는다. 강화: 각 2장.', { terr: ['D', 'W'] }),
  C('AR03', '호열·호염성', 'AR', 'ability', 6, 2, ['persist'], '게임 종료 시 사막 타일의 자기 개체 1개당 +2점.', { terr: ['D'], star: true }),
  // 인간
  C('HU01', '도구 사용', 'HU', 'ability', 7, 2, ['once'], '인접 규칙을 무시하고 임의의 타일에 개체 2개를 배치한다.', { terr: ['ALL'] }),
  C('HU02', '농경', 'HU', 'ability', 8, 3, ['persist'], '매 턴 RNA 2장과 단백질 1장을 얻는다.', { terr: ['ALL'] }),
  C('HU03', '돌연변이원 (환경 오염)', 'HU', 'ability', 9, 3, ['once', 'attack'], '다른 플레이어 전원의 버림더미에 「유해 돌연변이」를 1장씩 넣는다.', { terr: ['ALL'], star: true }),
].map(c => [c.id, c]));

export const STARTER_PILES = ['RS01', 'RS02', 'RS03', 'VP02', 'VP03', 'VP04',
  'ST01', 'ST02', 'ST03', 'ST04', 'ST05', 'ST06', 'ST07', 'ST08', 'ST09', 'ST10'];

// 공용 공급 수량 (2인 기준, 베타용 — 필요하면 조정). 자원·유해 돌연변이는 인원이 늘면 engine.js에서 자동 증가
export const SUPPLY = {
  RS01: 40, RS02: 34, RS03: 32, VP02: 12, VP03: 12, VP04: 12,
  ST01: 8, ST02: 8, ST03: 8, ST04: 8, ST05: 8, ST06: 8, ST07: 8, ST08: 8, ST09: 8, ST10: 8,
};
export const LINEAGE_COPIES = 4;

export const lineageCards = lin => Object.values(CARDS).filter(c => c.lin === lin).map(c => c.id);

// 특성 카드 15종
export const TRAITS = {
  TR01: { name: '보호색', tier: 1, text: '라운드당 1회, 자기 개체를 제거하는 효과 1건을 무효화한다.' },
  TR02: { name: '외골격', tier: 1, text: '자기 개체를 제거하는 모든 효과는 제거 개체 수가 1 줄어든다(최소 0).' },
  TR03: { name: '의태', tier: 1, text: '라운드당 1회, 자기 개체가 제거될 때 대신 같은 타일의 다른 플레이어 개체 1개가 제거된다.' },
  TR04: { name: '동면', tier: 1, text: '매 턴 1회, 자기 개체 1개에 휴면 표시를 한다. 그 개체는 다음 자기 턴까지 제거되지 않는다.' },
  TR05: { name: '반향정위', tier: 1, text: '개체를 배치할 때 인접 판정을 2칸까지 확장한다(인접 타일의 인접 타일에도 놓을 수 있다).' },
  TR06: { name: '비행', tier: 2, text: '개체를 배치하거나 이동시킬 때 인접 규칙을 항상 무시한다.' },
  TR07: { name: '기생', tier: 2, text: '다른 플레이어의 개체가 있는 타일에는 환경수용력을 무시하고 자기 개체를 놓을 수 있다.' },
  TR08: { name: '삼투압 조절', tier: 2, text: '수생태계·사막 타일에서는 환경수용력을 1 초과해 놓을 수 있고, 이 두 지형의 강화 조건을 계통과 무관하게 충족한 것으로 본다.' },
  TR09: { name: '회유', tier: 2, text: '매 턴 1회, 한 타일의 자기 개체 전부를 다른 한 타일로 한꺼번에 옮긴다. 인접 규칙을 무시한다.' },
  TR10: { name: '재생', tier: 3, text: '자기 개체가 제거될 때마다, 그중 1개를 즉시 임의의 타일에 다시 놓는다(횟수 제한 없음).' },
  TR11: { name: '세력권', tier: 3, text: '자기 개체가 2개 이상인 타일에는 다른 플레이어가 새 개체를 놓을 수 없다.' },
  TR12: { name: '다산', tier: 3, text: '개체를 배치하는 카드 효과를 쓸 때마다 개체 1개를 추가로 배치한다(환경수용력은 지킨다).' },
  TR13: { name: '독성', tier: 4, text: '자기 개체를 제거한 플레이어는 「유해 돌연변이」 1장을 받는다. 자기 개체가 있는 타일은 다른 플레이어에게만 환경수용력이 1 낮은 것으로 취급한다.' },
  TR14: { name: '정온성', tier: 4, text: '자기 계통의 불리 지형 제한을 무시하고, 모든 지형의 강화 조건을 충족한 것으로 본다.' },
  TR15: { name: '침입종', tier: 4, text: '상대 개체를 제거할 때마다, 비워진 자리에 자기 개체 1개를 즉시 놓는다.' },
};
export const TRAIT_COST = [0, 3, 5, 7, 9];
export const TRAIT_SCORE = [0, 1, 3, 6, 10];

export const RESEARCH = [
  null,
  { name: '제한 효소', rna: 3, prot: 1, text: '정리 단계에 손패 1장을 영구 제거할 수 있다.' },
  { name: '중합효소 연쇄 반응(PCR)', rna: 4, prot: 1, text: '매 턴 RNA 1장을 화폐가 4로 계산한다.' },
  { name: '유전자 재조합', rna: 5, prot: 2, text: '상대가 개방한 계통 덱에서도 구매 가능, ★ 제한 무시.' },
  { name: '조직 배양', rna: 5, prot: 2, text: '매 턴 정리 단계에 개체 1개를 무료로 배치한다.' },
  { name: '핵치환(생물 복제)', rna: 6, prot: 3, text: '매 턴 [지속] 카드 1장을 복사해 한 번 더 발동한다.' },
];

export const ACHIEVEMENTS = {
  A1: { name: 'DNA의 등장', cond: '원핵생물 노드 최초 개방', pts: 3, eff: '이후 모든 진화 비용에서 DNA 1 할인' },
  A2: { name: '세포내 공생', cond: '진핵생물 노드 최초 개방', pts: 3, eff: '능력 슬롯 +1' },
  A3: { name: '대산소화 사건', cond: '광합성 계열 [지속] 카드 최초 장착', pts: 5, eff: '「발효」를 쓰는 상대는 자원 1을 잃는다' },
  A4: { name: '다세포화', cond: '능력 슬롯에 카드 3장 최초 장착', pts: 4, eff: '자원 생산 카드의 산출량 +1' },
  A5: { name: '유성생식의 등장', cond: '「감수 분열」 카드 최초 사용', pts: 2, eff: '매 턴 1장 더 뽑고 1장 버린다' },
  A6: { name: '육상 진출', cond: '초원·삼림·사막 세 지형에 동시에 개체를 놓은 최초', pts: 4, eff: '육상 타일의 자기 개체는 종료 시 개당 +1점' },
  A7: { name: '적응 방산', cond: '서로 다른 5개 타일에 개체를 놓은 최초', pts: 5, eff: '개체 배치 시 인접 규칙 무시' },
  A8: { name: '종분화', cond: '최상위 계통(식물·동물·균류·세균·고세균) 최초 개방', pts: 5, eff: '자기 계통 카드 구매 비용 1 할인' },
  A9: { name: '사람의 출현', cond: '인간 노드 개방', pts: 10, eff: '종료 시 자기 개체 1개당 +1점' },
};

export const PLAYER_COLORS = ['#e53935', '#1e5bd8', '#8e24aa', '#f57c00', '#37474f', '#00897b'];
export const COLOR_NAMES = ['빨강', '파랑', '보라', '주황', '회색', '청록'];
export const MARKERS = 25;
export const MAP_LAYOUT = { 2: 4, 3: 5, 4: 6, 5: 5, 6: 6 }; // 열 수 (행은 3 또는 4)
