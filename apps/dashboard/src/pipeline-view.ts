export interface Parcel {
  id: number;
  sessionId?: string;
  [k: string]: unknown;
}

/** 每段带限量;超出的进溢出料箱 */
export function splitBeltParcels<T extends { id: number }>(
  parcels: T[], max = 4,
): { visible: T[]; overflow: T[] } {
  return { visible: parcels.slice(0, max), overflow: parcels.slice(max) };
}

const PALETTE_SIZE = 6;
/** session 短号 → 稳定颜色索引(0..PALETTE_SIZE-1) */
export function sessionColor(sessionId: string): number {
  let h = 0;
  for (let i = 0; i < sessionId.length; i++) h = (h * 31 + sessionId.charCodeAt(i)) >>> 0;
  return h % PALETTE_SIZE;
}

/** 按 filter 标注每个包裹是否淡出 */
export function applyFilter<T extends Parcel>(
  parcels: T[], filter: string,
): (T & { dimmed: boolean })[] {
  return parcels.map((p) => ({ ...p, dimmed: filter !== 'all' && p.sessionId !== filter }));
}
