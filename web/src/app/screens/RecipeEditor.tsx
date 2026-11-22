import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocation } from 'wouter';
import { Icon } from '../../components/Icon';
import { toast } from '../../components/Toast';
import { Sheet } from '../../components/Sheet';
import { SyncEditor, type Timed } from '../../components/SyncEditor';
import { embedFromUrl, newRecipeId, saveRecipe, useRecipe, useSession } from '../../lib/store';
import { uploadPhoto, uploadVideo, MAX_VIDEO_MB } from '../../lib/upload';
import { embedFor } from '../../lib/api';
import { guessItem, section } from '../../lib/kitchen';
import type { Embed, Recipe, Segment } from '../../lib/types';

// Scrivere una ricetta a mano (o correggerne una importata): foto, ingredienti,
// passi e, se vuoi, un video, tuo o da TikTok/Instagram, con i passi
// sincronizzati per la Dynamic view.

type Ing = { key: string; name: string; quantity: string; emoji?: string; storeSection?: string };
type Step = Timed & { key: string; text: string; title?: string };

const key = () => crypto.randomUUID();
const emptyIng = (): Ing => ({ key: key(), name: '', quantity: '' });
const emptyStep = (): Step => ({ key: key(), text: '' });

/** Spezzoni → tempi per passo (il primo passo di ogni spezzone porta il titolo). */
function stepsFrom(recipe: Recipe): Step[] {
  const timed = new Map<number, { start: number; end: number; title?: string; first: boolean }>();
  for (const s of recipe.segments || []) {
    (s.steps || []).forEach((i, n) => timed.set(i, { start: s.start, end: s.end, title: s.title, first: n === 0 }));
  }
  return recipe.steps.map((text, i) => {
    const t = timed.get(i);
    return { key: key(), text, start: t?.start, end: t?.end, title: t?.first ? t.title : undefined };
  });
}

/** Tempi per passo → spezzoni: passi di fila con gli stessi tempi stanno nello stesso spezzone. */
function segmentsFrom(steps: Step[], ingredients: Ing[]): Segment[] | null {
  const segs: Segment[] = [];
  steps.forEach((s, i) => {
    if (s.start === undefined || s.end === undefined || s.end <= s.start) return;
    const last = segs[segs.length - 1];
    if (last && last.start === s.start && last.end === s.end && last.steps[last.steps.length - 1] === i - 1) { last.steps.push(i); return; }
    segs.push({ start: s.start, end: s.end, title: s.title || '', steps: [i], ingredients: [] });
  });
  // Ingredienti di ogni spezzone: quelli nominati nei suoi passi.
  for (const seg of segs) {
    const text = seg.steps.map((i) => steps[i].text.toLowerCase()).join(' ');
    seg.ingredients = ingredients.map((g, i) => ({ g, i }))
      .filter(({ g }) => {
        const words = g.name.toLowerCase().split(/[\s,()]+/).filter((w) => w.length > 2);
        return words.some((w) => text.includes(w.replace(/s$/, '')));
      })
      .map(({ i }) => i);
  }
  return segs.length >= 2 ? segs : null;
}

export function RecipeEditor({ id }: { id?: string }) {
  const { user } = useSession();
  const uid = user!.uid;
  const existing = useRecipe(uid, id || '__new__');
  const isNew = !id;
  const [, navigate] = useLocation();

  const [loaded, setLoaded] = useState(isNew);
  const [title, setTitle] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [servings, setServings] = useState(2);
  const [minutes, setMinutes] = useState('');
  const [cuisine, setCuisine] = useState('');
  const [ings, setIngs] = useState<Ing[]>([emptyIng(), emptyIng(), emptyIng()]);
  const [steps, setSteps] = useState<Step[]>([emptyStep(), emptyStep()]);
  const [embed, setEmbed] = useState<Embed | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [videoDirty, setVideoDirty] = useState(false);
  const [timingDirty, setTimingDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoPct, setPhotoPct] = useState<number | null>(null);
  const [videoPct, setVideoPct] = useState<number | null>(null);
  const [link, setLink] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const touch = () => setDirty(true);

  // Modifica: si parte dalla ricetta com'è.
  useEffect(() => {
    if (isNew || loaded || !existing) return;
    setTitle(existing.title || '');
    setImageUrl(existing.imageUrl || null);
    setServings(existing.servings || 2);
    setMinutes(existing.cookMinutes ? String(existing.cookMinutes) : '');
    setCuisine(existing.cuisine || '');
    setIngs(existing.ingredients.length ? existing.ingredients.map((g) => ({ key: key(), name: g.name, quantity: g.quantity || '', emoji: g.emoji, storeSection: g.storeSection })) : [emptyIng()]);
    setSteps(existing.steps.length ? stepsFrom(existing) : [emptyStep()]);
    setEmbed(existing.embed || null);
    setSourceUrl(existing.sourceUrl || null);
    setLoaded(true);
  }, [existing, isNew, loaded]);

  const timedCount = steps.filter((s) => s.text.trim() && s.start !== undefined && s.end !== undefined && s.end > s.start).length;
  const filledSteps = steps.filter((s) => s.text.trim()).length;
  const canSave = title.trim().length > 0 && (filledSteps > 0 || ings.some((g) => g.name.trim())) && photoPct === null && videoPct === null;

  const pickPhoto = async (file?: File) => {
    if (!file) return;
    setPhotoPct(0);
    try { setImageUrl(await uploadPhoto(uid, file, setPhotoPct)); touch(); } catch (e: any) { toast(e.message, 'close'); }
    setPhotoPct(null);
  };
  const pickVideo = async (file?: File) => {
    if (!file) return;
    setVideoPct(0);
    try {
      const url = await uploadVideo(uid, file, setVideoPct);
      setEmbed({ type: 'file', url }); setSourceUrl(null); setVideoDirty(true); touch();
      toast('Video ready. Now sync your steps.', 'check');
    } catch (e: any) { toast(e.message, 'close'); }
    setVideoPct(null);
  };
  const useLink = async () => {
    const url = link.trim();
    if (!url) return;
    setLinkBusy(true);
    try {
      const found = embedFromUrl(url) || (await embedFor(url)).embed;
      setEmbed(found); setSourceUrl(url); setVideoDirty(true); setLink(''); touch();
    } catch (e: any) { toast(e.message || 'Paste a TikTok or Instagram video link.', 'close'); }
    setLinkBusy(false);
  };
  const removeVideo = () => {
    setEmbed(null); setSourceUrl(null); setVideoDirty(true); setTimingDirty(true); touch();
    setSteps((s) => s.map((x) => ({ ...x, start: undefined, end: undefined })));
  };

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    const rid = id || newRecipeId();
    const cleanIngs = ings.filter((g) => g.name.trim()).map((g) => {
      const guess = guessItem(g.name);
      return { name: g.name.trim(), quantity: g.quantity.trim(), emoji: g.emoji || guess.emoji || section(guess.section).emoji, storeSection: g.storeSection || guess.section };
    });
    const cleanSteps = steps.filter((s) => s.text.trim()).map((s) => ({ ...s, text: s.text.trim() }));
    const structural = isNew || timingDirty || videoDirty || cleanSteps.length !== (existing?.steps.length || 0) || cleanIngs.length !== (existing?.ingredients.length || 0);
    const data: Partial<Recipe> = {
      title: title.trim(),
      imageUrl,
      servings,
      cookMinutes: Number(minutes) || 0,
      cuisine: cuisine.trim() || null,
      ingredients: cleanIngs,
      steps: cleanSteps.map((s) => s.text),
      ...(structural ? { segments: embed ? segmentsFrom(cleanSteps, cleanIngs.map((g) => ({ ...g, key: '' }))) : null } : {}),
      ...(isNew || videoDirty ? { embed: embed || null, sourceUrl: sourceUrl || null, platform: embed?.type === 'file' ? 'own' : embed?.type || null } as Partial<Recipe> : {}),
    };
    try {
      await saveRecipe(uid, rid, data, isNew);
      toast(isNew ? 'Recipe saved' : 'Changes saved', 'check');
      navigate(`/r/${rid}`, { replace: true });
    } catch (e: any) {
      toast(e.message || 'Could not save', 'close');
      setSaving(false);
    }
  };

  const close = () => {
    if (dirty) { setLeaving(true); return; }
    history.length > 1 ? history.back() : navigate('/');
  };

  if (!isNew && existing === undefined) return <div className="boot"><span className="spinner" /></div>;
  if (!isNew && existing === null) { navigate('/', { replace: true }); return null; }

  return (
    <main className="page editor">
      <header className="bar editor__bar">
        <button className="bar__btn" onClick={close} aria-label="Close"><Icon name="close" /></button>
        <h1 className="bar__title bar__title--center">{isNew ? 'New recipe' : 'Edit recipe'}</h1>
        <button className={`btn btn--cherry editor__save ${saving ? 'is-busy' : ''}`} disabled={!canSave} onClick={save}>Save</button>
      </header>

      {/* Foto */}
      <button className={`editor__photo ${imageUrl ? 'has-photo' : ''}`} onClick={() => photoInput.current?.click()} aria-label={imageUrl ? 'Change photo' : 'Add a photo'}>
        {imageUrl && <img src={imageUrl} alt="" />}
        <span className="editor__photo-cta">
          {photoPct !== null ? <><span className="spinner" /> {Math.round(photoPct * 100)}%</> : <><Icon name="camera" size={20} /> {imageUrl ? 'Change photo' : 'Add a photo'}</>}
        </span>
      </button>
      <input ref={photoInput} type="file" accept="image/*" hidden onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />

      {/* Titolo e dati */}
      <textarea className="editor__title" rows={1} value={title} placeholder="Recipe name" aria-label="Recipe name"
        onChange={(e) => { setTitle(e.target.value.replace(/\n/g, ' ')); touch(); }} />
      <div className="editor__facts">
        <label className="fact">
          <span>Servings</span>
          <div className="stepper">
            <button type="button" onClick={() => { setServings((s) => Math.max(1, s - 1)); touch(); }} aria-label="Fewer servings" disabled={servings <= 1}><Icon name="minus" size={15} stroke={2.6} /></button>
            <b>{servings}</b>
            <button type="button" onClick={() => { setServings((s) => Math.min(20, s + 1)); touch(); }} aria-label="More servings"><Icon name="plus" size={15} stroke={2.6} /></button>
          </div>
        </label>
        <label className="fact">
          <span>Minutes</span>
          <input inputMode="numeric" value={minutes} placeholder="30" onChange={(e) => { setMinutes(e.target.value.replace(/\D/g, '').slice(0, 4)); touch(); }} />
        </label>
        <label className="fact fact--wide">
          <span>Cuisine</span>
          <input value={cuisine} placeholder="Italian" onChange={(e) => { setCuisine(e.target.value.slice(0, 30)); touch(); }} />
        </label>
      </div>

      {/* Ingredienti */}
      <h2 className="group-label editor__label">Ingredients</h2>
      <ul className="editor__list">
        <AnimatePresence initial={false}>
          {ings.map((g, n) => (
            <motion.li key={g.key} layout className="ing-row" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
              <span className="ing-row__emoji" aria-hidden="true">{g.emoji || guessItem(g.name).emoji || '•'}</span>
              <input className="ing-row__name" data-ing={g.key} value={g.name} placeholder={n === 0 ? 'e.g. Feta cheese' : 'Ingredient'} aria-label="Ingredient"
                onChange={(e) => { const v = e.target.value; setIngs((l) => l.map((x) => (x.key === g.key ? { ...x, name: v, emoji: undefined, storeSection: undefined } : x))); touch(); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget.nextElementSibling as HTMLInputElement)?.focus(); } }} />
              <input className="ing-row__qty" value={g.quantity} placeholder={n === 0 ? '200 g' : 'Amount'} aria-label="Amount"
                onChange={(e) => { const v = e.target.value; setIngs((l) => l.map((x) => (x.key === g.key ? { ...x, quantity: v } : x))); touch(); }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const next = emptyIng();
                  setIngs((l) => { const i = l.findIndex((x) => x.key === g.key); return [...l.slice(0, i + 1), next, ...l.slice(i + 1)]; });
                  setTimeout(() => (document.querySelector(`[data-ing="${next.key}"]`) as HTMLInputElement)?.focus(), 50);
                }} />
              <button className="row-x" onClick={() => { setIngs((l) => (l.length > 1 ? l.filter((x) => x.key !== g.key) : [emptyIng()])); touch(); }} aria-label="Remove ingredient"><Icon name="close" size={15} /></button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <button className="editor__add" onClick={() => { const next = emptyIng(); setIngs((l) => [...l, next]); touch(); setTimeout(() => (document.querySelector(`[data-ing="${next.key}"]`) as HTMLInputElement)?.focus(), 60); }}>
        <Icon name="plus" size={16} stroke={2.6} /> Add ingredient
      </button>

      {/* Passi */}
      <h2 className="group-label editor__label">Steps</h2>
      <ul className="editor__list editor__list--steps">
        <AnimatePresence initial={false}>
          {steps.map((s, n) => (
            <motion.li key={s.key} layout className="step-row" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
              <span className="step-row__num">{n + 1}</span>
              <textarea value={s.text} rows={2} placeholder={n === 0 ? 'Preheat the oven to 200°C…' : 'What happens next?'} aria-label={`Step ${n + 1}`}
                data-step={s.key}
                onChange={(e) => { const v = e.target.value; setSteps((l) => l.map((x) => (x.key === s.key ? { ...x, text: v } : x))); touch(); }} />
              <button className="row-x" onClick={() => { setSteps((l) => (l.length > 1 ? l.filter((x) => x.key !== s.key) : [emptyStep()])); setTimingDirty(true); touch(); }} aria-label="Remove step"><Icon name="close" size={15} /></button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <button className="editor__add" onClick={() => { const next = emptyStep(); setSteps((l) => [...l, next]); setTimingDirty(true); touch(); setTimeout(() => (document.querySelector(`[data-step="${next.key}"]`) as HTMLTextAreaElement)?.focus(), 60); }}>
        <Icon name="plus" size={16} stroke={2.6} /> Add step
      </button>

      {/* Video e Dynamic view */}
      <h2 className="group-label editor__label">Cook-along video <em>optional</em></h2>
      <section className="video-card">
        {!embed ? (
          <>
            <p className="video-card__lead">Add a video and sync each step to its moment: in cook mode every step loops its own part of the video.</p>
            <div className="field video-card__link">
              <Icon name="link" size={17} />
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a TikTok or Instagram link" aria-label="Video link"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); useLink(); } }} />
              {link.trim() && <button className={`field__go ${linkBusy ? 'is-busy' : ''}`} onClick={useLink} aria-label="Use this link"><Icon name="check" size={16} stroke={2.8} /></button>}
            </div>
            <div className="video-card__or"><span>or</span></div>
            <button className="btn btn--soft btn--block" onClick={() => videoInput.current?.click()} disabled={videoPct !== null}>
              {videoPct !== null ? <><span className="spinner" /> Uploading {Math.round(videoPct * 100)}%</> : <><Icon name="upload" size={18} /> Upload your own video</>}
            </button>
            {videoPct !== null && <div className="meter video-card__meter"><motion.i animate={{ width: `${Math.round(videoPct * 100)}%` }} /></div>}
            <p className="video-card__hint">Up to {MAX_VIDEO_MB} MB. Only you can see it.</p>
          </>
        ) : (
          <>
            <div className="video-card__row">
              <span className="video-card__icon"><Icon name={embed.type === 'file' ? 'play' : 'link'} size={18} /></span>
              <span className="video-card__what">
                <b>{embed.type === 'file' ? 'Your video' : embed.type === 'tiktok' ? 'TikTok video' : 'Instagram reel'}</b>
                <small>{timedCount ? `${timedCount} of ${filledSteps} steps synced` : 'Steps not synced yet'}</small>
              </span>
              <button className="link-btn" onClick={removeVideo}>Remove</button>
            </div>
            <button className="btn btn--cherry btn--block" onClick={() => setSyncing(true)} disabled={!filledSteps}>
              <Icon name="refresh" size={18} /> {timedCount ? 'Edit the sync' : 'Sync steps to the video'}
            </button>
            {!filledSteps && <p className="video-card__hint">Write your steps first, then sync them.</p>}
          </>
        )}
      </section>
      <input ref={videoInput} type="file" accept="video/*" hidden onChange={(e) => { pickVideo(e.target.files?.[0]); e.target.value = ''; }} />

      <AnimatePresence>
        {syncing && embed && (
          <SyncEditor
            embed={embed}
            recipeId={id}
            steps={steps.filter((s) => s.text.trim())}
            onDone={(timed) => {
              setSteps((l) => l.map((s) => { const t = timed.find((x) => x.key === s.key); return t ? { ...s, start: t.start, end: t.end } : s; }));
              setTimingDirty(true); touch(); setSyncing(false);
            }}
            onCancel={() => setSyncing(false)}
          />
        )}
      </AnimatePresence>

      <Sheet open={leaving} onClose={() => setLeaving(false)} from={null} label="Discard changes">
        <div className="menu">
          <p className="menu__ask">Leave without saving? Your changes will be lost.</p>
          <button className="btn btn--danger btn--block" onClick={() => { setLeaving(false); history.length > 1 ? history.back() : navigate('/'); }}>Discard changes</button>
          <button className="btn btn--ghost btn--block" onClick={() => setLeaving(false)}>Keep editing</button>
        </div>
      </Sheet>
    </main>
  );
}
