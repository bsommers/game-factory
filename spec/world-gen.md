# world-gen spec

Source: `templates/web-project/src/lib/world-gen.js`. Deterministic: a pure function of the rule table. **No `Math.random`/Date.**
Its RNG is the hard-coded legacy **mulberry32** `createRng` (see `spec/rng.md`); because it is not injectable without editing the lib, ports implement
that stream (verified by `rng.json` and `world-gen.json`). The spec PCG32 is NOT used here. Reference runner: `spec/reference/world-gen.mjs`.
Vectors: `spec/vectors/world-gen.json`. Numbers: f64; ints/strings exact, floats (`t`, ramp, lerp) 1e-9. Object/array **order matters** (arrays exact; compare objects by key).

## Pure helpers
`wrap(i,n)=((i%n)+n)%n` (floor-mod on ints). `circDist(a,b,n)=min(d,n-d), d=wrap(a-b,n)`. `rampOf(i,start,n)=circDist(i,start,n)/(n/2)` (f64 division).
`lerpVal(v,t)`: null -> 0; number -> v; else `a=v.from??v.base??0; return a + ((v.to??a)-a)*t + (v.perT??0)*t` (evaluate in this order).
`shuffle(arr,rng)`: Fisher-Yates `i=len-1..1, j=rng.int(0,i)`, in place. `pickWeighted(rng,items=[[v,w]...])`: `tot=sum w; r=rng.next()*tot; for [v,w]: if (r -= w) < 0 return v; return last v`.
`int(a,b)=a+floor(next*(b-a+1))`, `pick(arr)=arr[floor(next*len)]`, `chance(p)=next<p` (mulberry32 side).

## Rule table (JSON in vectors)
`{seed=1,count,start=0, blocks:{size=12,deck=['plain'],fixed={pos:tag},firstSlot}, spacing:{edgeClear=36,gap=48,step=4},
 slots:{tag:{set,place:[rule],build?}}, collectibles:{count,tiers:[{type,upTo}],exclude?,prefer?,offsets=[0,1,-1,2,-2],xRange=[30,290],xStep=10,clear=44,zoneClear=28}}`.
place rule: `{kinds:[{kind,weight=1,perT=0,minT,maxT,props}], chance=1 (lerpVal), count=1, minT, maxT, clampT, mode:'rolling'|'static', lo=0, hi=320, fixedX}`.
Function escape hatches are replaced in vectors by named fixtures (ports implement these too):
* `slots.X.build = {type:'pit', chance, w, kind='hole', lo=60, hi=260}`: `if !rng.chance(lerpVal(chance??1, t)) return; w=jsRound(lerpVal(w,t)); xs=freeXs{lo,hi}; if empty return; x0=rng.pick(xs); def.pit={kind,x0,w}; def.zones.push({x0,x1:x0+w,pit:true})`. `jsRound(x)=floor(x+0.5)`.
* `collectibles.exclude='key'` -> `def => !!def[key]`; `collectibles.prefer={every,pitKind}` -> `(def,k) => k%every===0 && def.pit?.kind===pitKind`.
* validate `crossable={maxPit}` -> `!def.pit || def.pit.w <= maxPit || "pit <w> too wide"`; `hard={tags}` -> `isHard = tag in tags`.

## blockSlots(rules,b)
`rng=createRng(seed*7+7001+b*31)` (JS number arithmetic then `>>>0` inside createRng; use u64/f64 then mod 2^32; seeds up to 2^40 are vectored). `free` = positions 0..size-1 not in `fixed`.
`cards = shuffle([deck[k % len(deck)] for k in 0..len(free)-1], rng)`; map = fixed + `free[k] -> cards[k]`. If `b==0 && firstSlot && map[0] != firstSlot`: `k = first position p in free with map[p]==firstSlot` (NOT slot index of position 0: the swap is `map[0] <-> map[k]`), if found swap. Number of blocks = `ceil(count/size)`.

## freeXs(def,rules,{edgeClear,gap,extra=[],lo=0,hi=320})
`ec,g,step` from opts/`rules.spacing`/defaults. For `x=lo+ec; x<=hi-ec; x+=step` (f64 accumulation): skip if any zone `x > z.x0-ec && x < z.x1+ec`; skip if any item with x != null and `|h.x-x| < g`; skip if any `|e-x| < g` in extra; else push. Order ascending.

## generateWorld(rules) -> {screens, collectibles}
For screen `i in 0..count-1`: `rng=createRng(seed*101+90001+i*7919)`; `t=rampOf(i,start,count)`; `tag = maps[floor(i/size)][i%size] ?? 'plain'`; `slot = slots[tag] ?? {}`;
`def={idx:i,tag,t,items:[],zones:[],collectible:null, ...deepcopy(slot.set)}` (set keys may override). `ctx={rng,t,rules,idx,n,freeXs}`. Apply each `place` rule in order, then `build`. Then if `def.pit` with `x0 != null` and no zone has `pit`: push `{x0, x1:x0+(pit.w??0), pit:true}`. Then collectibles (if any), then `finish` hook (not vectored).
applyPlace: `ch=lerpVal(chance??1,t)`; return if `minT!=null && t<minT` or `maxT!=null && t>maxT`; return if `!rng.chance(ch)` (draw happens even if ch==1; it is skipped ONLY by the minT/maxT returns before it); `tt = clampT!=null ? min(t,clampT) : t`; eligible kinds: `(minT==null || tt > k.minT) && (maxT==null || tt <= k.maxT)`, weight `(weight??1)+(perT??0)*tt`; none -> return. Repeat `count??1`: `k=pickWeighted(rng,kinds)`; rolling -> push `{kind, ...props}` (no x, no extra draw); else `xs=freeXs{lo,hi}`; empty -> **return** (abandon remaining count); push `{kind, x: fixedX ?? rng.pick(xs), ...props}` (`fixedX` skips the pick draw; props keys may override).
Key order of items: kind, x, props.

## placeCollectibles
`used={start}; rng=createRng(seed*13+555)`. For `k in 0..count-1`: `target=jsRound((k+0.5)*n/count)`; `cands = offsets.map(o=>wrap(target+o,n)).filter(i => !used.has(i) && !exclude?(screens[i]))`; if `prefer`: `pr=cands.filter(i=>prefer(screens[i],k))`, use if non-empty. `si=cands[0]` or throw. `used.add(si)`; `s.items = items with x != null` (removes rolling); `okX(x,items) = !zones.some(x>z.x0-zc && x<z.x1+zc) && !items.some(|h.x-x|<clear)`; `xs = [x for x=xlo; x<=xhi; x+=step if okX]`; if empty: `s.items=[]` and retry with no items; empty again -> throw. `picks.push({screen:si, x: rng.pick(xs)})`.
Then `picks` sorted by screen asc; `order = picks.map((p,id)=>({id,...p,d:circDist(p.screen,start,n)}))` sorted by `d` then `screen` (**stable sort**); `tier(rank) = first tier with rank < upTo, else last tier`; output `{id,type,screen,x}` sorted by id; each screen gets `collectible={id,type,x}`.

## validateWorld(world,opts) -> {ok,failures:[{screen,rule,msg}],stats:{screens,collectibles}}
Defaults `edgeClear 36, gap 48, collectClear 44`. Per screen in order: (1) `crossable` -> failure rule `crossable` unless result `=== true` (string = msg, else `'not crossable'`). (2) `st = items with x!=null sorted by x (stable)`; for k: edge (`x<ec || x>320-ec`, unless `allowEdgeItems`) msg `${kind}@${x} within ${ec} of edge`; gap (k>0 and `x-prev.x < gap`) msg `${prev.kind}/${kind} only ${d}px apart`; per zone (unless `allowItemsNearZones`) `x>z.x0-ec && x<z.x1+ec` msg `${kind}@${x} too near a zone`. (3) if collectible: for each static item `|h.x-col.x| < cc` -> `collectClear` msg `${kind} ${d}px from collectible`; `rolling` if any item has x==null and `rollingSweepsCollectible`; `collectibleReachable` optional. (4) custom `checks`.
Then `maxHardRun`+`isHard`: scan `i in 0..2n-1` over `screens[i%n]`, `run = hard ? run+1 : 0`, `worst=max`; failure `hardRun` (screen -1) if `worst > max && worst < 2n`, msg `${worst} consecutive hard screens (max ${max})`. Finally if two collectibles share `screen`: `collectibleUnique`. `ok = failures empty`. Number formatting in messages: shortest round-trip decimal (ints print without `.0`); compare msgs exactly.
`isDeterministic(rules)`: generate twice, deep-equal.

## Vector runner (`input.op`)
`helpers`, `rng {seed,n}` (mulberry32 floats), `shuffle`, `weighted`, `generate {rules,validate?}` -> `{world,deterministic,validation?}`, `validate {world,opts}` -> `{validation}`.
