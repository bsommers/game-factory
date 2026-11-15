extends SceneTree
## Numeric screenshot check (no image viewer needed).
## usage: tools/godot.sh --headless --path game --script res://tests/img_stats.gd -- <a.png> [<b.png>]
## Prints mean RGB, luminance stddev and (with b) mean absolute difference. Exit 1 if a is blank/flat.


func _init() -> void:
	var args: PackedStringArray = OS.get_cmdline_user_args()
	if args.is_empty():
		printerr("usage: -- <a.png> [<b.png>]")
		quit(2)
		return
	var a: Image = Image.load_from_file(args[0])
	if a == null or a.is_empty():
		printerr("cannot load " + args[0])
		quit(2)
		return
	var sa: Dictionary = stats(a)
	print("IMG %s %dx%d mean=%s lum_std=%.4f" % [args[0], a.get_width(), a.get_height(), sa["mean"], sa["std"]])
	if args.size() > 1:
		var b: Image = Image.load_from_file(args[1])
		print("DIFF mean_abs=%.4f" % mean_abs_diff(a, b))
	quit(0 if float(sa["std"]) > 0.01 else 1)


static func stats(img: Image, step: int = 4) -> Dictionary:
	var sum: Vector3 = Vector3.ZERO
	var lum: PackedFloat32Array = []
	for y: int in range(0, img.get_height(), step):
		for x: int in range(0, img.get_width(), step):
			var c: Color = img.get_pixel(x, y)
			sum += Vector3(c.r, c.g, c.b)
			lum.append(c.get_luminance())
	var n: float = float(lum.size())
	var mean_l: float = 0.0
	for l: float in lum:
		mean_l += l
	mean_l /= n
	var var_l: float = 0.0
	for l: float in lum:
		var_l += (l - mean_l) * (l - mean_l)
	return {"mean": sum / n, "std": sqrt(var_l / n)}


static func mean_abs_diff(a: Image, b: Image, step: int = 4) -> float:
	if b == null or a.get_size() != b.get_size():
		return -1.0
	var d: float = 0.0
	var n: int = 0
	for y: int in range(0, a.get_height(), step):
		for x: int in range(0, a.get_width(), step):
			var ca: Color = a.get_pixel(x, y)
			var cb: Color = b.get_pixel(x, y)
			d += (absf(ca.r - cb.r) + absf(ca.g - cb.g) + absf(ca.b - cb.b)) / 3.0
			n += 1
	return d / float(n)
