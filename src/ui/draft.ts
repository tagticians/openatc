// The transmission being composed: clicked chips and dragged vectors collect here, one per
// kind of instruction, until the controller presses Enter (or Transmit). The command line
// shows the same text, so typing and clicking build one message.
import { useSyncExternalStore } from 'react';

let text = '';
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** What a token instructs; a new token replaces an earlier one of the same kind. */
export function kindOf(tok: string): string {
  const t = tok.toUpperCase();
  if (/^([HLR]\d{1,3}|FH|PH|D[A-Z]{2,5}|D[A-Z]{2}\d{3}|DCT|HOLD|HLD|RES|OWN)$/.test(t)) return 'lateral';
  if (/^[CDA]\d{2,3}$/.test(t)) return 'vertical';
  if (/^(S\d{1,3}|SR)$/.test(t)) return 'speed';
  if (/^(ILS|APP|CA)(\d{2}[LCR]?)?$/.test(t)) return 'approach';
  if (t === 'EXP') return 'expedite';
  if (/^(CL|CTL|LAND)$/.test(t)) return 'landing';
  if (/^(HO|CONTACT)$/.test(t)) return 'handoff';
  return t;
}

export const draft = {
  get: () => text,
  set(v: string) {
    if (v === text) return;
    text = v;
    emit();
  },
  clear() {
    draft.set('');
  },
  /** Words of the draft, with "DCT FIX" kept as one instruction. */
  tokens(): string[] {
    const w = text.trim().toUpperCase().split(/[\s,]+/).filter(Boolean);
    const out: string[] = [];
    for (let i = 0; i < w.length; i++) {
      if ((w[i] === 'DCT' || w[i] === 'HOLD') && w[i + 1]) out.push(`${w[i]} ${w[++i]}`);
      else out.push(w[i]);
    }
    return out;
  },
  /** Add an instruction, replacing any earlier one of the same kind. Toggle EXP. */
  stage(tok: string) {
    const k = kindOf(tok.split(' ')[0] === 'DCT' ? 'DCT' : tok.split(' ')[0]);
    const cur = draft.tokens();
    const had = cur.some((t) => t.toUpperCase() === tok.toUpperCase());
    const kept = cur.filter((t) => kindOf(t.split(' ')[0]) !== k);
    draft.set([...kept, ...(had && k === 'expedite' ? [] : [tok])].join(' '));
  },
  has: (tok: string) => draft.tokens().some((t) => t.toUpperCase() === tok.toUpperCase()),
  subscribe(f: () => void) {
    subs.add(f);
    return () => subs.delete(f);
  },
};

export const useDraft = () => useSyncExternalStore(draft.subscribe, draft.get);
