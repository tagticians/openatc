import { useEffect, useMemo, useRef, useState } from 'react';

export interface PaletteAction {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

interface Props {
  open: boolean;
  actions: PaletteAction[];
  onClose: () => void;
}

const score = (a: PaletteAction, q: string) => {
  if (!q) return 1;
  const hay = `${a.label} ${a.group} ${a.keywords ?? ''}`.toLowerCase();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.every((w) => hay.includes(w))) return 0;
  return a.label.toLowerCase().startsWith(words[0]) ? 3 : 2;
};

/** ⌘K / Ctrl+K command palette. The game pauses while it is open. */
export function CommandPalette({ open, actions, onClose }: Props) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const shown = useMemo(
    () =>
      actions
        .map((a) => ({ a, s: score(a, q) }))
        .filter((x) => x.s > 0)
        .sort((x, y) => y.s - x.s)
        .map((x) => x.a)
        .slice(0, 60),
    [actions, q],
  );

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${idx}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  if (!open) return null;

  const pick = (a: PaletteAction | undefined) => {
    if (!a) return;
    onClose();
    a.run();
  };

  let lastGroup = '';
  return (
    <div className="overlay palette-overlay" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-search">
          <span className="palette-k">⌘K</span>
          <input
            ref={input}
            autoFocus
            value={q}
            placeholder="Search commands or a callsign… (simulation paused)"
            spellCheck={false}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIdx((i) => Math.min(shown.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIdx((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                pick(shown[idx]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
          />
          <span className="palette-paused">PAUSED</span>
        </div>
        <div className="palette-list" ref={list}>
          {shown.length === 0 && <div className="palette-empty">No command matches “{q}”.</div>}
          {shown.map((a, i) => {
            const header = q ? null : a.group !== lastGroup ? a.group : null;
            lastGroup = a.group;
            return (
              <div key={a.id}>
                {header && <div className="palette-group">{header}</div>}
                <button
                  type="button"
                  data-i={i}
                  className={`palette-item ${i === idx ? 'on' : ''}`}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => pick(a)}
                >
                  <span>{a.label}</span>
                  {q && <em>{a.group}</em>}
                  {a.hint && <kbd>{a.hint}</kbd>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
