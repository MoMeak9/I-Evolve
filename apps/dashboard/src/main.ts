import { MonitorClient } from './sse-client.js';
import type { MonitorEvent, MonitorSnapshot, MonitorStats } from './types.js';
import { applyFilter, sessionColor, splitBeltParcels } from './pipeline-view.js';

const STAGE_TC: Record<string, [string, string]> = {
  observe: ['#1f3a5f', '#79c0ff'],
  think: ['#3a2f5f', '#d2a8ff'],
  judge: ['#5f4a1f', '#e3b341'],
  store: ['#1f5f2f', '#7ee787'],
  sync: ['#30363d', '#b1bac4'],
  system: ['#30363d', '#b1bac4'],
  reject: ['#5f1f22', '#ff7b72'],
};

interface ActiveParcel { id: number; sessionId: string; el: HTMLDivElement; }
interface RejectedItem { reason: string; slug: string; sid: string; time: string; det: Record<string, unknown>; }

const stats: MonitorStats = { observations: 0, candidates: 0, accepted: 0, rejected: 0, memories: 0, wasted: 0 };
let filter = 'all';
let evTotal = 0;
let pidc = 0;
const rejectedItems: RejectedItem[] = [];
const sessions = new Map<string, number>();
const sourceCounts = new Map<string, number>(); // 每个来源已分配的序号,用于「Claude Code 1/2」
const SOURCE_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  cli: 'CLI',
  mcp: 'MCP',
};
const active: ActiveParcel[] = [];
const SEG = 2600;
const MAX_BELT = 4;
const anchors = { observe: 0, think: 0.34, judge: 0.66, mem: 1.0 };

function init(host: HTMLElement): void {
  host.innerHTML = `
    <div class="topbar">
      <span class="brand">◆ I-EVOLVE</span>
      <span class="session-label"><span class="status-dot off" id="statusDot"></span><span id="statusText">连接中…</span></span>
      <div class="stats">
        <div class="stat"><div class="num" id="s-obs">0</div><div class="lbl">观测</div></div>
        <div class="stat"><div class="num" id="s-cand">0</div><div class="lbl">候选</div></div>
        <div class="stat accept"><div class="num" id="s-acc">0</div><div class="lbl">通过</div></div>
        <div class="stat reject"><div class="num" id="s-rej">0</div><div class="lbl">拒绝</div></div>
        <div class="stat mem"><div class="num" id="s-mem">0</div><div class="lbl">记忆</div></div>
      </div>
    </div>
    <div class="chipbar" id="chipbar">
      <span class="cap">Session 筛选</span>
      <div class="chip all on" data-sid="all"><span class="d"></span>全部</div>
    </div>
    <div class="main">
      <div class="stage" id="stage"><svg id="track"></svg></div>
      <div class="events">
        <header><span class="live"></span> 事件流 LIVE <span class="count" id="evCount">0 events</span></header>
        <div class="list" id="evList"></div>
      </div>
    </div>
    <div class="modal-bg" id="modalBg"><div class="modal" id="modalCard"></div></div>
    <div class="demo-note">◆ S型盘绕传送带 · 实时 SSE · 点击包裹/事件/🗑️废料箱查看详情</div>
  `;
  wire();
}
const $ = (id: string) => document.getElementById(id);
const now = () => new Date().toTimeString().slice(0, 8);

let PATH: SVGPathElement | null = null;
let PLEN = 0;

function wire(): void {
  buildPath();
  window.addEventListener('resize', buildPath);

  const modalBg = $('modalBg');
  modalBg?.addEventListener('click', (e) => { if (e.target === modalBg) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  $('chipbar')?.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest?.('.chip') as HTMLElement | null;
    if (chip) filterSession(chip.dataset.sid ?? 'all', chip);
  });

  const client = new MonitorClient('');
  client.start({
    onStatus: setStatus,
    onSnapshot: applySnapshot,
    onEvent: handleEvent,
  });
  refreshStats();
}

function setStatus(connected: boolean): void {
  const dot = $('statusDot');
  const text = $('statusText');
  if (dot) dot.className = 'status-dot' + (connected ? '' : ' off');
  if (text) text.textContent = connected
    ? `daemon running · ${sessions.size} active sessions`
    : '等待 daemon…';
}

// ---- 构建 S 型路径 ----
function buildPath(): void {
  const stage = $('stage');
  const svg = $('track') as unknown as SVGSVGElement | null;
  if (!stage || !svg) return;
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const mx = 120, top = 90, midY = H / 2, botY = H - 110;
  const d = `M ${mx} ${top} L ${W - mx} ${top} Q ${W - mx + 50} ${top} ${W - mx + 50} ${(top + midY) / 2} Q ${W - mx + 50} ${midY} ${W - mx} ${midY} L ${mx} ${midY} Q ${mx - 50} ${midY} ${mx - 50} ${(midY + botY) / 2} Q ${mx - 50} ${botY} ${mx} ${botY} L ${W - mx} ${botY}`;
  svg.innerHTML = `
    <path d="${d}" fill="none" stroke="#1c2532" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${d}" fill="none" stroke="#2a3444" stroke-width="30" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 22" opacity=".6">
      <animate attributeName="stroke-dashoffset" from="24" to="0" dur="1s" repeatCount="indefinite"/>
    </path>
    <path id="thepath" d="${d}" fill="none" stroke="none"/>`;
  PATH = svg.querySelector('#thepath');
  PLEN = PATH ? PATH.getTotalLength() : 0;
  placeStations(stage, { mx, top, midY, botY });
}

function placeStations(stage: HTMLElement, g: { mx: number; top: number; midY: number; botY: number }): void {
  stage.querySelectorAll('.station,.waste').forEach((e) => e.remove());
  const mk = (x: number, y: number, icon: string, name: string, sub: string, id: string, badge?: number) => {
    const el = document.createElement('div');
    el.className = 'station';
    el.id = id;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.innerHTML = `<div class="icon">${icon}${badge != null ? `<span class="badge" id="${id}-b">${badge}</span>` : ''}</div><div class="name">${name}</div><div class="sub">${sub}</div>`;
    stage.appendChild(el);
  };
  const W = stage.clientWidth;
  mk(g.mx, g.top, '📥', '观测站', 'observation', 'st-observe');
  mk(W - g.mx, g.midY, '⚙️', '思考站', 'extract', 'st-think');
  mk(g.mx, g.midY, '🚦', '准入闸门', 'judge', 'st-judge');
  mk(W - g.mx, g.botY, '🏛️', '记忆库', 'memory', 'st-mem', stats.memories);
  const w = document.createElement('div');
  w.className = 'waste';
  w.id = 'waste';
  w.style.left = g.mx + 'px';
  w.style.top = (g.midY + 70) + 'px';
  w.innerHTML = `<span class="bin" id="wasteBin">🗑️</span><span class="lbl">废料箱 · <span id="wasteCount">${stats.wasted}</span></span>`;
  w.onclick = openWaste;
  stage.appendChild(w);
}

function ptAt(frac: number): { x: number; y: number } {
  if (!PATH || PLEN === 0) return { x: 0, y: 0 };
  return PATH.getPointAtLength(PLEN * Math.max(0, Math.min(1, frac)));
}
function flashStation(id: string): void {
  const el = $(id);
  if (!el) return;
  el.classList.add('active');
  setTimeout(() => el.classList.remove('active'), 1000);
}

function bumpBadge(): void {
  const b = $('st-mem-b');
  if (!b) return;
  b.textContent = String(stats.memories);
  b.classList.add('bump');
  setTimeout(() => b.classList.remove('bump'), 400);
}

function refreshStats(): void {
  const set = (id: string, v: number) => { const el = $(id); if (el) el.textContent = String(v); };
  set('s-obs', stats.observations);
  set('s-cand', stats.candidates);
  set('s-acc', stats.accepted);
  set('s-rej', stats.rejected);
  set('s-mem', stats.memories);
  const wc = $('wasteCount');
  if (wc) wc.textContent = String(stats.wasted);
}

function movePar(el: HTMLElement, fromFrac: number, toFrac: number, dur: number): void {
  const start = performance.now();
  function step(t: number): void {
    const k = Math.min(1, (t - start) / dur);
    const ease = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const f = fromFrac + (toFrac - fromFrac) * ease;
    const p = ptAt(f);
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

interface SpawnOpts {
  sessionId: string;
  label: string;
  reject?: boolean;
  data: ModalData;
  fromFrac: number;
  toFrac: number;
  dur: number;
}

function spawnParcel(o: SpawnOpts): HTMLDivElement {
  const stage = $('stage')!;
  const id = pidc++;
  const cls = o.reject ? 'reject' : 'c' + sessionColor(o.sessionId);
  const el = document.createElement('div');
  el.className = 'parcel ' + cls;
  if (filter !== 'all' && o.sessionId !== filter) el.classList.add('dim');
  el.innerHTML = (o.reject ? '✕ ' : '') + esc(o.label) + ` <span class="sid">${esc(o.sessionId)}</span>`;
  el.onclick = () => openModal(o.data);
  const p0 = ptAt(o.fromFrac);
  el.style.left = p0.x + 'px';
  el.style.top = p0.y + 'px';
  stage.appendChild(el);
  movePar(el, o.fromFrac, o.toFrac, o.dur);

  active.push({ id, sessionId: o.sessionId, el });
  enforceBeltLimit();

  setTimeout(() => {
    el.remove();
    const i = active.findIndex((a) => a.id === id);
    if (i >= 0) active.splice(i, 1);
  }, o.dur + 200);
  return el;
}

// 传送带限量:超出 MAX_BELT 的最早包裹折叠(溢出料箱语义 → 视觉上淡出压缩)
function enforceBeltLimit(): void {
  const { overflow } = splitBeltParcels(active, MAX_BELT);
  active.forEach((a) => a.el.classList.remove('overflow'));
  overflow.forEach((a) => a.el.classList.add('overflow'));
}
function addEvent(stageC: string, type: string, msg: string, detail?: Record<string, unknown> | null, ts?: string): void {
  evTotal++;
  const list = $('evList');
  if (!list) return;
  const ev = document.createElement('div');
  ev.className = 'ev ' + stageC;
  ev.onclick = () => ev.classList.toggle('open');
  const dt = detail
    ? `<div class="detail">${Object.entries(detail).map(([k, v]) => `${esc(k)}: ${esc(fmt(v))}`).join('<br>')}</div>`
    : '';
  const time = ts ? new Date(ts).toTimeString().slice(0, 8) : now();
  ev.innerHTML = `<div class="row1"><span class="tag">${esc(stageC)}</span><span>${esc(type)}</span><span class="time">${esc(time)}</span></div><div class="msg">${esc(msg)}</div>${dt}`;
  list.insertBefore(ev, list.firstChild);
  while (list.children.length > 40) list.removeChild(list.lastChild!);
  const c = $('evCount');
  if (c) c.textContent = evTotal + ' events';
}

interface ModalData {
  tag: string;
  tc: [string, string];
  title: string;
  big: string;
  kv: Record<string, unknown>;
}

function openModal(d: ModalData): void {
  const c = $('modalCard');
  if (!c) return;
  c.innerHTML = `<div class="mhead"><span class="tag" style="background:${d.tc[0]};color:${d.tc[1]}">${esc(d.tag)}</span><b style="font-size:13px">${esc(d.title)}</b><span class="x" id="modalX">✕</span></div><div class="mbody"><div class="big">${esc(d.big)}</div><div class="kv">${Object.entries(d.kv).map(([k, v]) => `<span class="k">${esc(k)}</span><span class="v">${esc(fmt(v))}</span>`).join('')}</div></div>`;
  $('modalX')?.addEventListener('click', closeModal);
  $('modalBg')?.classList.add('show');
}

function openWaste(): void {
  const c = $('modalCard');
  if (!c) return;
  const rows = rejectedItems.length
    ? rejectedItems.slice().reverse().map((it) => `<div class="rejrow"><div class="rr-top"><span class="rr-reason">✕ ${esc(it.reason)}</span><span class="rr-sid">${esc(it.sid)} · ${esc(it.time)}</span></div><div class="rr-det">${esc(it.slug)} — ${Object.entries(it.det).map(([k, v]) => `${esc(k)}:${esc(fmt(v))}`).join(', ')}</div></div>`).join('')
    : '<p style="color:#6e7681;font-size:12px">暂无被拒记录</p>';
  c.innerHTML = `<div class="mhead"><span class="tag" style="background:#5f1f22;color:#ff7b72">waste</span><b style="font-size:13px">🗑️ 废料箱 · 被拒绝的 ${rejectedItems.length} 条</b><span class="x" id="modalX">✕</span></div><div class="mbody">${rows}</div>`;
  $('modalX')?.addEventListener('click', closeModal);
  $('modalBg')?.classList.add('show');
}

function closeModal(): void {
  $('modalBg')?.classList.remove('show');
}

function filterSession(sid: string, el: HTMLElement): void {
  filter = sid;
  document.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
  el.classList.add('on');
  const marked = applyFilter(active.map((a) => ({ id: a.id, sessionId: a.sessionId, el: a.el })), filter);
  marked.forEach((m) => {
    (m.el as HTMLElement).classList.toggle('dim', m.dimmed);
  });
}

function ensureSessionChip(sid?: string, source?: unknown): void {
  if (!sid) return;
  const bar = $('chipbar');
  if (!bar) return;
  const src = typeof source === 'string' && SOURCE_LABELS[source] ? source : undefined;

  // 新会话:建 chip,颜色与出现顺序固定
  if (!sessions.has(sid)) {
    const idx = sessionColor(sid);
    sessions.set(sid, idx);
    const chip = document.createElement('div');
    chip.className = `chip c${idx}`;
    chip.dataset.sid = sid;
    chip.title = sid; // 完整 id 保留在 tooltip,便于和日志对应
    bar.appendChild(chip);
    setStatus(true);
  }

  // 命名:有来源则用「Claude Code N」(同源递增),否则临时「会话 N」;
  // 已按来源命名过的不再降级。
  const chip = findChip(sid);
  if (!chip) return;
  if (chip.dataset.named === 'source') return;
  let label: string;
  if (src) {
    const n = (sourceCounts.get(src) ?? 0) + 1;
    sourceCounts.set(src, n);
    label = `${SOURCE_LABELS[src]} ${n}`;
    chip.dataset.named = 'source';
  } else {
    label = `会话 ${sessions.size}`;
  }
  chip.innerHTML = `<span class="d"></span>${esc(label)}`;
}

function findChip(sid: string): HTMLElement | null {
  const bar = $('chipbar');
  if (!bar) return null;
  return Array.from(bar.querySelectorAll('.chip')).find((c) => (c as HTMLElement).dataset.sid === sid) as HTMLElement | null;
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmt(v: unknown): string {
  if (v == null) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}
function applySnapshot(snap: MonitorSnapshot): void {
  if (snap.stats) Object.assign(stats, snap.stats);
  refreshStats();
  const b = $('st-mem-b');
  if (b) b.textContent = String(stats.memories);
  // 预填充事件流(快照按 id 升序;最新在列表顶部,与实时插入一致)
  const evs = [...(snap.events ?? [])].sort((a, b2) => a.id - b2.id);
  for (const e of evs) {
    ensureSessionChip(e.sessionId, e.detail?.source);
    appendEventEntry(e);
  }
}

// 事件流条目(不含流水线动画,用于快照回放与所有事件的完整账本)
function appendEventEntry(e: MonitorEvent): void {
  const stageC = e.type.includes('reject') || e.detail?.decision === 'reject' ? 'reject' : e.stage;
  addEvent(stageC, e.type, e.summary, e.detail ?? null, e.ts);
}

function modalFor(e: MonitorEvent, tagStage: string, title: string): ModalData {
  const tc = STAGE_TC[tagStage] ?? STAGE_TC.system;
  return { tag: tagStage, tc, title, big: e.summary, kv: e.detail ?? { stage: e.stage, type: e.type } };
}

// ---- 核心:单一入口,按 stage/type 映射到流水线动作 ----
function handleEvent(e: MonitorEvent): void {
  setStatus(true);
  ensureSessionChip(e.sessionId, e.detail?.source);
  const sid = e.sessionId ?? '----';

  switch (e.type) {
    case 'observation.received': {
      stats.observations++;
      refreshStats();
      flashStation('st-observe');
      spawnParcel({
        sessionId: sid, label: '📦 obs', fromFrac: anchors.observe, toFrac: anchors.think, dur: SEG,
        data: modalFor(e, 'observe', '📦 观测 · observation.received'),
      });
      break;
    }
    case 'extract.candidate': {
      stats.candidates++;
      refreshStats();
      flashStation('st-think');
      const slug = String(e.detail?.slug ?? 'candidate');
      spawnParcel({
        sessionId: sid, label: '💡 ' + slug, fromFrac: anchors.think, toFrac: anchors.judge, dur: SEG,
        data: modalFor(e, 'think', '💡 候选记忆 · extract.candidate'),
      });
      break;
    }
    case 'judge.result': {
      if (e.detail?.decision === 'reject') {
        stats.rejected++;
        stats.wasted++;
        refreshStats();
        const bin = $('wasteBin');
        if (bin) { bin.classList.add('shake'); setTimeout(() => bin.classList.remove('shake'), 300); }
        const reason = String(e.detail?.reason ?? 'rejected');
        const slug = String(e.detail?.slug ?? 'candidate');
        const { decision: _d, reason: _r, slug: _s, ...det } = e.detail ?? {};
        rejectedItems.push({ reason, slug, sid, time: now(), det: det as Record<string, unknown> });
        dropToWaste(sid, reason, modalFor(e, 'reject', '✕ 准入拒绝 · judge.result'));
      } else {
        stats.accepted++;
        refreshStats();
        flashStation('st-judge');
        const slug = String(e.detail?.slug ?? 'candidate');
        spawnParcel({
          sessionId: sid, label: '✓ ' + slug, fromFrac: anchors.judge, toFrac: anchors.mem, dur: SEG,
          data: modalFor(e, 'store', '✓ 落库 · ' + slug),
        });
      }
      break;
    }
    case 'memory.created':
    case 'candidate.promoted': {
      stats.memories++;
      refreshStats();
      flashStation('st-mem');
      bumpBadge();
      break;
    }
    case 'judge.start':
      flashStation('st-judge');
      break;
    case 'extract.start':
      flashStation('st-think');
      break;
    default:
      // session.*, autopush.*, pipeline.error, warning, memory.forgotten/rolledback:
      // 仅进入事件流(完整账本),不生成传送带包裹
      break;
  }
  appendEventEntry(e);
}

function dropToWaste(sid: string, reason: string, data: ModalData): void {
  const stage = $('stage');
  const wp = $('waste');
  if (!stage || !wp) return;
  const el = document.createElement('div');
  el.className = 'parcel reject';
  if (filter !== 'all' && sid !== filter) el.classList.add('dim');
  el.innerHTML = '✕ ' + esc(reason) + ` <span class="sid">${esc(sid)}</span>`;
  el.onclick = () => openModal(data);
  const p0 = ptAt(anchors.judge);
  el.style.left = p0.x + 'px';
  el.style.top = p0.y + 'px';
  stage.appendChild(el);
  const tx = parseFloat(wp.style.left);
  const ty = parseFloat(wp.style.top);
  const start = performance.now();
  (function drop(t: number): void {
    const k = Math.min(1, (t - start) / 900);
    el.style.left = (p0.x + (tx - p0.x) * k) + 'px';
    el.style.top = (p0.y + (ty - p0.y) * k * k) + 'px';
    el.style.opacity = String(1 - k * 0.7);
    if (k < 1) requestAnimationFrame(drop);
  })(start);
  setTimeout(() => el.remove(), 1100);
}

// Bootstrap runs last so all const helpers ($, now, esc, fmt, PATH, ...) are
// initialized before init() → wire() → buildPath() call them (avoid TDZ crash).
const root = document.getElementById('root');
if (root) init(root);

