#!/usr/bin/env python3
import os
import shutil
import re
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(BASE_DIR, "ultima version")
ANDROID_WWW = os.path.join(BASE_DIR, "app android", "www")
ANDROID_ASSETS = os.path.join(BASE_DIR, "app android", "android", "app", "src", "main", "assets", "public")
IOS_WWW = os.path.join(BASE_DIR, "app ios", "www")
IOS_ASSETS = os.path.join(BASE_DIR, "app ios", "ios", "App", "App", "public")

EXCLUDED_DIRS = {'.git', 'node_modules', 'android', 'ios', 'build', '.gradle', 'app android', 'app ios', 'control de versiones web', '.github', 'scripts'}
EXCLUDED_EXTS = {'.aab', '.apk', '.zip', '.rar', '.p8', '.keystore', '.jks', '.log'}

def sync_web_assets():
    print("=" * 60)
    print("🔄 Sincronizando recursos web entre Web, Android e iOS...")
    print("=" * 60)

    targets = [
        ("Web Root", BASE_DIR),
        ("Android WWW", ANDROID_WWW),
        ("Android Assets", ANDROID_ASSETS),
        ("iOS WWW", IOS_WWW),
        ("iOS Assets", IOS_ASSETS)
    ]

    for label, target_path in targets:
        os.makedirs(target_path, exist_ok=True)

    copied_count = 0
    for root, dirs, files in os.walk(SRC_DIR):
        dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS and not d.startswith('.')]
        rel_path = os.path.relpath(root, SRC_DIR)

        for file in files:
            ext = os.path.splitext(file)[1].lower()
            if ext in EXCLUDED_EXTS:
                continue

            src_file = os.path.join(root, file)

            for label, target_base in targets:
                if label == "Web Root":
                    dst_file = os.path.join(target_base, rel_path, file) if rel_path != "." else os.path.join(target_base, file)
                else:
                    dst_file = os.path.join(target_base, rel_path, file) if rel_path != "." else os.path.join(target_base, file)

                os.makedirs(os.path.dirname(dst_file), exist_ok=True)
                shutil.copy2(src_file, dst_file)
                copied_count += 1

    print(f"✅ Sincronizacion completada: {copied_count} archivos actualizados en todas las plataformas.")

def bump_version(new_version=None, new_build_number=None):
    gradle_path = os.path.join(BASE_DIR, "app android", "android", "app", "build.gradle")
    pbxproj_path = os.path.join(BASE_DIR, "app ios", "ios", "App", "App.xcodeproj", "project.pbxproj")

    if not os.path.exists(gradle_path):
        print("⚠️ No se encontro build.gradle para gestionar versiones.")
        return

    with open(gradle_path, "r", encoding="utf-8") as f:
        gradle_content = f.read()

    vc_match = re.search(r'versionCode\s+(\d+)', gradle_content)
    vn_match = re.search(r'versionName\s+"([^"]+)"', gradle_content)

    current_vc = int(vc_match.group(1)) if vc_match else 60
    current_vn = vn_match.group(1) if vn_match else "6.42"

    if new_version is None:
        new_version = current_vn
    if new_build_number is None:
        new_build_number = current_vc + 1

    print(f"📌 Actualizando version a: v{new_version} (Build #{new_build_number})")

    gradle_content = re.sub(r'versionCode\s+\d+', f'versionCode {new_build_number}', gradle_content)
    gradle_content = re.sub(r'versionName\s+"[^"]+"', f'versionName "{new_version}"', gradle_content)
    with open(gradle_path, "w", encoding="utf-8") as f:
        f.write(gradle_content)

    if os.path.exists(pbxproj_path):
        with open(pbxproj_path, "r", encoding="utf-8") as f:
            pbx_content = f.read()
        pbx_content = re.sub(r'MARKETING_VERSION = [^;]+;', f'MARKETING_VERSION = {new_version};', pbx_content)
        pbx_content = re.sub(r'CURRENT_PROJECT_VERSION = \d+;', f'CURRENT_PROJECT_VERSION = {new_build_number};', pbx_content)
        with open(pbxproj_path, "w", encoding="utf-8") as f:
            f.write(pbx_content)

    print(f"✅ Version v{new_version} (#{new_build_number}) configurada en Android e iOS.")

if __name__ == "__main__":
    ver = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] != "" else None
    build = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] != "" else None
    sync_web_assets()
    if ver or build:
        bump_version(ver, build)
