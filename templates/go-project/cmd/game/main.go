// Command game is the Ebitengine starter: a one-screen platformer built on internal/engine.
// Controls: arrows move, Space or Z jump, R restart.
package main

import (
	"fmt"
	"image/color"
	"log"

	"github.com/hajimehoshi/ebiten/v2"
	"github.com/hajimehoshi/ebiten/v2/ebitenutil"
	"github.com/hajimehoshi/ebiten/v2/inpututil"
	"github.com/hajimehoshi/ebiten/v2/vector"

	"__SLUG__/internal/engine"
)

const (
	screenW, screenH = 320, 180
	tps              = 60
	dt               = 1.0 / tps // fixed step: the simulation never sees a variable frame time
	groundY          = 160
)

// Game owns the simulation state. Update runs exactly once per fixed tick.
type Game struct {
	cfg      engine.Config
	world    *engine.World
	movers   []*engine.MovingPlatform
	reg      *engine.Registry
	ents     []*engine.Entity
	body     *engine.Body
	rng      *engine.PCG32
	score    int
	lives    int
	deadTick int
	tick     int
	events   []string
}

func newGame() *Game {
	g := &Game{cfg: engine.DefaultConfig(), lives: 3}
	g.cfg.Emit = func(e engine.Event) { g.note(e.Name) }
	g.reset()
	return g
}

func (g *Game) note(s string) {
	g.events = append(g.events, s)
	if len(g.events) > 4 {
		g.events = g.events[1:]
	}
}

// reset rebuilds the screen. The RNG is seeded so every run is identical.
func (g *Game) reset() {
	g.rng = engine.NewPCG32FromString("__SLUG__")
	mp := engine.NewMovingPlatform("lift", 230, 130, 230, 90, engine.MovingSpeed(18), engine.MovingWidth(28))
	g.movers = []*engine.MovingPlatform{mp}
	g.world = &engine.World{
		GroundY: groundY,
		Pits:    []engine.Pit{{X0: 120, X1: 150, Kind: "pit"}},
		Platforms: []*engine.Platform{
			{ID: "ledge", X: 70, Y: 130, W: 40},
			&mp.Platform,
		},
	}
	g.reg = engine.NewRegistry()
	g.reg.Register("scorpion", &engine.Patroller{W: 12, H: 8, Speed: 24, MinX: 160, MaxX: 300,
		Lethal: engine.LethalLife, FramePx: 4, Frames: 2})
	g.reg.Register("log", &engine.Roller{W: 14, H: 8, Speed: 40, Lethal: engine.LethalPoints,
		FramePx: 6, Frames: 4, Width: screenW})
	g.reg.Register("croc", engine.DefaultCycler())
	game := &engine.Game{RNG: g.rng, Width: screenW}
	g.ents = nil
	for _, s := range []struct {
		kind string
		x    float64
	}{{"scorpion", 220}, {"log", 300}, {"croc", 190}} {
		e, err := g.reg.Spawn(s.kind, game, engine.At(s.x, groundY))
		if err != nil {
			log.Fatal(err)
		}
		g.ents = append(g.ents, e)
	}
	g.body = engine.NewBody(24, groundY)
	g.deadTick = 0
}

// Update advances the simulation by one fixed tick.
func (g *Game) Update() error {
	if inpututil.IsKeyJustPressed(ebiten.KeyR) {
		g.lives, g.score = 3, 0
		g.reset()
	}
	g.tick++
	in := engine.Input{
		JumpPressed: inpututil.IsKeyJustPressed(ebiten.KeySpace) || inpututil.IsKeyJustPressed(ebiten.KeyZ),
	}
	if ebiten.IsKeyPressed(ebiten.KeyLeft) {
		in.DX--
	}
	if ebiten.IsKeyPressed(ebiten.KeyRight) {
		in.DX++
	}
	if ebiten.IsKeyPressed(ebiten.KeyUp) {
		in.DY--
	}
	if ebiten.IsKeyPressed(ebiten.KeyDown) {
		in.DY++
	}
	if g.body.Mode == engine.ModeDead {
		if g.deadTick++; g.deadTick > tps && g.lives > 0 {
			g.reset()
		}
		return nil
	}
	for _, m := range g.movers {
		m.Update(dt)
	}
	hz := &engine.Game{RNG: g.rng, Width: screenW}
	g.reg.Update(&g.ents, dt, hz)
	engine.StepBody(g.body, in, dt, g.world, &g.cfg)
	if tr, ok := engine.EdgeTransition(g.body, 0, 1, &g.cfg); ok {
		engine.ApplyTransition(g.body, tr) // one screen: wrap round to the other edge
	}
	for _, c := range engine.ResolveContacts(g.reg, engine.Player{X: g.body.X, Y: g.body.Y}, g.ents,
		engine.DefaultContactOpts(), &engine.Game{Time: float64(g.tick) * dt, HasTime: true}) {
		switch c.Type {
		case engine.ContactKill:
			g.body.Mode, g.body.DeathKind = engine.ModeDead, c.Kind
			g.lives--
		case engine.ContactPoints:
			g.score += int(c.Amount)
		}
	}
	return nil
}

func rect(dst *ebiten.Image, x, y, w, h float64, c color.Color) {
	vector.DrawFilledRect(dst, float32(x), float32(y), float32(w), float32(h), c, false)
}

// Draw renders the current state; it never mutates the simulation.
func (g *Game) Draw(dst *ebiten.Image) {
	dst.Fill(color.RGBA{0x14, 0x18, 0x2a, 0xff})
	ground := color.RGBA{0x3a, 0x6b, 0x3a, 0xff}
	rect(dst, 0, groundY, 120, screenH-groundY, ground)
	rect(dst, 150, groundY, screenW-150, screenH-groundY, ground)
	for _, p := range g.world.Platforms {
		rect(dst, p.X-p.W/2, p.Y, p.W, 4, color.RGBA{0x8a, 0x6a, 0x3a, 0xff})
	}
	for _, e := range g.ents {
		c := color.RGBA{0xd0, 0x40, 0x40, 0xff}
		if e.Lethal == engine.LethalNone {
			c = color.RGBA{0x40, 0xa0, 0x60, 0xff} // closed cycler: safe to stand on
		}
		rect(dst, e.X-e.W/2, e.Y-e.H, e.W, e.H, c)
	}
	b := g.body
	body := color.RGBA{0xf0, 0xd0, 0x50, 0xff}
	if b.Mode == engine.ModeDead {
		body = color.RGBA{0x80, 0x80, 0x80, 0xff}
	}
	rect(dst, b.X-g.cfg.HitW/2, b.Y-g.cfg.HitH, g.cfg.HitW, g.cfg.HitH, body)
	ebitenutil.DebugPrint(dst, fmt.Sprintf("score %d  lives %d  mode %s\n%v", g.score, g.lives, b.Mode, g.events))
	if g.lives <= 0 && b.Mode == engine.ModeDead {
		ebitenutil.DebugPrintAt(dst, "GAME OVER - press R", 100, 80)
	}
}

// Layout fixes the logical resolution; Ebitengine scales it to the window.
func (g *Game) Layout(_, _ int) (int, int) { return screenW, screenH }

func main() {
	ebiten.SetWindowSize(screenW*3, screenH*3)
	ebiten.SetWindowTitle("__NAME__")
	ebiten.SetTPS(tps)
	if err := ebiten.RunGame(newGame()); err != nil {
		log.Fatal(err)
	}
}
