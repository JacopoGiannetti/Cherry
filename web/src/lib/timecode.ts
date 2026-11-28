// Stessa logica di backend/lib/timecode.js. Oltre il minuto, sulle ricette salvate
// prima della correzione, i tempi degli step possono essere "minuti e secondi incollati"
// (226 = 2:26). Quando il player dice quanto dura davvero il video, si rimettono a posto.
import type { Segment } from './types';

const fromMss = (v: number) => Math.floor(v / 100) * 60 + (v % 100);

export function repairSegments(segments: Segment[] | null | undefined, duration: number): Segment[] | null {
  if (!segments?.length || !(duration > 0)) return null;
  const values = segments.flatMap((s) => [s.start, s.end]).filter((v) => Number.isFinite(v));
  if (!values.some((v) => v >= 100)) return null;
  if (values.some((v) => v >= 60 && v % 100 >= 60)) return null;
  if (Math.max(...values) <= duration + 1.5) return null;
  return segments.map((s) => ({ ...s, start: fromMss(s.start), end: fromMss(s.end) }));
}
