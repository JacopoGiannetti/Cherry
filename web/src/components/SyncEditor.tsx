import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Icon } from './Icon';
import { VideoPlayer, type PlayerHandle } from './VideoPlayer';
import type { Embed } from '../lib/types';

// La Dynamic view fatta da te: guardi il video e segni, passo per passo,
// dove comincia e dove finisce. "Fine" segna anche l'inizio del passo dopo
// e ci passa: in un'unica visione del video la ricetta è sincronizzata.

export type Timed = { start?: number; end?: number };
type StepIn = Timed & { key: string; text: string };

const fmt = (t?: number) => {
  if (t === undefined || Number.isNaN(t)) return '–:––';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
};

export function SyncEditor({ embed, recipeId, steps, onDone, onCancel }: {
  embed: Embed; recipeId?: string; steps: StepIn[];
  onDone: (timed: (Timed & { key: string })[]) => void; onCancel: () => void;
}) {
  const [times, setTimes] = useState<Record<string, Timed>>(() => Object.fromEntries(steps.map((s) => [s.key, { start: s.start, end: s.end }])));
  const [sel, setSel] = useState(() => Math.max(0, steps.findIndex((s) => s.start === undefined || s.end === undefined)));
  const [t, setT] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [looping, setLooping] = useState(false);
  const player = useRef<PlayerHandle>(null);
  const now = useRef(0);
  const live = useRef({ sel, looping, times });
  live.current = { sel, looping, times };
  const list = useRef<HTMLOListElement>(null);

  // Il tempo arriva a ogni fotogramma: lo schermo si aggiorna 10 volte al secondo.
  useEffect(() => { const i = setInterval(() => setT(now.current), 100); return () => clearInterval(i); }, []);
  useEffect(() => { list.current?.querySelector(`[data-n="${sel}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [sel]);

  const onTime = (x: number) => {
    now.current = x;
    const { sel: i, looping: loop, times: tm } = live.current;
    const cur = tm[steps[i]?.key];
    if (loop && cur?.start !== undefined && cur?.end !== undefined && (x >= cur.end || x < cur.start - 0.5)) player.current?.seek(cur.start);
  };

  const set = (key: string, patch: Timed) => setTimes((m) => ({ ...m, [key]: { ...m[key], ...patch } }));
  const seek = (x: number) => { player.current?.seek(Math.max(0, x)); now.current = Math.max(0, x); };
  const play = () => { player.current?.play(); setPaused(false); };
  const pause = () => { player.current?.pause(); setPaused(true); };

  const select = (i: number) => {
    setSel(i); setLooping(false);
    const s = times[steps[i].key]?.start;
    if (s !== undefined) { seek(s); play(); }
  };
  const markStart = () => {
    const key = steps[sel].key;
    const end = times[key]?.end;
    set(key, { start: now.current, end: end !== undefined && end > now.current ? end : undefined });
    navigator.vibrate?.(8);
  };
  const markEnd = () => {
    const key = steps[sel].key;
    const start = times[key]?.start ?? 0;
    if (now.current <= start) return;
    set(key, { start, end: now.current });
    navigator.vibrate?.(8);
    const next = steps[sel + 1];
    if (next) {
      if (times[next.key]?.start === undefined) set(next.key, { start: now.current });
      setSel(sel + 1);
    }
  };
  const preview = () => {
    const cur = times[steps[sel].key];
    if (cur?.start === undefined || cur?.end === undefined) return;
    setLooping(true); seek(cur.start); play();
  };

  const done = steps.filter((s) => times[s.key]?.start !== undefined && times[s.key]?.end !== undefined && times[s.key].end! > times[s.key].start!).length;
  const cur = times[steps[sel]?.key] || {};

  return (
    <motion.div className="sync" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }} transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}>
      <header className="sync__top">
        <button className="icon-btn icon-btn--dark" onClick={onCancel} aria-label="Cancel"><Icon name="close" /></button>
        <div className="sync__head"><b>Sync steps</b><small>{done} of {steps.length} synced</small></div>
        <button className="btn btn--cherry sync__done" onClick={() => onDone(steps.map((s) => ({ key: s.key, ...times[s.key] })))}>Done</button>
      </header>

      <section className="cook__video sync__video">
        <VideoPlayer ref={player} embed={embed} recipeId={recipeId} onTime={onTime}
          onReady={() => { player.current?.mute(true); player.current?.play(); }}
          onEnded={() => setPaused(true)} />
        <div className="sync__clock">{fmt(t)}</div>
      </section>

      <div className="sync__transport">
        <button className="icon-btn icon-btn--dark" onClick={() => seek(now.current - 2)} aria-label="Back 2 seconds"><span className="sync__skip">−2s</span></button>
        <button className="icon-btn icon-btn--dark sync__play" onClick={() => (paused ? play() : pause())} aria-label={paused ? 'Play' : 'Pause'}>
          <Icon name={paused ? 'play' : 'pause'} fill={paused ? 'currentColor' : 'none'} />
        </button>
        <button className="icon-btn icon-btn--dark" onClick={() => seek(now.current + 2)} aria-label="Forward 2 seconds"><span className="sync__skip">+2s</span></button>
        <button className="icon-btn icon-btn--dark" onClick={() => { player.current?.mute(!muted); setMuted(!muted); }} aria-label={muted ? 'Sound on' : 'Sound off'}><Icon name={muted ? 'mute' : 'sound'} /></button>
      </div>

      <p className="sync__hint">Play the video. When <b>step {sel + 1}</b> begins tap <b>Start</b>, when it’s done tap <b>End</b>: the next step starts there.</p>

      <ol className="sync__steps" ref={list}>
        {steps.map((s, i) => {
          const tm = times[s.key] || {};
          const ok = tm.start !== undefined && tm.end !== undefined && tm.end > tm.start;
          const on = i === sel;
          return (
            <li key={s.key} data-n={i} className={`sync__step ${on ? 'is-on' : ''} ${ok ? 'is-ok' : ''}`}>
              <button className="sync__step-head" onClick={() => select(i)}>
                <span className="sync__num">{ok ? <Icon name="check" size={13} stroke={3} /> : i + 1}</span>
                <span className="sync__text">{s.text}</span>
                <span className="sync__range">{ok ? `${fmt(tm.start)} → ${fmt(tm.end)}` : tm.start !== undefined ? `${fmt(tm.start)} → …` : 'Not synced'}</span>
              </button>
              <AnimatePresence initial={false}>
                {on && (
                  <motion.div className="sync__actions" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}>
                    <div className="sync__marks">
                      <button className="sync__mark" onClick={markStart}><small>Start</small><b>{cur.start !== undefined ? fmt(cur.start) : 'Tap at the start'}</b></button>
                      <button className="sync__mark sync__mark--end" onClick={markEnd} disabled={t <= (cur.start ?? 0)}><small>End</small><b>{cur.end !== undefined ? fmt(cur.end) : 'Tap at the end'}</b></button>
                    </div>
                    <div className="sync__more">
                      <button className="link-btn" onClick={preview} disabled={!(cur.start !== undefined && cur.end !== undefined)}>
                        <Icon name="refresh" size={14} stroke={2.6} /> {looping ? 'Looping this step' : 'Loop this step'}
                      </button>
                      {(cur.start !== undefined || cur.end !== undefined) && (
                        <button className="link-btn sync__clear" onClick={() => { set(s.key, { start: undefined, end: undefined }); setLooping(false); }}>Clear</button>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ol>
    </motion.div>
  );
}
