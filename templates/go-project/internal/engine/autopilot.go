package engine

import (
	"fmt"
	"math"
)

// BotInput is one tick of bot intent (same shape as the JS {dx,dy,jump,jumpPressed}).
type BotInput struct {
	DX          int  `json:"dx"`
	DY          int  `json:"dy"`
	Jump        bool `json:"jump"`
	JumpPressed bool `json:"jumpPressed"`
}

// NewBotInput builds an input; jump sets both Jump and JumpPressed.
func NewBotInput(dx, dy int, jump bool) BotInput {
	return BotInput{DX: dx, DY: dy, Jump: jump, JumpPressed: jump}
}

// ToInput converts to a physics Input.
func (b BotInput) ToInput() Input { return Input{DX: b.DX, DY: b.DY, JumpPressed: b.JumpPressed} }

// Trajectory snapshots clones of the non-dead entities for ticks 0..n (frame j is after j
// updates). update is the game's real hazard step; a panic inside it is swallowed and the
// entity keeps its state. The live entities are untouched.
func Trajectory[T any](ents []*Entity, n int, dt float64, update func(e *Entity, dt float64), snap func(*Entity) T) [][]T {
	var cur []*Entity
	for _, e := range ents {
		if !e.Dead {
			cur = append(cur, e.Clone())
		}
	}
	take := func() []T {
		s := make([]T, len(cur))
		for i, e := range cur {
			s[i] = snap(e)
		}
		return s
	}
	out := [][]T{take()}
	for j := 0; j < n; j++ {
		for _, e := range cur {
			func() {
				defer func() { _ = recover() }()
				update(e, dt)
			}()
		}
		out = append(out, take())
	}
	return out
}

// Family is one macro-plan family: Make(n) builds the macro delayed by n ticks.
type Family[M any] struct {
	Bias float64
	Make func(n int) M
}

// SearchOpts tunes SearchMacros. Values are used verbatim (zero is meaningful, for example
// NTax 0); start from DefaultSearchOpts.
type SearchOpts struct {
	Count, Stride     int
	RobustBelow, NTax float64
}

// DefaultSearchOpts returns Count 30, Stride 3, RobustBelow 24, NTax 0.004.
func DefaultSearchOpts() SearchOpts {
	return SearchOpts{Count: 30, Stride: 3, RobustBelow: 24, NTax: 0.004}
}

// Macro is the winning plan.
type Macro[M any] struct {
	Cost   float64
	Family int
	N      int
	Macro  M
}

// SearchMacros scores every family at delays 0, Stride, 2*Stride, ... Pass 1 smooths each
// cost with its neighbours (max of i-1, i, i+1) so a plan that only works at one exact tick
// is not trusted; if a smoothed plan is below RobustBelow the best wins, otherwise raw costs
// decide. Strictly lower cost replaces the best (ties keep the first). Returns nil if none.
func SearchMacros[M any](families []Family[M], cost func(M) float64, o SearchOpts) *Macro[M] {
	nn, stride, robust, tax := o.Count, o.Stride, o.RobustBelow, o.NTax
	costs := make([][]float64, len(families))
	for fi, f := range families {
		costs[fi] = make([]float64, nn)
		for i := 0; i < nn; i++ {
			costs[fi][i] = cost(f.Make(i * stride))
		}
	}
	for _, smooth := range []bool{true, false} {
		var best *Macro[M]
		for fi, f := range families {
			cs := costs[fi]
			for i := 0; i < nn; i++ {
				raw := cs[i]
				if smooth {
					l, r := cs[i], cs[i]
					if i > 0 {
						l = cs[i-1]
					}
					if i+1 < nn {
						r = cs[i+1]
					}
					raw = math.Max(cs[i], math.Max(l, r))
				}
				c := raw + f.Bias + float64(i)*tax
				if best == nil || c < best.Cost {
					best = &Macro[M]{Cost: c, Family: fi, N: i * stride, Macro: f.Make(i * stride)}
				}
			}
		}
		if best != nil && (!smooth || best.Cost < robust) {
			return best
		}
	}
	return nil
}

// Watchdog detects no progress and asks the bot to flail for a while.
type Watchdog struct {
	Limit      float64 // seconds without progress (default 40)
	PanicTicks int     // flail length (default 90)
	// Stuck counts how many times the watchdog fired.
	Stuck int

	key   string
	since float64
	panic int
}

// NewWatchdog returns a watchdog with explicit settings (a limit of 0 is valid: it fires on
// the first repeated key). See DefaultWatchdog.
func NewWatchdog(limit float64, panicTicks int) *Watchdog {
	return &Watchdog{Limit: limit, PanicTicks: panicTicks}
}

// DefaultWatchdog is NewWatchdog(40, 90).
func DefaultWatchdog() *Watchdog { return NewWatchdog(40, 90) }

// Tick reports whether the bot should flail now. key changes mean progress; time is seconds.
func (w *Watchdog) Tick(key string, time float64) bool {
	if key != w.key {
		w.key, w.since, w.panic = key, time, 0
	}
	if w.panic == 0 && time-w.since > w.Limit {
		w.Stuck++
		w.panic, w.since = w.PanicTicks, time
	}
	if w.panic > 0 {
		w.panic--
		return true
	}
	return false
}

// Flail is the input for the given 1-based tick number: alternate direction, hop now and then.
func (w *Watchdog) Flail(tickNo int) BotInput {
	dx := -1
	if tickNo%120 < 60 {
		dx = 1
	}
	return NewBotInput(dx, 0, tickNo%40 == 0)
}

// Humanize returns a deterministic human-lag filter: it delays each jump by up to
// ~(1-skill)*14 ticks. skill >= 1 is a perfect bot. rng nil uses BotRNG(1).
func Humanize(skill float64, rng func() float64) func(r BotInput, canAct bool) BotInput {
	if rng == nil {
		rng = NewBotRNG(1).Float64
	}
	pending := 0
	return func(r BotInput, canAct bool) BotInput {
		if skill >= 1 || !canAct {
			return r
		}
		if pending > 0 {
			pending--
			if pending == 0 {
				r.Jump, r.JumpPressed = true, true
				return r
			}
			return NewBotInput(r.DX, 0, false)
		}
		if r.JumpPressed {
			late := int(jsRound((1 - skill) * 14))
			pending = late + int(math.Floor(rng()*float64(late+1)))
			if pending > 0 {
				return NewBotInput(r.DX, 0, false)
			}
		}
		return r
	}
}

// AutopilotStats are the bot's counters. Stuck only updates when a flail is returned.
type AutopilotStats struct {
	Errors    int
	Stuck     int
	LastError string
}

// AutopilotConfig configures NewAutopilot for a game type G.
type AutopilotConfig[G any] struct {
	// Decide returns the bot's intent; an error or panic is contained and counted.
	Decide      func(g G, dt float64) (BotInput, error)
	ProgressKey func(g G) string
	Time        func(g G) float64
	Playing     func(g G) bool // nil means always
	CanHumanize func(g G) bool // nil means always
	Skill       *float64       // nil means 1 (perfect); use Ptr(0.8)
	Seed        *int64         // nil means 1
	WatchLimit  *float64       // nil means 40
	WatchPanic  *int           // nil means 90
}

// Autopilot glues decide + watchdog + humanizer + error containment + stats.
type Autopilot[G any] struct {
	Stats  AutopilotStats
	cfg    AutopilotConfig[G]
	wd     *Watchdog
	lag    func(BotInput, bool) BotInput
	tickNo int
}

// NewAutopilot builds an autopilot. Errors in Decide fall back to "run right" (dx=1).
func NewAutopilot[G any](cfg AutopilotConfig[G]) *Autopilot[G] {
	skill, seed := 1.0, int64(1)
	if cfg.Skill != nil {
		skill = *cfg.Skill
	}
	if cfg.Seed != nil {
		seed = *cfg.Seed
	}
	wd := DefaultWatchdog()
	if cfg.WatchLimit != nil {
		wd.Limit = *cfg.WatchLimit
	}
	if cfg.WatchPanic != nil {
		wd.PanicTicks = *cfg.WatchPanic
	}
	return &Autopilot[G]{cfg: cfg, wd: wd,
		lag: Humanize(skill, NewBotRNG(seed).Float64)}
}

func (a *Autopilot[G]) decide(g G, dt float64) (r BotInput) {
	defer func() {
		if p := recover(); p != nil {
			a.Stats.Errors++
			a.Stats.LastError = fmt.Sprint(p)
			r = NewBotInput(1, 0, false)
		}
	}()
	r, err := a.cfg.Decide(g, dt)
	if err != nil {
		a.Stats.Errors++
		a.Stats.LastError = err.Error()
		r = NewBotInput(1, 0, false)
	}
	return r
}

// Input returns the bot's input for this tick.
func (a *Autopilot[G]) Input(g G, dt float64) BotInput {
	a.tickNo++
	playing := a.cfg.Playing == nil || a.cfg.Playing(g)
	if playing && a.wd.Tick(a.cfg.ProgressKey(g), a.cfg.Time(g)) {
		a.Stats.Stuck = a.wd.Stuck
		return a.wd.Flail(a.tickNo)
	}
	r := a.decide(g, dt)
	return a.lag(r, a.cfg.CanHumanize == nil || a.cfg.CanHumanize(g))
}
