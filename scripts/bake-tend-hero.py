import bpy

SOURCE_OBJECT = "Plane"
OUTPUT_PATH = "packages/frontend/public/models/tend-hero-baked.glb"
FRAME_START = 0
FRAME_END = 40


def evaluated_mesh(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    return bpy.data.meshes.new_from_object(
        evaluated,
        depsgraph=depsgraph,
        preserve_all_data_layers=True,
    )


scene = bpy.context.scene
source = bpy.data.objects[SOURCE_OBJECT]

scene.frame_set(FRAME_START)
basis_mesh = evaluated_mesh(source)
baked = bpy.data.objects.new("TendHeroBaked", basis_mesh)
bpy.context.collection.objects.link(baked)
bpy.context.view_layer.objects.active = baked
baked.select_set(True)

material = bpy.data.materials.get("Material")
if material:
    baked.data.materials.append(material)

basis = baked.shape_key_add(name="Basis")
keys = []
vertex_count = len(basis_mesh.vertices)

for frame in range(FRAME_START, FRAME_END + 1):
    scene.frame_set(frame)
    mesh = evaluated_mesh(source)
    if len(mesh.vertices) != vertex_count:
        raise RuntimeError(
            f"Topology changed at frame {frame}: "
            f"{len(mesh.vertices)} != {vertex_count}"
        )

    key = baked.shape_key_add(name=f"frame_{frame:04d}")
    for index, vertex in enumerate(mesh.vertices):
        key.data[index].co = vertex.co
    keys.append(key)
    bpy.data.meshes.remove(mesh)

def iter_action_fcurves(action):
    if hasattr(action, "fcurves"):
        yield from action.fcurves
        return

    for layer in getattr(action, "layers", []):
        for strip in getattr(layer, "strips", []):
            for channelbag in getattr(strip, "channelbags", []):
                yield from getattr(channelbag, "fcurves", [])


if baked.data.shape_keys:
    baked.data.shape_keys.use_relative = True
    for frame, active_key in enumerate(keys, start=FRAME_START):
        scene.frame_set(frame)
        for key in keys:
            key.value = 1.0 if key == active_key else 0.0
            key.keyframe_insert("value", frame=frame)

    animation_data = baked.data.shape_keys.animation_data
    if animation_data and animation_data.action:
        for fcurve in iter_action_fcurves(animation_data.action):
            for point in fcurve.keyframe_points:
                point.interpolation = "LINEAR"

for obj in bpy.context.scene.objects:
    obj.select_set(False)
baked.select_set(True)
bpy.context.view_layer.objects.active = baked

bpy.ops.export_scene.gltf(
    filepath=OUTPUT_PATH,
    export_format="GLB",
    use_selection=True,
    export_animations=True,
    export_morph=True,
    export_morph_normal=True,
)
