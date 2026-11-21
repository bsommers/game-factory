# platformer-physics spec

Source: `templates/web-project/src/lib/platformer-physics.js`. Fixed-step, **no RNG, no clock** (fully deterministic as written;
no seam needed). Reference runner: `spec/reference/platformer-physics.mjs`. Vectors: `spec/vectors/platformer-physics.json`.

## Numbers
All values are IEEE f64 (port in f64, not f32). Coordinates x right, **y down**; a body's `(x,y)` is its feet centre; hitbox is
`hitW` wide, `hitH` tall above y. Comparison: ints/strings/bools/null exact; floats `|a-b| <= 1e-9` (abs, or relative 1e-12 for |v|>1e6).
Transcendentals (`sin`,`cos`) may differ in the last ulp across libms: that is why 1e-9. `hypot(a,b)` may be `sqrt(a*a+b*b)` within tolerance.
`x | 0` on input dx/dy = truncate to int32 (inputs are -1/0/1).

## Config (DEFAULTS)
`gravity 520, jumpV 200, runSpeed 60, airSpeed 60, airAccel 160, climbSpeed 40, hitW 8, hitH 16, grabR 8, grabCooldown 0.35,
swingBlend 0.12, edgeL 4, edgeR 316, stride 1`. `makeConfig(over)` = DEFAULTS overlaid by `over`.
`jumpRange(cfg) = runSpeed*2*jumpV/gravity` ; `jumpHeight(cfg) = jumpV*jumpV/(2*gravity)`.
`cfg.emit(name, body, extra)` is an optional event sink; `cfg.stride` may be a number (function form is language specific, not vectored).

## Data shapes
```
Body   {x,y,vx=0,vy=0,face=1,mode='ground'|'air'|'climb'|'swing'|'dead',layer=0,onPlatform=null,landed=true,grabCd=0,swingK=0,
        offX=0,offY=0,rope=null,t=0,deathKind=null, ladder (set when climbing)}
World  {groundY, pits:[{x0,x1,kind?,deadly?,drop?}], platforms:[{id?,x,y,w,dx?,dy?}], ladders:[{x,top,bottom,w=8?}],
        ropes:[Pendulum], bounds:{minY?}, t?}
Input  {dx:-1|0|1, dy:-1|0|1 (up negative), jumpPressed:bool}
Pendulum  w = 2*pi/period; angle(t)=amp*sin(w*t); tip(t)={x:px+sin(a)*len, y:py+cos(a)*len, a}; tipVel(t): om=amp*w*cos(w*t), a=angle(t) -> {x: len*om*cos(a), y: -len*om*sin(a)}
MovingPlatform(id,x0,y0,x1=x0,y1=y0,w=24,speed=20,phase=0): span=hypot(x1-x0,y1-y0) or 1 (if 0); t=phase;
        place(): d=fmod(t*speed, 2*span); u=(d<=span ? d : 2*span-d)/span; x=x0+(x1-x0)*u; y=y0+(y1-y0)*u.
        update(dt): (ox,oy)=(x,y); t+=dt; place(); dx=x-ox; dy=y-oy.   (place() is also called once at construction; dx=dy=0)
```
`fmod` = C `fmod` (sign of dividend; Rust `%` on f64, Go `math.Mod`, Python `math.fmod` -- NOT Python `%`).

## Queries (strict/non-strict comparisons matter)
* `pitAt(world,x)`: first pit with `x > x0 && x < x1` (strict) else none.
* `ladderAt(world,x,feetY)`: first ladder with `|x-l.x| <= (l.w ?? 8)/2 && feetY >= top-1 && feetY <= bottom+1`.
* `platformUnder(x,y,prevY)`: first platform with `|x-p.x| <= p.w/2 && prevY <= p.y+1 && y >= p.y`.
* `platformCarrying(x,y)`: first platform with `|x-p.x| <= p.w/2 && |y-p.y| <= 3`.
* `supportAt(world,x,y)`: carrying platform -> `{y:p.y, platform}`; else in pit -> none; else `{y:groundY}`.
List order = array order; first match wins.

## stepBody(b, input, dt, world, cfg) order
1. `b.t += dt`; if `grabCd > 0` then `grabCd -= dt`.
2. Dispatch on `mode` (`dead`: nothing).
**ground**: (a) if ladderAt(b.x,b.y) and ((dy<0 && y > top+1) or (dy>0 && y < bottom-1)): mode climb, `x=ladder.x`, vx=vy=0, `b.ladder=l`, emit `climb`; return.
(b) if jumpPressed: `vy=-jumpV; vx=dx*airSpeed; if dx: face=dx; mode=air; onPlatform=null; landed=false`; emit `jump`; return.
(c) `vx=dx*runSpeed; if dx: face=dx; prevX=x; x+=vx*dt; carry=platformCarrying(prevX, y)` (uses PRE-move x); if carry: `x+=carry.dx??0; y+=carry.dy??0`.
`sup=supportAt(x,y)`; none -> `mode=air, vy=0, onPlatform=null`; else `y=sup.y; onPlatform = platform ? (platform.id ?? platform) : null`.
**air**: if dx: `face=dx`. `ballistic`; then if mode still air: `landed` -> mode ground, return; else `tryGrab(t = world.t ?? b.t)`.
  ballistic: `prevY=y`; if dx: `target=dx*airSpeed; a=airAccel*dt; vx = vx<target ? min(target,vx+a) : max(target,vx-a)`.
  `vy+=gravity*dt; x+=vx*dt; y+=vy*dt; landed=false; onPlatform=null`. If `bounds.minY` set and `y-hitH < minY`: `y=minY+hitH; if vy<0 vy=0`.
  If `vy>=0`: platformUnder(x,y,prevY) -> `y=p.y; vy=0; vx*=0.5; landed=true; onPlatform=p.id??p`; emit `land`(p); return.
  If `vy>=0 && y>=groundY`: pit at x -> enterPit, return; else `if vy>140 emit hardland`; `y=groundY; vy=0; landed=true`; emit `land` (no extra).
  enterPit: `drop` -> `vx=vy=0,y=groundY,landed=true`, emit `drop`(pit), mode unchanged; else `mode=dead, deathKind=q.kind??'pit', vx=vy=0, y=groundY`, emit `death`(pit). (`deadly` is documentation only; not read.)
  tryGrab: skip if `grabCd>0`; hands=(x, y-hitH); first rope with `hypot(tip.x-hx, tip.y-hy) <= grabR`: `mode=swing, rope=r, swingK=1, offX=hx-tip.x, offY=hy-tip.y, vx=vy=0`, emit `grab`(tip); stop.
**swing**: rope null -> mode air. `t=world.t ?? b.t; tip, tv`. `swingK = max(0, swingK - dt/swingBlend); x=tip.x+offX*swingK; y=tip.y+hitH+offY*swingK;`
  `if |tv.x|>12: face = tv.x>0?1:-1; vx=tv.x; vy=tv.y`. If jumpPressed: `mode=air, rope=null, grabCd=grabCooldown, landed=false`, emit `release`; return.
  Else if `y >= groundY-2 && !pitAt(x)`: `mode=ground, rope=null, y=groundY, vx=vy=0, grabCd=grabCooldown`, emit `land`.
**climb**: ladder null -> air. `if dy: y += dy*climbSpeed*dt`. `y<=top`: `y=top, mode=ground, ladder=null`, emit `climbEnd`('top'); else `y>=bottom`: same with `bottom`.

`edgeTransition(b,idx,count,cfg)`: only for mode ground/air; `dir = x<edgeL ? -1 : x>edgeR ? 1 : 0`; none -> null; else
`{dir, idx: wrapIndex(idx+dir*stride, count), x: dir>0 ? edgeL+1 : edgeR-1}`. `wrapIndex(i,n)=((i%n)+n)%n` (integer math, floor-mod). `applyTransition` sets `b.x`.

## Vector runner semantics (`input.op`)
* `ranges {cfg}` -> `{jumpRange,jumpHeight}`. `pendulum {rope,ts}` -> `{samples:[{angle,tip:{x,y,a},tipVel:{x,y}}]}`.
* `moving {platform,dt,ticks}` -> `{frames:[{x,y,dx,dy,t}]}` (frame 0 = after construction).
* `support {world,pitAt:[x],ladderAt:[[x,y]],supportAt:[[x,y]]}` -> index of match (or null) / `{y,platform:id|null}|null`. Platform entries with `moving:{...}` are built with movingPlatform (id given).
* `edge {cases:[{body:{x,mode?},idx,count,cfg?}]}` -> `{results:[{wrapIndex,tr}]}`.
* `sim {cfg,world,body:{x,y,set?},script:[{dx,dy,jp,n}],dt,ticks,useWorldT}`: per tick, in order: (1) every moving platform `.update(dt)`; (2) if `useWorldT`, `t += dt; world.t = t` (accumulated f64 sum; otherwise `world.t` is unset and `b.t` is used); (3) `stepBody`. Output `{frames:[body snapshot after each tick], events:[{tick(0-based),name,extra}]}`. Snapshot `rope`/`ladder` = index into world.ropes/ladders or null; event `extra` for platform = `{platform:id}`, pit = `{pit:index}`, ladder = `{ladder:index}`, tip = `{x,y,a}`, string as is, none = null.
