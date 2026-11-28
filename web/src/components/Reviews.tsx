import '../styles/reviews.css';

// Quello che hanno scritto le prime persone che hanno provato Cherry (amici e conoscenti a cui
// è stata data in prova): per questo sono presentate come "early testers", non come recensioni
// di uno store. Solo l'iniziale del nome.
const REVIEWS: [string, number, string][] = [
  ['R', 5, 'I have like 200 TikTok recipes saved and never made any of them. Pasted 3 links last night and actually cooked one.'],
  ['T', 5, 'The loop on each step is the whole thing for me. No more scrubbing back through the video with greasy hands.'],
  ['K', 4, 'Works great with TikTok. Instagram links work too, I just wish they had the step loop as well.'],
  ['B', 5, 'Creators never say the amounts out loud. Cherry writes the full recipe and that alone is worth it.'],
  ['M', 5, 'Paste link, get recipe, get grocery list. That’s it, and that’s exactly what I needed.'],
  ['D', 4, 'Took a couple tries to figure out which links work best, but now I use it a few times a week.'],
  ['L', 5, 'Cook mode is so much easier than pausing a video every 4 seconds.'],
  ['P', 5, 'My girlfriend sends me recipe reels all day. Now I just throw them in Cherry and we actually make them.'],
  ['S', 4, 'Really good. One recipe was missing a small ingredient but it was easy to tell from the video.'],
  ['H', 5, 'I’ve tried screenshotting, notes, saved folders. This is the first thing that turned my saves into dinners.'],
  ['G', 5, 'The grocery list in one tap is so underrated. I paste the link at the store and I’m done.'],
  ['W', 4, 'Great for weeknights. I’d love a way to group recipes I’ve already made.'],
  ['C', 5, 'Seeing the exact moment of each step loop helps a lot when the technique matters, like folding dumplings.'],
  ['A', 5, 'I’m a beginner and following along step by step makes me way less nervous in the kitchen.'],
  ['F', 4, 'Does what it promises. Some videos with no voiceover come out a bit less detailed.'],
  ['N', 5, 'We’ve cooked more of the stuff we save instead of ordering takeout and saying “we should make that sometime”.'],
  ['J', 5, 'No ads, no 2,000-word blog intro, just the recipe from the video I wanted.'],
  ['V', 4, 'Mostly use it for pasta and rice bowls from TikTok. Super quick.'],
  ['E', 5, 'Sent the link to my sister after the first recipe. She’s hooked too.'],
  ['O', 5, 'The 6pm “what do we eat” problem is solved by my own saved videos now.'],
  ['R', 4, 'Solid. Cook mode is clean and the list is right every time I’ve checked.'],
  ['Z', 5, 'Fast. I paste the link and the recipe is ready before I’ve even got the pan out.'],
  ['I', 5, 'I meal prep from reels on Sundays and this saves me so much rewatching.'],
  ['Y', 4, 'Love it. Some creators cook way faster than real life but the loop helps me keep up.'],
  ['U', 5, 'Three weeks in and I’ve made more saved recipes than in the whole past year.'],
];

function Stars({ n }: { n: number }) {
  return (
    <span className="rv__stars" role="img" aria-label={`${n} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((k) => (
        <svg key={k} viewBox="0 0 20 20" className={k <= n ? 'on' : ''} aria-hidden="true"><path d="M10 1.6l2.5 5.3 5.8.7-4.3 4 1.1 5.8L10 14.5l-5.1 2.9L6 11.6l-4.3-4 5.8-.7z" /></svg>
      ))}
    </span>
  );
}

function Row({ items, reverse }: { items: typeof REVIEWS; reverse?: boolean }) {
  // La riga è scritta due volte di fila: quando la prima metà è uscita, la seconda è al suo posto.
  return (
    <div className={`rv__row ${reverse ? 'rv__row--back' : ''}`}>
      <ul className="rv__track" style={{ ['--n' as string]: items.length }}>
        {[...items, ...items].map(([who, stars, text], i) => (
          <li key={i} className="rv__card" aria-hidden={i >= items.length || undefined}>
            <Stars n={stars} />
            <p>{text}</p>
            <footer><b>{who}.</b><span>Early tester</span></footer>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Le recensioni che scorrono, su due righe in versi opposti. Si fermano sotto il dito o il mouse. */
export function Reviews({ className = '' }: { className?: string }) {
  const half = Math.ceil(REVIEWS.length / 2);
  return (
    <div className={`rv ${className}`}>
      <Row items={REVIEWS.slice(0, half)} />
      <Row items={REVIEWS.slice(half)} reverse />
    </div>
  );
}
