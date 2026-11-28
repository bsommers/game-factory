extends RefCounted
## Registers the third-person input actions at runtime (no project.godot edits needed). Safe to call repeatedly;
## actions that already exist (e.g. move_* and jump from project.godot) are left untouched.
## Actions: move_forward/back/left/right, jump, sprint, dodge, aim, look_left/right/up/down (gamepad right stick).

static func _key(code: Key) -> InputEventKey:
	var e := InputEventKey.new()
	e.physical_keycode = code
	return e


static func _axis(axis: JoyAxis, value: float) -> InputEventJoypadMotion:
	var e := InputEventJoypadMotion.new()
	e.axis = axis
	e.axis_value = value
	return e


static func _btn(b: JoyButton) -> InputEventJoypadButton:
	var e := InputEventJoypadButton.new()
	e.button_index = b
	return e


static func _mouse(b: MouseButton) -> InputEventMouseButton:
	var e := InputEventMouseButton.new()
	e.button_index = b
	return e


static func ensure() -> void:
	var defs: Dictionary = {
		"move_forward": [_key(KEY_W), _key(KEY_UP), _axis(JOY_AXIS_LEFT_Y, -1.0)],
		"move_back": [_key(KEY_S), _key(KEY_DOWN), _axis(JOY_AXIS_LEFT_Y, 1.0)],
		"move_left": [_key(KEY_A), _key(KEY_LEFT), _axis(JOY_AXIS_LEFT_X, -1.0)],
		"move_right": [_key(KEY_D), _key(KEY_RIGHT), _axis(JOY_AXIS_LEFT_X, 1.0)],
		"jump": [_key(KEY_SPACE), _btn(JOY_BUTTON_A)],
		"sprint": [_key(KEY_SHIFT), _btn(JOY_BUTTON_LEFT_STICK)],
		"dodge": [_key(KEY_CTRL), _key(KEY_C), _btn(JOY_BUTTON_B)],
		"aim": [_mouse(MOUSE_BUTTON_RIGHT), _axis(JOY_AXIS_TRIGGER_LEFT, 1.0)],
		"look_left": [_axis(JOY_AXIS_RIGHT_X, -1.0)],
		"look_right": [_axis(JOY_AXIS_RIGHT_X, 1.0)],
		"look_up": [_axis(JOY_AXIS_RIGHT_Y, -1.0)],
		"look_down": [_axis(JOY_AXIS_RIGHT_Y, 1.0)],
	}
	for action: String in defs:
		if InputMap.has_action(action):
			continue
		InputMap.add_action(action, 0.2)
		for ev: InputEvent in defs[action]:
			InputMap.action_add_event(action, ev)
