"""Blender-side GLB export script (run with `blender --background --python`).

Blender 4+/5 renamed the PLY importer and the glTF colour options, so both API
variants are attempted. The script prints a single JSON line prefixed with
``EXPORT_RESULT`` for the parent process to parse.
"""

from __future__ import annotations

import json
import os
import sys


def parse_args(argv):
    args = {}
    index = 0
    while index < len(argv):
        token = argv[index]
        if token in {"--input", "--output"} and index + 1 < len(argv):
            args[token.lstrip("-")] = argv[index + 1]
            index += 2
            continue
        index += 1
    return args


def import_ply(path):
    import bpy

    if hasattr(bpy.ops.wm, "ply_import"):
        bpy.ops.wm.ply_import(filepath=path)
    else:  # Blender < 4.0
        bpy.ops.import_mesh.ply(filepath=path)


def main():
    import bpy

    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    args = parse_args(argv)
    input_path = args.get("input")
    output_path = args.get("output")
    if not input_path or not output_path or not os.path.isfile(input_path):
        print(json.dumps({"ok": False, "error": "missing --input/--output or input file"}))
        sys.exit(2)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if not collection.objects:
            bpy.data.collections.remove(collection)

    import_ply(input_path)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        print(json.dumps({"ok": False, "error": "PLY import produced no mesh"}))
        sys.exit(3)

    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    mesh = bpy.context.view_layer.objects.active

    colors = getattr(mesh.data, "color_attributes", None)
    if colors is not None and len(colors) > 0:
        mesh.data.color_attributes.active_color_index = 0
        try:
            mesh.data.color_attributes.render_color_index = 0
        except Exception:
            pass

    os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)

    export_kwargs = dict(
        filepath=output_path,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )
    try:
        bpy.ops.export_scene.gltf(export_vertex_color="ACTIVE", **export_kwargs)
    except TypeError:
        bpy.ops.export_scene.gltf(**export_kwargs)

    if not os.path.isfile(output_path) or os.path.getsize(output_path) < 32:
        print(json.dumps({"ok": False, "error": "Blender produced no GLB output"}))
        sys.exit(4)

    with open(output_path, "rb") as handle:
        magic = handle.read(4)
    if magic != b"glTF":
        print(json.dumps({"ok": False, "error": "output is not a GLB container"}))
        sys.exit(5)

    print(
        "EXPORT_RESULT "
        + json.dumps(
            {
                "ok": True,
                "bytes": os.path.getsize(output_path),
                "vertices": len(mesh.data.vertices),
                "polygons": len(mesh.data.polygons),
            }
        )
    )


if __name__ == "__main__":
    main()
