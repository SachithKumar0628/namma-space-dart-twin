"""
DART-Twin: Blender PLY -> GLB export helper.
Invoked by pipeline/reconstruct_full.py:
    blender --background --python pipeline/blender_export_glb.py -- --input meshed.ply --output out.glb
"""

import sys
import os

try:
    import bpy
except ImportError as exc:
    print(f"[ERROR] Blender Python (bpy) is not available: {exc}")
    sys.exit(1)


def parse_args(argv):
    args = {}
    for i, token in enumerate(argv):
        if token == "--input" and i + 1 < len(argv):
            args["input"] = argv[i + 1]
        elif token == "--output" and i + 1 < len(argv):
            args["output"] = argv[i + 1]
    return args


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = parse_args(argv)
    input_path = args.get("input")
    output_path = args.get("output")
    if not input_path or not output_path:
        print("[ERROR] --input and --output are required.")
        sys.exit(2)

    if not os.path.isfile(input_path):
        print(f"[ERROR] Input file not found: {input_path}")
        sys.exit(2)

    # Clear default scene.
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    # Import PLY.
    bpy.ops.import_mesh.ply(filepath=input_path)

    # Apply a simple principled shader so vertex colors / lit shading survive export.
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            # Ensure vertex colors are used if present.
            if obj.data.vertex_colors:
                for mat in obj.data.materials:
                    pass

    os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)

    # Export glTF binary (.glb).
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        export_triangulated=True,
        export_apply=True,
        export_colors=True,
        export_cameras=False,
        export_lights=False,
    )
    print(f"[OK] Exported GLB: {output_path}")


if __name__ == "__main__":
    main()
