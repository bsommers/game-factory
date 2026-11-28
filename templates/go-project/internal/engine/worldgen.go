package engine

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
)

// Val is a number or a {from|base, to, perT} ramp driven by difficulty t (JSON: number,
// object or null). The zero Val is "absent".
type Val struct {
	Present bool
	IsNum   bool
	Num     float64
	From    *float64 // "from" ?? "base"
	To      *float64
	PerT    float64
}

// Num returns a constant Val.
func Num(v float64) Val { return Val{Present: true, IsNum: true, Num: v} }

// UnmarshalJSON accepts a number, an object or null.
func (v *Val) UnmarshalJSON(b []byte) error {
	*v = Val{}
	if string(b) == "null" {
		return nil
	}
	var n float64
	if err := json.Unmarshal(b, &n); err == nil {
		*v = Val{Present: true, IsNum: true, Num: n}
		return nil
	}
	var o struct {
		From, Base, To *float64
		PerT           *float64 `json:"perT"`
	}
	if err := json.Unmarshal(b, &o); err != nil {
		return err
	}
	v.Present = true
	v.From, v.To = o.From, o.To
	if v.From == nil {
		v.From = o.Base
	}
	if o.PerT != nil {
		v.PerT = *o.PerT
	}
	return nil
}

// Lerp is the reference lerpVal: absent -> 0; number -> itself; else
// a + (to-a)*t + perT*t with a = from ?? base ?? 0 and to defaulting to a.
func (v Val) Lerp(t float64) float64 {
	if !v.Present {
		return 0
	}
	if v.IsNum {
		return v.Num
	}
	a := 0.0
	if v.From != nil {
		a = *v.From
	}
	to := a
	if v.To != nil {
		to = *v.To
	}
	return a + (to-a)*t + v.PerT*t
}

// orOne evaluates v at t, or returns 1 when absent (the "chance ?? 1" rule).
func (v Val) orOne(t float64) float64 {
	if !v.Present {
		return 1
	}
	return v.Lerp(t)
}

// Wrap is the integer floor-mod ((i % n) + n) % n.
func Wrap(i, n int) int { return WrapIndex(i, n) }

// CircDist is the circular distance between screens a and b in a world of n.
func CircDist(a, b, n int) int {
	d := Wrap(a-b, n)
	if n-d < d {
		return n - d
	}
	return d
}

// RampOf is difficulty 0 at start .. 1 on the opposite side of the circle.
func RampOf(i, start, n int) float64 { return float64(CircDist(i, start, n)) / (float64(n) / 2) }

// PickWeighted draws once and returns the weighted choice index; weights are summed first.
func PickWeighted(r RNG, weights []float64) int {
	tot := 0.0
	for _, w := range weights {
		tot += w
	}
	x := r.Float64() * tot
	for i, w := range weights {
		if x -= w; x < 0 {
			return i
		}
	}
	return len(weights) - 1
}

func jsRound(x float64) float64 { return math.Floor(x + 0.5) }

// ---- rule table -------------------------------------------------------------------------

// KindRule is one weighted item kind a place rule may produce.
type KindRule struct {
	Kind   string         `json:"kind"`
	Weight *float64       `json:"weight"`
	PerT   float64        `json:"perT"`
	MinT   *float64       `json:"minT"`
	MaxT   *float64       `json:"maxT"`
	Props  map[string]any `json:"props"`
}

// PlaceRule places items on a screen. Mode "rolling" items have no x.
type PlaceRule struct {
	Kinds  []KindRule `json:"kinds"`
	Chance Val        `json:"chance"` // absent means 1
	Count  *int       `json:"count"`  // default 1
	MinT   *float64   `json:"minT"`
	MaxT   *float64   `json:"maxT"`
	ClampT *float64   `json:"clampT"`
	Mode   string     `json:"mode"` // "rolling" or "" (static)
	Lo     *float64   `json:"lo"`   // default 0
	Hi     *float64   `json:"hi"`   // default 320
	FixedX *float64   `json:"fixedX"`
}

// PitBuild is the declarative pit builder (spec fixture build.type = "pit").
type PitBuild struct {
	Type   string   `json:"type"`
	Chance Val      `json:"chance"`
	W      Val      `json:"w"`
	Kind   string   `json:"kind"` // default "hole"
	Lo     *float64 `json:"lo"`   // default 60
	Hi     *float64 `json:"hi"`   // default 260
}

// Ctx is passed to custom slot builders.
type Ctx struct {
	RNG   *Mulberry32
	T     float64
	Rules *Rules
	Idx   int
	N     int
	def   *Screen
}

// FreeXs lists free x positions on the current screen (see Rules.FreeXs).
func (c *Ctx) FreeXs(lo, hi float64) []float64 {
	return freeXs(c.def, c.Rules, FreeXsOpts{Lo: lo, Hi: hi})
}

// Slot describes one screen tag.
type Slot struct {
	Set   map[string]any `json:"set"`
	Place []PlaceRule    `json:"place"`
	Build *PitBuild      `json:"build"`
	// BuildFn is the escape hatch (runs after Place, instead of Build when non-nil).
	BuildFn func(def *Screen, ctx *Ctx) `json:"-"`
}

// Blocks controls how slot tags are dealt across blocks of Size screens.
type Blocks struct {
	Size      int               `json:"size"` // default 12
	Deck      []string          `json:"deck"` // default ["plain"]
	Fixed     map[string]string `json:"fixed"`
	FirstSlot string            `json:"firstSlot"`
}

// Spacing are pixel minimums; zero means the default (edgeClear 36, gap 48, step 4).
type Spacing struct {
	EdgeClear float64 `json:"edgeClear"`
	Gap       float64 `json:"gap"`
	Step      float64 `json:"step"`
}

// Prefer is the declarative collectible preference: every Every-th collectible goes on a
// screen whose pit kind is PitKind.
type Prefer struct {
	Every   int    `json:"every"`
	PitKind string `json:"pitKind"`
}

// Tier assigns Type to collectibles of distance rank below UpTo.
type Tier struct {
	Type string `json:"type"`
	UpTo int    `json:"upTo"`
}

// CollectRules places Count collectibles round the circle.
type CollectRules struct {
	Count     int                     `json:"count"`
	Tiers     []Tier                  `json:"tiers"`
	Exclude   string                  `json:"exclude"` // screen.Set key that excludes a screen when truthy
	Prefer    *Prefer                 `json:"prefer"`
	Offsets   []int                   `json:"offsets"`   // default 0,1,-1,2,-2
	XRange    []float64               `json:"xRange"`    // default 30,290
	XStep     float64                 `json:"xStep"`     // default 10
	Clear     float64                 `json:"clear"`     // default 44
	ZoneClear float64                 `json:"zoneClear"` // default 28
	ExcludeFn func(*Screen) bool      `json:"-"`
	PreferFn  func(*Screen, int) bool `json:"-"`
}

// Rules is the world-gen rule table.
type Rules struct {
	Seed         *int64          `json:"seed"` // default 1
	Count        int             `json:"count"`
	Start        int             `json:"start"`
	Blocks       Blocks          `json:"blocks"`
	Spacing      Spacing         `json:"spacing"`
	Slots        map[string]Slot `json:"slots"`
	Collectibles *CollectRules   `json:"collectibles"`
}

func (r *Rules) seed() int64 {
	if r.Seed == nil {
		return 1
	}
	return *r.Seed
}

// ---- generated data ---------------------------------------------------------------------

// Item is a placed hazard. X is nil for rolling items.
type Item struct {
	Kind  string
	X     *float64
	Props map[string]any
}

// MarshalJSON emits {kind, x?, ...props}.
func (it Item) MarshalJSON() ([]byte, error) {
	m := map[string]any{}
	for k, v := range it.Props {
		m[k] = v
	}
	m["kind"] = it.Kind
	if it.X != nil {
		m["x"] = *it.X
	}
	return json.Marshal(m)
}

// UnmarshalJSON reads {kind, x?, ...props}.
func (it *Item) UnmarshalJSON(b []byte) error {
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return err
	}
	*it = Item{Props: map[string]any{}}
	for k, v := range m {
		switch {
		case k == "kind":
			it.Kind, _ = v.(string)
		case k == "x" && v != nil:
			f, _ := v.(float64)
			it.X = &f
		case k == "x":
		default:
			it.Props[k] = v
		}
	}
	return nil
}

// Zone is an x range with special meaning (Pit zones are the pit itself).
type Zone struct {
	X0  float64 `json:"x0"`
	X1  float64 `json:"x1"`
	Pit bool    `json:"pit,omitempty"`
}

// PitInfo is the pit a screen carries.
type PitInfo struct {
	Kind string  `json:"kind"`
	X0   float64 `json:"x0"`
	W    float64 `json:"w"`
}

// Collectible is a pickup on a screen.
type Collectible struct {
	ID   int     `json:"id"`
	Type string  `json:"type"`
	X    float64 `json:"x"`
}

// Placed is a collectible in the world list.
type Placed struct {
	ID     int     `json:"id"`
	Type   string  `json:"type"`
	Screen int     `json:"screen"`
	X      float64 `json:"x"`
}

// Screen is one generated screen. Set holds the slot's extra keys (for example "boss").
type Screen struct {
	Idx         int
	Tag         string
	T           float64
	Items       []Item
	Zones       []Zone
	Collectible *Collectible
	Pit         *PitInfo
	Set         map[string]any
}

// MarshalJSON emits the JS shape: idx, tag, t, items, zones, collectible, pit?, ...set.
func (s Screen) MarshalJSON() ([]byte, error) {
	m := map[string]any{}
	for k, v := range s.Set {
		m[k] = v
	}
	m["idx"], m["tag"], m["t"] = s.Idx, s.Tag, s.T
	m["items"], m["zones"], m["collectible"] = nonNilItems(s.Items), nonNilZones(s.Zones), s.Collectible
	if s.Pit != nil {
		m["pit"] = s.Pit
	}
	return json.Marshal(m)
}

func nonNilItems(v []Item) []Item {
	if v == nil {
		return []Item{}
	}
	return v
}

func nonNilZones(v []Zone) []Zone {
	if v == nil {
		return []Zone{}
	}
	return v
}

// UnmarshalJSON reads the shape produced by MarshalJSON.
func (s *Screen) UnmarshalJSON(b []byte) error {
	var k struct {
		Idx         int          `json:"idx"`
		Tag         string       `json:"tag"`
		T           float64      `json:"t"`
		Items       []Item       `json:"items"`
		Zones       []Zone       `json:"zones"`
		Collectible *Collectible `json:"collectible"`
		Pit         *PitInfo     `json:"pit"`
	}
	if err := json.Unmarshal(b, &k); err != nil {
		return err
	}
	var all map[string]any
	if err := json.Unmarshal(b, &all); err != nil {
		return err
	}
	for _, n := range []string{"idx", "tag", "t", "items", "zones", "collectible", "pit"} {
		delete(all, n)
	}
	*s = Screen{Idx: k.Idx, Tag: k.Tag, T: k.T, Items: k.Items, Zones: k.Zones,
		Collectible: k.Collectible, Pit: k.Pit, Set: all}
	return nil
}

func (s *Screen) truthy(key string) bool {
	switch v := s.Set[key].(type) {
	case nil:
		return false
	case bool:
		return v
	case float64:
		return v != 0
	case string:
		return v != ""
	}
	return true
}

// GeneratedWorld is the generator output.
type GeneratedWorld struct {
	Screens      []Screen `json:"screens"`
	Collectibles []Placed `json:"collectibles"`
}

// ---- generation -------------------------------------------------------------------------

func (r *Rules) blockSize() int {
	if r.Blocks.Size > 0 {
		return r.Blocks.Size
	}
	return 12
}

func blockSlots(r *Rules, b int) map[int]string {
	size := r.blockSize()
	deck := r.Blocks.Deck
	if len(deck) == 0 {
		deck = []string{"plain"}
	}
	rng := NewMulberry32(r.seed()*7 + 7001 + int64(b)*31)
	fixed := map[int]string{}
	for k, v := range r.Blocks.Fixed {
		if p, err := strconv.Atoi(k); err == nil {
			fixed[p] = v
		}
	}
	var free []int
	for p := 0; p < size; p++ {
		if _, ok := fixed[p]; !ok {
			free = append(free, p)
		}
	}
	cards := make([]string, len(free))
	for k := range cards {
		cards[k] = deck[k%len(deck)]
	}
	Shuffle[string](rng, cards)
	m := map[int]string{}
	for p, v := range fixed {
		m[p] = v
	}
	for k, p := range free {
		m[p] = cards[k]
	}
	if b == 0 && r.Blocks.FirstSlot != "" && m[0] != r.Blocks.FirstSlot {
		for _, p := range free {
			if m[p] == r.Blocks.FirstSlot {
				m[0], m[p] = m[p], m[0]
				break
			}
		}
	}
	return m
}

// FreeXsOpts parameterises free-position search. Zero EdgeClear/Gap use the rule
// spacing; Hi 0 means 320.
type FreeXsOpts struct {
	EdgeClear, Gap float64
	Extra          []float64
	Lo, Hi         float64
}

func freeXs(def *Screen, r *Rules, o FreeXsOpts) []float64 {
	ec, g, step := o.EdgeClear, o.Gap, r.Spacing.Step
	if ec == 0 {
		if ec = r.Spacing.EdgeClear; ec == 0 {
			ec = 36
		}
	}
	if g == 0 {
		if g = r.Spacing.Gap; g == 0 {
			g = 48
		}
	}
	if step == 0 {
		step = 4
	}
	hi := o.Hi
	if hi == 0 {
		hi = 320
	}
	var out []float64
loop:
	for x := o.Lo + ec; x <= hi-ec; x += step {
		for _, z := range def.Zones {
			if x > z.X0-ec && x < z.X1+ec {
				continue loop
			}
		}
		for _, h := range def.Items {
			if h.X != nil && math.Abs(*h.X-x) < g {
				continue loop
			}
		}
		for _, e := range o.Extra {
			if math.Abs(e-x) < g {
				continue loop
			}
		}
		out = append(out, x)
	}
	return out
}

func copyProps(p map[string]any) map[string]any {
	m := make(map[string]any, len(p))
	for k, v := range p {
		m[k] = v
	}
	return m
}

func applyPlace(def *Screen, rule *PlaceRule, c *Ctx) {
	rng, t := c.RNG, c.T
	ch := rule.Chance.orOne(t)
	if rule.MinT != nil && t < *rule.MinT {
		return
	}
	if rule.MaxT != nil && t > *rule.MaxT {
		return
	}
	if !rng.Chance(ch) {
		return
	}
	tt := t
	if rule.ClampT != nil {
		tt = math.Min(t, *rule.ClampT)
	}
	var kinds []*KindRule
	var weights []float64
	for i := range rule.Kinds {
		k := &rule.Kinds[i]
		if (k.MinT == nil || tt > *k.MinT) && (k.MaxT == nil || tt <= *k.MaxT) {
			w := 1.0
			if k.Weight != nil {
				w = *k.Weight
			}
			kinds = append(kinds, k)
			weights = append(weights, w+k.PerT*tt)
		}
	}
	if len(kinds) == 0 {
		return
	}
	n := 1
	if rule.Count != nil {
		n = *rule.Count
	}
	lo, hi := 0.0, 320.0
	if rule.Lo != nil {
		lo = *rule.Lo
	}
	if rule.Hi != nil {
		hi = *rule.Hi
	}
	for i := 0; i < n; i++ {
		k := kinds[PickWeighted(rng, weights)]
		if rule.Mode == "rolling" {
			def.Items = append(def.Items, Item{Kind: k.Kind, Props: copyProps(k.Props)})
			continue
		}
		xs := freeXs(def, c.Rules, FreeXsOpts{Lo: lo, Hi: hi})
		if len(xs) == 0 {
			return
		}
		var x float64
		if rule.FixedX != nil {
			x = *rule.FixedX
		} else {
			x = Pick[float64](rng, xs)
		}
		def.Items = append(def.Items, Item{Kind: k.Kind, X: &x, Props: copyProps(k.Props)})
	}
}

func applyPitBuild(b *PitBuild, def *Screen, c *Ctx) {
	if !c.RNG.Chance(b.Chance.orOne(c.T)) {
		return
	}
	w := jsRound(b.W.Lerp(c.T))
	lo, hi, kind := 60.0, 260.0, "hole"
	if b.Lo != nil {
		lo = *b.Lo
	}
	if b.Hi != nil {
		hi = *b.Hi
	}
	if b.Kind != "" {
		kind = b.Kind
	}
	xs := c.FreeXs(lo, hi)
	if len(xs) == 0 {
		return
	}
	x0 := Pick[float64](c.RNG, xs)
	def.Pit = &PitInfo{Kind: kind, X0: x0, W: w}
	def.Zones = append(def.Zones, Zone{X0: x0, X1: x0 + w, Pit: true})
}

func deepCopyAny(v any) any {
	switch x := v.(type) {
	case map[string]any:
		m := make(map[string]any, len(x))
		for k, e := range x {
			m[k] = deepCopyAny(e)
		}
		return m
	case []any:
		s := make([]any, len(x))
		for i, e := range x {
			s[i] = deepCopyAny(e)
		}
		return s
	}
	return v
}

// Generate builds the world. It is a pure function of the rule table: the same seed gives
// the same world regardless of call order.
func Generate(r *Rules) (*GeneratedWorld, error) {
	n, start, size := r.Count, r.Start, r.blockSize()
	var maps []map[int]string
	for b := 0; b < (n+size-1)/size; b++ {
		maps = append(maps, blockSlots(r, b))
	}
	screens := make([]Screen, 0, n)
	for i := 0; i < n; i++ {
		rng := NewMulberry32(r.seed()*101 + 90001 + int64(i)*7919)
		t := RampOf(i, start, n)
		tag, ok := maps[i/size][i%size]
		if !ok {
			tag = "plain"
		}
		slot := r.Slots[tag]
		def := Screen{Idx: i, Tag: tag, T: t, Set: map[string]any{}}
		for k, v := range slot.Set {
			def.Set[k] = deepCopyAny(v)
		}
		ctx := &Ctx{RNG: rng, T: t, Rules: r, Idx: i, N: n, def: &def}
		for pi := range slot.Place {
			applyPlace(&def, &slot.Place[pi], ctx)
		}
		if slot.BuildFn != nil {
			slot.BuildFn(&def, ctx)
		} else if slot.Build != nil {
			applyPitBuild(slot.Build, &def, ctx)
		}
		if def.Pit != nil {
			has := false
			for _, z := range def.Zones {
				has = has || z.Pit
			}
			if !has {
				def.Zones = append(def.Zones, Zone{X0: def.Pit.X0, X1: def.Pit.X0 + def.Pit.W, Pit: true})
			}
		}
		screens = append(screens, def)
	}
	w := &GeneratedWorld{Screens: screens, Collectibles: []Placed{}}
	if r.Collectibles != nil {
		c, err := placeCollectibles(w.Screens, r)
		if err != nil {
			return nil, err
		}
		w.Collectibles = c
	}
	return w, nil
}

func placeCollectibles(screens []Screen, r *Rules) ([]Placed, error) {
	c := r.Collectibles
	n, start := len(screens), r.Start
	xlo, xhi := 30.0, 290.0
	if len(c.XRange) == 2 {
		xlo, xhi = c.XRange[0], c.XRange[1]
	}
	step, clear, zc := orDef(c.XStep, 10), orDef(c.Clear, 44), orDef(c.ZoneClear, 28)
	offsets := c.Offsets
	if offsets == nil {
		offsets = []int{0, 1, -1, 2, -2}
	}
	used := map[int]bool{start: true}
	rng := NewMulberry32(r.seed()*13 + 555)
	type pick struct {
		screen int
		x      float64
	}
	var picks []pick
	excluded := func(s *Screen) bool {
		if c.ExcludeFn != nil {
			return c.ExcludeFn(s)
		}
		return c.Exclude != "" && s.truthy(c.Exclude)
	}
	for k := 0; k < c.Count; k++ {
		target := int(jsRound((float64(k) + 0.5) * float64(n) / float64(c.Count)))
		var cands []int
		for _, o := range offsets {
			if i := Wrap(target+o, n); !used[i] && !excluded(&screens[i]) {
				cands = append(cands, i)
			}
		}
		pref := c.PreferFn
		if pref == nil && c.Prefer != nil {
			p := *c.Prefer
			pref = func(s *Screen, k int) bool {
				return p.Every != 0 && k%p.Every == 0 && s.Pit != nil && s.Pit.Kind == p.PitKind
			}
		}
		if pref != nil {
			var pr []int
			for _, i := range cands {
				if pref(&screens[i], k) {
					pr = append(pr, i)
				}
			}
			if len(pr) > 0 {
				cands = pr
			}
		}
		if len(cands) == 0 {
			return nil, fmt.Errorf("world-gen: collectible placement failed for %d", k)
		}
		si := cands[0]
		used[si] = true
		s := &screens[si]
		var kept []Item
		for _, h := range s.Items {
			if h.X != nil { // rolling hazards would sweep the collectible
				kept = append(kept, h)
			}
		}
		s.Items = kept
		okX := func(x float64, items []Item) bool {
			for _, z := range s.Zones {
				if x > z.X0-zc && x < z.X1+zc {
					return false
				}
			}
			for _, h := range items {
				if math.Abs(*h.X-x) < clear {
					return false
				}
			}
			return true
		}
		var xs []float64
		for x := xlo; x <= xhi; x += step {
			if okX(x, s.Items) {
				xs = append(xs, x)
			}
		}
		if len(xs) == 0 {
			s.Items = nil
			for x := xlo; x <= xhi; x += step {
				if okX(x, nil) {
					xs = append(xs, x)
				}
			}
		}
		if len(xs) == 0 {
			return nil, fmt.Errorf("world-gen: no free x for collectible on screen %d", si)
		}
		picks = append(picks, pick{si, Pick[float64](rng, xs)})
	}
	sort.SliceStable(picks, func(a, b int) bool { return picks[a].screen < picks[b].screen })
	type ord struct {
		id, screen, d int
		x             float64
	}
	order := make([]ord, len(picks))
	for id, p := range picks {
		order[id] = ord{id, p.screen, CircDist(p.screen, start, n), p.x}
	}
	sort.SliceStable(order, func(a, b int) bool {
		if order[a].d != order[b].d {
			return order[a].d < order[b].d
		}
		return order[a].screen < order[b].screen
	})
	out := make([]Placed, len(order))
	for rank, o := range order {
		typ := ""
		if len(c.Tiers) > 0 {
			typ = c.Tiers[len(c.Tiers)-1].Type
			for _, t := range c.Tiers {
				if rank < t.UpTo {
					typ = t.Type
					break
				}
			}
		}
		out[rank] = Placed{ID: o.id, Type: typ, Screen: o.screen, X: o.x}
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].ID < out[b].ID })
	for _, tr := range out {
		screens[tr.Screen].Collectible = &Collectible{ID: tr.ID, Type: tr.Type, X: tr.X}
	}
	return out, nil
}

func orDef(v, d float64) float64 {
	if v == 0 {
		return d
	}
	return v
}

// IsDeterministic generates twice and reports whether the worlds are identical.
func IsDeterministic(r *Rules) (bool, error) {
	a, err := Generate(r)
	if err != nil {
		return false, err
	}
	b, err := Generate(r)
	if err != nil {
		return false, err
	}
	ja, _ := json.Marshal(a.Screens)
	jb, _ := json.Marshal(b.Screens)
	return string(ja) == string(jb), nil
}

// ---- fairness validator -----------------------------------------------------------------

// Failure is one fairness violation. Screen is -1 for whole-world rules.
type Failure struct {
	Screen int    `json:"screen"`
	Rule   string `json:"rule"`
	Msg    string `json:"msg"`
}

// Validation is the validator result.
type Validation struct {
	OK       bool      `json:"ok"`
	Failures []Failure `json:"failures"`
	Stats    struct {
		Screens      int `json:"screens"`
		Collectibles int `json:"collectibles"`
	} `json:"stats"`
}

// ValidateOpts configures ValidateWorld. Zero EdgeClear/Gap/CollectClear use 36/48/44.
type ValidateOpts struct {
	EdgeClear, Gap, CollectClear float64
	// Crossable reports whether a player can get from the left to the right edge of the
	// screen; msg is the failure reason ("" means "not crossable").
	Crossable func(def *Screen) (ok bool, msg string)
	// CollectibleReachable is optional; msg "" means "unreachable".
	CollectibleReachable     func(def *Screen, col *Collectible) (ok bool, msg string)
	AllowEdgeItems           bool
	AllowItemsNearZones      bool
	RollingSweepsCollectible bool
	// Checks are extra rules; a non-empty return is a failure with rule "custom".
	Checks     []func(def *Screen) string
	MaxHardRun int
	IsHard     func(def *Screen) bool
}

func fnum(x float64) string { return strconv.FormatFloat(x, 'f', -1, 64) }

// ValidateWorld checks spacing, reachability and difficulty-run rules. Message text is
// part of the spec (number formatting is the shortest round-trip decimal).
func ValidateWorld(w *GeneratedWorld, o ValidateOpts) Validation {
	n := len(w.Screens)
	ec, gap, cc := orDef(o.EdgeClear, 36), orDef(o.Gap, 48), orDef(o.CollectClear, 44)
	v := Validation{Failures: []Failure{}}
	fail := func(idx int, rule, msg string) { v.Failures = append(v.Failures, Failure{idx, rule, msg}) }
	for si := range w.Screens {
		def := &w.Screens[si]
		if o.Crossable != nil {
			if ok, msg := o.Crossable(def); !ok {
				if msg == "" {
					msg = "not crossable"
				}
				fail(def.Idx, "crossable", msg)
			}
		}
		var st []Item
		for _, h := range def.Items {
			if h.X != nil {
				st = append(st, h)
			}
		}
		sort.SliceStable(st, func(a, b int) bool { return *st[a].X < *st[b].X })
		for k, it := range st {
			x := *it.X
			if x < ec || x > 320-ec {
				if !o.AllowEdgeItems {
					fail(def.Idx, "edgeClear", fmt.Sprintf("%s@%s within %s of edge", it.Kind, fnum(x), fnum(ec)))
				}
			}
			if k > 0 && x-*st[k-1].X < gap {
				fail(def.Idx, "gap", fmt.Sprintf("%s/%s only %spx apart", st[k-1].Kind, it.Kind, fnum(x-*st[k-1].X)))
			}
			for _, z := range def.Zones {
				if x > z.X0-ec && x < z.X1+ec && !o.AllowItemsNearZones {
					fail(def.Idx, "zoneClear", fmt.Sprintf("%s@%s too near a zone", it.Kind, fnum(x)))
				}
			}
		}
		if col := def.Collectible; col != nil {
			for _, h := range st {
				if d := math.Abs(*h.X - col.X); d < cc {
					fail(def.Idx, "collectClear", fmt.Sprintf("%s %spx from collectible", h.Kind, fnum(d)))
				}
			}
			rolling := false
			for _, h := range def.Items {
				rolling = rolling || h.X == nil
			}
			if rolling && o.RollingSweepsCollectible {
				fail(def.Idx, "rolling", "rolling hazard on collectible screen")
			}
			if o.CollectibleReachable != nil {
				if ok, msg := o.CollectibleReachable(def, col); !ok {
					if msg == "" {
						msg = "unreachable"
					}
					fail(def.Idx, "collectibleReachable", msg)
				}
			}
		}
		for _, chk := range o.Checks {
			if msg := chk(def); msg != "" {
				fail(def.Idx, "custom", msg)
			}
		}
	}
	if o.MaxHardRun > 0 && o.IsHard != nil {
		run, worst := 0, 0
		for i := 0; i < 2*n; i++ {
			if o.IsHard(&w.Screens[i%n]) {
				run++
			} else {
				run = 0
			}
			if run > worst {
				worst = run
			}
		}
		if worst > o.MaxHardRun && worst < 2*n {
			fail(-1, "hardRun", fmt.Sprintf("%d consecutive hard screens (max %d)", worst, o.MaxHardRun))
		}
	}
	seen := map[int]bool{}
	for _, c := range w.Collectibles {
		seen[c.Screen] = true
	}
	if len(seen) != len(w.Collectibles) {
		fail(-1, "collectibleUnique", "two collectibles share a screen")
	}
	v.OK = len(v.Failures) == 0
	v.Stats.Screens, v.Stats.Collectibles = n, len(w.Collectibles)
	return v
}

var errNoSlots = errors.New("world-gen: rule table has no slots")

// Check returns an error when the rule table cannot generate anything useful.
func (r *Rules) Check() error {
	if r.Count <= 0 || len(r.Slots) == 0 {
		return errNoSlots
	}
	return nil
}
