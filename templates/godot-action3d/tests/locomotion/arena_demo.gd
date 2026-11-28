extends Node3D
## Test arena driver: makes the player run a gentle arc so screenshots show the camera trailing a moving character.

@onready var player: CharacterBody3D = $Player


func _physics_process(_d: float) -> void:
	var t: float = Engine.get_physics_frames() / 60.0
	player.input_override = Vector2(0.35 * sin(t), 1.0) if t > 0.5 else Vector2.ZERO
