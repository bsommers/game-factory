# hazard-kit spec

Source: `templates/web-project/src/lib/hazard-kit.js`. **No `Math.random`, no clock.** The only randomness is the optional `g.rng`
(used only by `tauntingBoss`), which is injected: ports pass a spec **PCG32** (`spec/rng.md`) and call `pick`. Reference runner:
`spec/reference/hazard-kit.mjs` (injects `pcg32(rngSeed)`). Vectors: `spec/vectors/hazard-kit.json`.
Floats are f64; compare ints/strings/bools exact, floats at 1e-9 (sin in roller hop). `%` on floats is C `fmod`; `floor` is math floor.

## Entity
`{id,kind,x=0,y=0,w=8,h=8,vx=0,t=0,frame=0,lethal=null,solidTop=false,dead=false,layer='surface', ...defaults, ...props, st:{...defaults.st, ...props.st}}`
plus pattern fields (`dir`, `open`, `speed`, `points`, `collect`, `topY`, ...). Overlay order: base < kind defaults < spawn props. `id` = registry counter starting at 1, `reset()` -> 1.
Registry: `register(kind, behaviour, defaults)`, `spawn(kind, props, g)` (error if unknown kind; calls `behaviour.init(e,g)` AFTER construction), `update(ents, dt, g)`
iterates the live list in order skipping `dead`, calling `update(e,dt,g)`. **Entities appended to `ents` during update (spawner) are visited in the same pass** (JS array iteration); ports must iterate by index against the growing length.

## Geometry
`overlaps(p,hw,hh,e) = p.x+hw > e.x-e.w/2 && p.x-hw < e.x+e.w/2 && p.y > e.y-e.h && p.y-hh < e.y` (all strict).
`solidTopUnder(ents,x,y,prevY,slack=2)`: first non-dead solidTop `e`, `top = e.topY ?? e.y-e.h`, with `|x-e.x| <= e.w/2+slack && prevY <= top+1 && y >= top`.
`solidTopCarrying(ents,x,y,slack=2)`: first non-dead solidTop with `|x-e.x| <= e.w/2+slack && |y-top| <= 3`.

## resolveContacts(registry, player, ents, opts, g) -> ordered results
`hw=(opts.hitW??8)/2, hh=opts.hitH??16, cd=opts.hitCooldown??0.6`. For each ent in order: skip dead; skip if `e.layer` truthy and `player.layer != null` and differ; skip if not overlapping;
`registry.touch` (custom `onTouch`) result overrides (`{ent,...custom}`); else `collect` -> `{type:'collect',ent}`; else `lethal==='life'` -> `{type:'kill',ent,kind}`;
else `lethal==='points'`: `last = e.st.hitT ?? -inf; now = g.time ?? e.t; if now-last >= cd { e.st.hitT = now; push {type:'points', ent, amount: e.points ?? opts.pointsPenalty ?? -100} }`.
Entities that are solidTop but not lethal are naturally skipped (not lethal/collect). (Custom `onTouch` is not vectored; ports expose it as an optional callback.)

## Behaviours (init/update); `advance(e,dx,framePx,frames)`: `st.dist += |dx|; frame = floor(st.dist/framePx) % frames`
* **patroller{w=12,h=8,speed=20,minX=0,maxX=320,lethal='life',framePx=4,frames=2}** init: set w,h,lethal,solidTop=false; `st.minX/maxX ??=` params; `dir = (e.dir===1 ? 1 : -1)`; `x=clamp(x,st.minX,st.maxX)`; `vx=dir*(e.speed??speed)`. update: `t+=dt; dx=vx*dt; x+=dx; if x<=minX {x=minX; dir=1}; if x>=maxX {x=maxX; dir=-1}; vx=dir*(e.speed??speed); advance`. (Both ifs evaluated in order.)
* **roller{w=14,h=8,speed=46,lethal='points',framePx=6,frames=4,hop=null,width=320}** init: w,h,lethal,solidTop=false; `vx=(e.dir??-1)*(e.speed??speed)`; `st.baseY=y`. update: `t+=dt; dx=vx*dt; x+=dx; if x+w/2<0 x+=width+w; if x-w/2>width x-=width+w; if hop {ph=fmod(t,hop.period); k = ph<hop.len ? sin(pi*ph/hop.len) : 0; y=baseY-hop.height*k}; advance`. (Entity `width` is the PARAM, not g.width.)
* **stationary{w=8,h=12,lethal='life',frames=3,fps=8}** init: w,h,lethal,solidTop=false,vx=0; `st.phase ??= 0`. update: `t+=dt; frame = ((floor((t+st.phase)*fps) % frames)+frames) % frames`.
* **cycler{w=22,h=10,period=2.8,openFrac=0.45,openLethal='life',closedSolid=true}** init: w,h,vx=0; `st.phase/period/openFrac ??=` params; apply. update: `t+=dt; apply`. apply: `cyc = fmod(fmod(t+phase,p)+p, p); open = cyc >= p*(1-openFrac); frame=open?1:0; e.open=open; solidTop=closedSolid&&!open; lethal=open?openLethal:null`.
* **spawner{every=4,kind,makeProps,first=null}** init: `w ??= 1; h ??= 1; st.timer = first ?? every`. update: `t+=dt; timer-=dt; while timer<=0 { timer+=every; g.spawn(kind, makeProps(e,g)) }`.
* **tauntingBoss{every=4,taunts=['HA HA!'],dur=2.5,throwKind=null,throwProps,sfx=null}** init: `st.timer ??= every; st.said=0`. update: `t+=dt; timer-=dt; if timer>0 return; timer+=every; text = g.rng ? g.rng.pick(taunts) : taunts[st.said % len]; said++; st.last=text; emit('taunt',{text,dur,ent:e}); if sfx emit('sfx',{name:sfx}); if throwKind g.spawn(throwKind, throwProps(e,g))`. Fires at most once per update (no while loop). With rng: exactly one `pick` (one u32) per taunt.
`g.emit?` / `g.spawn?` are optional (skip if absent).

## Vector runner (`input.op`)
Behaviours are declared in `kinds:{name:{pattern,params,defaults}}`; `spawner.params.props` and `tauntingBoss.params.throwProps` are static objects standing in for `makeProps`/`throwProps`.
* `sim {kinds,entities:[{kind,props}],ticks,dt,width,rngSeed?,noRng?}`: spawn all (ids 1..), frames[0] = snapshot, then each tick `registry.update(ents,dt,g)`; `g.rng = pcg32(rngSeed)` unless `noRng`; `g.spawn` spawns and appends; `g.emit` logs `{tick(1-based),name,data}` with `data.ent` replaced by the entity id. Output `{frames:[[entity snapshots]], events, count}`; snapshot = whole entity with `st` copied.
* `overlaps {cases:[{p,hw,hh,e}]}` -> `{results:[bool]}`. `contacts {kinds,entities,steps:[{time?,player}],opts}` -> `{steps:[[{type,ent:id,kind|null,amount|null}]], ents}` (g = `{time}` when time given, else `{}`).
* `solid {kinds,entities,under:[[x,y,prevY,slack?]],carrying:[[x,y,slack?]]}` -> ids or null.
