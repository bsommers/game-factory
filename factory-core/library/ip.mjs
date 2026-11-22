// Real-world IP tripwire: keyword scan of names, tags, descriptions and generation prompts for trademarked/copyrighted
// characters and franchises, real brands, real landmarks and map-data sources. It is a TRIPWIRE only: a hit blocks a public
// publish until a human reviews it (library.ip-review set+confirm). No hit does not mean the asset is cleared.

const L = (kind, ...words) => words.map((w) => [kind, w]);
export const IP_TERMS = [
  ...L('character', 'mario', 'luigi', 'bowser', 'pokemon', 'pikachu', 'zelda', 'sonic the hedgehog', 'pac man', 'mega man', 'kirby', 'donkey kong',
    'mickey mouse', 'minnie mouse', 'donald duck', 'elsa', 'simba', 'spider man', 'spiderman', 'iron man', 'captain america', 'hulk', 'thor', 'avengers',
    'batman', 'superman', 'wonder woman', 'aquaman', 'harley quinn', 'green lantern', 'lantern corps', 'power ring',
    'darth vader', 'star wars', 'jedi', 'stormtrooper', 'yoda', 'mandalorian', 'harry potter', 'hogwarts', 'gandalf', 'frodo', 'lord of the rings',
    'naruto', 'goku', 'dragon ball', 'one piece', 'sailor moon', 'hello kitty', 'sesame street', 'spongebob', 'teenage mutant ninja turtles', 'transformers', 'optimus prime',
    'godzilla', 'master chief', 'halo spartan', 'lara croft', 'sans undertale', 'creeper minecraft', 'among us', 'fortnite', 'minecraft', 'lego', 'barbie', 'pixar', 'disney', 'marvel', 'dc comics', 'nintendo', 'sega'),
  ...L('brand', 'nike', 'adidas', 'coca cola', 'pepsi', 'mcdonald', 'starbucks', 'apple logo', 'ferrari', 'lamborghini', 'porsche', 'tesla', 'ford mustang', 'red bull', 'playstation', 'xbox', 'ikea', 'netflix'),
  ...L('place', 'eiffel tower', 'statue of liberty', 'big ben', 'colosseum', 'white house', 'taj mahal', 'times square', 'golden gate', 'empire state', 'burj khalifa', 'sydney opera house', 'leaning tower of pisa', 'sagrada familia', 'notre dame', 'tokyo tower', 'kremlin', 'mount rushmore', 'central park'),
  ...L('map-data', 'google earth', 'google maps', 'street view', 'openstreetmap', 'osm data', 'photogrammetry of', 'real city'),
  ...L('style', 'in the style of', 'fan art', 'fanart', 'lookalike', 'look alike'),
];

const norm = (s) => ` ${String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
const TERMS = IP_TERMS.map(([kind, w]) => [kind, w, ` ${w.replace(/[^a-z0-9]+/g, ' ').trim()} `]);
// "<colour> lantern/ring ... costume" style lookalikes of trademarked costumed heroes
const COSTUME = /\b(?:lantern|spandex|caped|cape)\b.*\bcostume\b|\bcostume\b.*\b(?:lantern|spandex|caped|cape)\b/;

/** Scan free text fields. -> [{ kind, term, field }] (deduplicated) */
export function scanText(fields) {
  const hits = [], seen = new Set();
  for (const [field, value] of Object.entries(fields)) {
    if (value == null) continue;
    const text = Array.isArray(value) ? value.join(' ') : String(value), n = norm(text);
    for (const [kind, term, padded] of TERMS) if (n.includes(padded) && !seen.has(`${kind}:${term}`)) { seen.add(`${kind}:${term}`); hits.push({ kind, term, field }); }
    if (COSTUME.test(n.trim()) && !seen.has('character:costume lookalike')) { seen.add('character:costume lookalike'); hits.push({ kind: 'character', term: 'costume lookalike', field }); }
  }
  return hits;
}

/** Scan an asset descriptor (id, name, description, tags, provenance prompt/source/note). */
export function scanAsset(desc) {
  return scanText({ id: desc.id, name: desc.name, description: desc.description, tags: (desc.tags || []).map((t) => t.replace(/^[a-z]+:/, '')), 'provenance.prompt': desc.provenance?.prompt, 'provenance.source': desc.provenance?.source, 'provenance.note': desc.provenance?.note, 'provenance.sourceUrl': desc.provenance?.sourceUrl });
}
export const hitLabels = (hits) => hits.map((h) => `${h.kind}:${h.term} (${h.field})`);
