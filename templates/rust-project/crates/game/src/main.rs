//! One-screen platformer demo on top of the deterministic `engine` crate: physics, a patrolling hazard, a pit and a
//! moving platform. Fixed 60 Hz simulation, rendering is decoupled (macroquad). Arrows/A-D move, Space/Up/W jump, R resets.
#![forbid(unsafe_code)]

use engine::hazard::{resolve_contacts, ContactOpts, ContactType, Ctx, Entity, Patroller, Player, Props, Registry};
use engine::physics::{self as ph, Body, Config, Input, Mode, MovingPlatform, World};
use macroquad::prelude::*;

const VIEW_W: f32 = 320.0;
const VIEW_H: f32 = 180.0;
const DT: f64 = 1.0 / 60.0;

fn window_conf() -> Conf {
    Conf { window_title: "__NAME__".to_string(), window_width: 960, window_height: 540, ..Default::default() }
}

struct Game {
    cfg: Config,
    world: World,
    body: Body,
    mover: MovingPlatform,
    reg: Registry,
    hazards: Vec<Entity>,
    deaths: u32,
}

impl Game {
    fn new() -> Self {
        let mut world = World { ground_y: 150.0, ..World::default() };
        world.pits.push(ph::Pit::new(120.0, 150.0));
        world.platforms.push(ph::Platform::new(200.0, 112.0, 40.0));
        let mover = MovingPlatform::new(160.0, 128.0, 160.0, 128.0, 24.0, 20.0, 0.0);
        let mut reg = Registry::new();
        reg.register("patrol", Patroller { min_x: 170.0, max_x: 300.0, ..Patroller::default() }, Props::default());
        let mut g = Ctx::default();
        let hazards = vec![reg.spawn("patrol", &Props::at(260.0, 150.0), &mut g).expect("kind registered")];
        Game { cfg: Config::default(), world, body: Body::new(20.0, 150.0), mover, reg, hazards, deaths: 0 }
    }

    fn reset(&mut self) {
        let deaths = self.deaths;
        *self = Game::new();
        self.deaths = deaths;
    }

    /// One fixed simulation tick.
    fn step(&mut self, input: Input) {
        let mut ctx = Ctx::default();
        let mut events = Vec::new();
        ph::step_body(&mut self.body, input, DT, &self.world, &self.cfg, &mut events);
        // Wrap around the screen edges (single-screen demo).
        self.body.x = self.body.x.rem_euclid(VIEW_W as f64);
        self.reg.update(&mut self.hazards, DT, &mut ctx).expect("hazard update");
        let player = Player { x: self.body.x, y: self.body.y, layer: None };
        let hit = resolve_contacts(&self.reg, &player, &mut self.hazards, &ContactOpts::default(), &ctx)
            .iter()
            .any(|c| c.kind == ContactType::Kill);
        if hit || self.body.mode == Mode::Dead {
            self.deaths += 1;
            self.reset();
        }
    }

    fn draw(&self) {
        clear_background(Color::from_rgba(24, 28, 44, 255));
        let s = (screen_width() / VIEW_W).min(screen_height() / VIEW_H);
        let (ox, oy) = ((screen_width() - VIEW_W * s) / 2.0, (screen_height() - VIEW_H * s) / 2.0);
        let rect = |x: f64, y: f64, w: f64, h: f64, c: Color| {
            draw_rectangle(ox + x as f32 * s, oy + y as f32 * s, w as f32 * s, h as f32 * s, c);
        };
        rect(0.0, 0.0, VIEW_W as f64, VIEW_H as f64, Color::from_rgba(40, 48, 80, 255));
        let gy = self.world.ground_y;
        rect(0.0, gy, VIEW_W as f64, VIEW_H as f64 - gy, GREEN);
        for q in &self.world.pits {
            rect(q.x0, gy, q.x1 - q.x0, VIEW_H as f64 - gy, BLACK);
        }
        for p in &self.world.platforms {
            rect(p.x - p.w / 2.0, p.y, p.w, 4.0, ORANGE);
        }
        for h in &self.hazards {
            rect(h.x - h.w / 2.0, h.y - h.h, h.w, h.h, RED);
        }
        let b = &self.body;
        rect(b.x - self.cfg.hit_w / 2.0, b.y - self.cfg.hit_h, self.cfg.hit_w, self.cfg.hit_h, YELLOW);
        draw_text(format!("deaths {}", self.deaths), ox + 6.0 * s, oy + 14.0 * s, 20.0 * s, WHITE);
    }
}

fn read_input(jump_latch: &mut bool) -> Input {
    let held = |a: KeyCode, b: KeyCode| is_key_down(a) || is_key_down(b);
    if is_key_pressed(KeyCode::Space) || is_key_pressed(KeyCode::Up) || is_key_pressed(KeyCode::W) {
        *jump_latch = true;
    }
    Input {
        dx: i32::from(held(KeyCode::Right, KeyCode::D)) - i32::from(held(KeyCode::Left, KeyCode::A)),
        dy: i32::from(is_key_down(KeyCode::Down)) - i32::from(is_key_down(KeyCode::Up)),
        jump_pressed: std::mem::take(jump_latch),
    }
}

#[macroquad::main(window_conf)]
async fn main() {
    let mut game = Game::new();
    let (mut acc, mut latch) = (0.0_f64, false);
    loop {
        if is_key_pressed(KeyCode::R) {
            game.reset();
        }
        let mut inp = read_input(&mut latch);
        acc += f64::from(get_frame_time()).min(0.25);
        while acc >= DT {
            game.mover.update(DT);
            game.mover.write_to(&mut game.world.platforms[0]);
            game.step(inp);
            inp.jump_pressed = false; // a press is consumed by the first tick of this frame
            acc -= DT;
        }
        game.draw();
        next_frame().await;
    }
}
