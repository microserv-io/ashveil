import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy


SEMANTIC_MESHES = (
    "Body",
    "Head",
    "Hand_NegativeX",
    "Hand_PositiveX",
    "Eye_NegativeX",
    "Eye_PositiveX",
    "Facial_Feature_01",
)
EXPECTED_SOURCE_SHA256 = "375e25dea0da0c8d4267ee4402a64cf4582520341b367e1163730b8f8fc56edb"
EXPECTED_BLEND_SHA256 = "c9212b65a98456dbb2eaa2a51b4347d12ec6571e2162e9eda1592db6e25480c7"


def parse_args():
    separator = sys.argv.index("--") if "--" in sys.argv else len(sys.argv)
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--session", required=True)
    parser.add_argument("--markers-ready", action="store_true")
    return parser.parse_args(sys.argv[separator + 1 :])


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def arp_preferences():
    addon = bpy.context.preferences.addons.get("bl_ext.user_default.auto_rig_pro")
    if addon is None:
        raise RuntimeError("Auto-Rig Pro must be enabled as a Blender extension")
    return addon.preferences


def view3d_override():
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type != "VIEW_3D":
                continue
            region = next((item for item in area.regions if item.type == "WINDOW"), None)
            if region is not None:
                return {
                    "window": window,
                    "screen": window.screen,
                    "area": area,
                    "region": region,
                    "space": area.spaces.active,
                }
    raise RuntimeError("Auto-Rig Pro Smart setup requires a live VIEW_3D area")


def activate_body_temp(scene):
    body_temp = bpy.data.objects.get("body_temp")
    if body_temp is None:
        raise RuntimeError("Auto-Rig Pro body_temp is missing")
    bpy.ops.object.select_all(action="DESELECT")
    body_temp.hide_set(False)
    body_temp.hide_viewport = False
    body_temp.hide_select = False
    body_temp.select_set(True)
    bpy.context.view_layer.objects.active = body_temp
    scene.arp_body_name = body_temp.name
    return body_temp


def marker_evidence():
    names = (
        "root_loc",
        "neck_loc",
        "shoulder_loc",
        "elbow_loc",
        "hand_loc",
        "thigh_loc",
        "knee_loc",
        "foot_loc",
        "head_tip_loc",
    )
    missing = [name for name in names if bpy.data.objects.get(name) is None]
    if missing:
        raise RuntimeError(f"Auto-Rig Pro Smart markers are missing: {missing}")
    return {
        name.removesuffix("_loc"): [round(value, 9) for value in bpy.data.objects[name].matrix_world.translation]
        for name in names
    }


def generated_reference_rigs():
    return [
        obj
        for obj in bpy.data.objects
        if obj.type == "ARMATURE"
        and (obj.name == "rig" or "c_root_master.x" in obj.data.bones)
    ]


def save_detected_session(scene, session_path, markers):
    rigs = generated_reference_rigs()
    if len(rigs) != 1:
        raise RuntimeError(f"Auto-Rig Pro detection produced {len(rigs)} reference rigs")
    scene["ashveil_arp_session_phase"] = "reference_rig_detected"
    scene["ashveil_arp_addon_version"] = "3.78.47"
    scene["ashveil_arp_ai_version"] = "1.21"
    scene["ashveil_arp_markers"] = json.dumps(markers, sort_keys=True)
    scene["ashveil_source_sha256"] = EXPECTED_SOURCE_SHA256
    scene["ashveil_prepared_blend_sha256"] = EXPECTED_BLEND_SHA256
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(session_path).resolve()))
    print("ASHVEIL_ARP_REFERENCE_RIG_READY", Path(session_path).resolve())
    bpy.ops.wm.quit_blender()


def detect_reference_rig(scene, session_path):
    markers = marker_evidence()
    activate_body_temp(scene)
    scene.arp_body_name = "body_temp"
    with bpy.context.temp_override(**view3d_override()):
        scene.arp_body_name = "body_temp"
        result = bpy.ops.id.go_detect("EXEC_DEFAULT")
    if result != {"FINISHED"}:
        raise RuntimeError(f"Auto-Rig Pro reference-rig detection failed: {result}")
    save_detected_session(scene, session_path, markers)


def setup_live_session(input_directory, session_path, markers_ready):
    input_directory = Path(input_directory).resolve()
    blend_path = input_directory / "masculine-character-spike.blend"
    if sha256(blend_path) != EXPECTED_BLEND_SHA256:
        raise RuntimeError("Prepared blend does not match the audited masculine input")
    meshes = [bpy.data.objects.get(name) for name in SEMANTIC_MESHES]
    if any(obj is None or obj.type != "MESH" for obj in meshes):
        raise RuntimeError("Prepared blend is missing a semantic mesh")
    preferences = arp_preferences()
    ai_root = Path(preferences.ai_presets_path)
    info_path = ai_root / "info.dat"
    if not info_path.exists() or "version=1.21" not in info_path.read_text(encoding="utf-8"):
        raise RuntimeError("Auto-Rig Pro Smart AI 1.21 is not installed")
    scene = bpy.context.scene
    if markers_ready:
        detect_reference_rig(scene, session_path)
        return
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="DESELECT")
    for mesh in meshes:
        mesh.hide_set(False)
        mesh.hide_viewport = False
        mesh.hide_select = False
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = bpy.data.objects["Body"]
    scene.arp_smart_type = "BODY"
    scene.arp_smart_sym = True
    scene.arp_smart_depth = True
    scene.arp_smart_AI_body_samples = 10
    scene.arp_fingers_enable = False
    with bpy.context.temp_override(**view3d_override()):
        result = bpy.ops.id.get_selected_objects("EXEC_DEFAULT")
    if result != {"FINISHED"} or bpy.data.objects.get("body_temp") is None:
        raise RuntimeError(f"Auto-Rig Pro Smart object setup failed: {result}")
    activate_body_temp(scene)
    scene.arp_body_name = "body_temp"
    with bpy.context.temp_override(**view3d_override()):
        scene.arp_body_name = "body_temp"
        result = bpy.ops.arp.guess_markers("EXEC_DEFAULT", symmetry=True)
    if result != {"FINISHED"}:
        raise RuntimeError(f"Auto-Rig Pro Smart marker inference failed: {result}")
    detect_reference_rig(scene, session_path)


def main():
    args = parse_args()
    attempts = {"count": 0}

    def delayed_setup():
        attempts["count"] += 1
        try:
            setup_live_session(args.input, args.session, args.markers_ready)
            return None
        except RuntimeError as error:
            if "VIEW_3D" in str(error) and attempts["count"] < 30:
                return 0.25
            raise

    bpy.app.timers.register(delayed_setup, first_interval=0.25)


main()
