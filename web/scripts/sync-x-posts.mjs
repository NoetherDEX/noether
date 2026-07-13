// Syncs real X posts into static landing assets — run whenever POST_IDS
// changes:  node scripts/sync-x-posts.mjs
//
// Fetches each post from X's public syndication CDN (no auth, no API key),
// downloads its first photo + the account avatar into public/media/x/, and
// writes components/landing/x-posts.json. The landing renders those cards
// fully statically, so real embedded posts cost zero runtime JS.
import { writeFile, mkdir } from 'node:fs/promises';

const POST_IDS = [
  '2073508667962401010',
  '2074482481487610034',
  '2046968280154259802',
  '2044838350092472711', // @BuildOnStellar on Noether
  '2027378525645283349', // From SDEX to Soroban Perps — testnet traction
];

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';

// Same token derivation the official embed uses for the public CDN.
const tokenFor = (id) =>
  ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');

const fetchJson = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};

const download = async (url, path) => {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
};

await mkdir('public/media/x', { recursive: true });

const posts = [];
const avatarsSaved = new Set();

for (const id of POST_IDS) {
  const t = await fetchJson(
    `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${tokenFor(id)}`,
  );

  // Body text without the trailing t.co media link.
  const text = t.text
    .slice(0, t.display_text_range?.[1] ?? t.text.length)
    .replace(/(\s*https:\/\/t\.co\/\w+)+\s*$/, '')
    .trim();

  let image = null;
  const photo = t.photos?.[0];
  if (photo?.url) {
    image = `/media/x/${id}.jpg`;
    await download(`${photo.url}?name=medium`, `public${image}`);
  }

  let avatar = null;
  if (t.user?.profile_image_url_https) {
    avatar = `/media/x/avatar-${t.user.screen_name}.jpg`;
    if (!avatarsSaved.has(t.user.screen_name)) {
      await download(
        t.user.profile_image_url_https.replace('_normal', '_bigger'),
        `public${avatar}`,
      );
      avatarsSaved.add(t.user.screen_name);
    }
  }

  posts.push({
    id,
    url: `https://x.com/${t.user.screen_name}/status/${id}`,
    name: t.user.name,
    handle: `@${t.user.screen_name}`,
    text,
    dateLabel: new Date(t.created_at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
    image,
    avatar,
  });
}

await writeFile('components/landing/x-posts.json', JSON.stringify(posts, null, 2) + '\n');
console.log(`Synced ${posts.length} post(s):`);
for (const p of posts) console.log(` - ${p.id} ${p.image ?? '(no image)'} · ${p.dateLabel}`);
