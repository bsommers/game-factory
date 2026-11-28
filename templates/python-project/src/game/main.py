"""pygame-ce starter: fixed-step loop + one-screen platformer demo using the engine kits.

Run: ``pip install -e .[game]`` then ``python -m game.main`` (``--frames N`` runs headless-ish N ticks and exits).
pygame is imported lazily so the engine and its tests need no pygame.
"""
from __future__ import annotations

import sys
from typing import Any, Dict

from .engine import hazard_kit as H
from .engine import platformer_physics as P

DT = 1.0 / 60.0
W, HGT, GROUND = 320, 180, 160


def build_world() -> Dict[str, Any]:
    """One screen: a pit, a floating platform and a patrolling hazard."""
    return {"groundY": GROUND, "pits": [{"x0": 150, "x1": 175}],
            "platforms": [{"id": "p1", "x": 220, "y": 125, "w": 50}], "ladders": [], "ropes": []}


def make_hazards() -> tuple:
    reg = H.create_registry()
    reg.register("guard", H.patroller(minX=190, maxX=300, speed=25))
    return reg, [reg.spawn("guard", {"x": 250, "y": GROUND})]


def step_game(body: P.Body, inp: P.Input, world: Dict[str, Any], reg: H.Registry, ents: list) -> bool:
    """Advance one fixed tick. Returns True if the player died."""
    P.step_body(body, inp, DT, world)
    reg.update(ents, DT, {})
    if body.mode == "dead":
        return True
    return any(r["type"] == "kill" for r in H.resolve_contacts(reg, body, ents, {}, {}))


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    max_frames = int(argv[argv.index("--frames") + 1]) if "--frames" in argv else None
    import pygame  # lazy: only the game needs it

    pygame.init()
    scale = 3
    screen = pygame.display.set_mode((W * scale, HGT * scale))
    pygame.display.set_caption("__NAME__")
    clock = pygame.time.Clock()
    world = build_world()
    reg, ents = make_hazards()
    body = P.make_body(30, GROUND)
    acc, frames, running = 0.0, 0, True
    while running:
        acc += min(clock.tick(60) / 1000.0, 0.1)
        jump = False
        for ev in pygame.event.get():
            if ev.type == pygame.QUIT:
                running = False
            elif ev.type == pygame.KEYDOWN and ev.key in (pygame.K_SPACE, pygame.K_UP):
                jump = True
        keys = pygame.key.get_pressed()
        dx = int(keys[pygame.K_RIGHT]) - int(keys[pygame.K_LEFT])
        while acc >= DT:
            acc -= DT
            if step_game(body, P.Input(dx, 0, jump), world, reg, ents):
                body = P.make_body(30, GROUND)
            jump = False
            frames += 1
        screen.fill((20, 24, 40))
        s = scale

        def rect(x, y, w, h, col):
            pygame.draw.rect(screen, col, ((x - w / 2) * s, (y - h) * s, w * s, h * s))

        pygame.draw.rect(screen, (60, 120, 60), (0, GROUND * s, W * s, (HGT - GROUND) * s))
        for q in world["pits"]:
            pygame.draw.rect(screen, (20, 24, 40), (q["x0"] * s, GROUND * s, (q["x1"] - q["x0"]) * s, (HGT - GROUND) * s))
        for p in world["platforms"]:
            pygame.draw.rect(screen, (150, 110, 60), ((p["x"] - p["w"] / 2) * s, p["y"] * s, p["w"] * s, 4 * s))
        for e in ents:
            rect(e["x"], e["y"], e["w"], e["h"], (220, 70, 70))
        rect(body.x, body.y, 8, 16, (240, 220, 80))
        pygame.display.flip()
        if max_frames is not None and frames >= max_frames:
            running = False
    pygame.quit()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
