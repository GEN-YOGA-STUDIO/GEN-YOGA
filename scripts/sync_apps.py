#!/usr/bin/env python3
import os
import shutil
import re
import sys
import subprocess

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = BASE_DIR
ANDROID_WWW = os.path.join(BASE_DIR, "app android", "www")
ANDROID_ASSETS = os.path.join(BASE_DIR, "app android", "android", "app", "src", "main", "assets", "public")
IOS_WWW = os.path.join(BASE_DIR, "app ios", "www")
IOS_ASSETS = os.path.join(BASE_DIR, "app ios", "ios", "App", "App", "public")

EXCLUDED_DIRS = {
    '.git', '.github', 'node_modules', 'android', 'ios', 'build', '.gradle',
    'app android', 'app ios', 'control de versiones web', 'docs', 'ultima version',
    '.cursor', '.gemini', 'scratch', 'scripts', '.idea', '.temp', 'app local'
}
EXCLUDED_EXTS = {
    '.aab', '.apk', '.zip', '.rar', '.p8', '.keystore', '.jks', '.log',
    '.bat', '.cmd', '.ps1', '.sh', '.md'
}
EXCLUDED_FILES = {
    'package.json', 'package-lock.json', 'tailwind.config.js', 'deno.lock',
    'tailwind-input.css', 'CNAME', '.gitignore'
}

def sync_web_assets():
    print("=" * 60)
    print("🔄 Sincronizando recursos web entre Web, Android e iOS...")
    print("=" * 60)

    targets = [
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
            if file in EXCLUDED_FILES or file.startswith('.'):
                continue
            ext = os.path.splitext(file)[1].lower()
            if ext in EXCLUDED_EXTS:
                continue

            src_file = os.path.join(root, file)

            for label, target_base in targets:
                dst_file = os.path.join(target_base, rel_path, file) if rel_path != "." else os.path.join(target_base, file)
                os.makedirs(os.path.dirname(dst_file), exist_ok=True)
                shutil.copy2(src_file, dst_file)
                copied_count += 1

    print(f"✅ Sincronizacion completada: {copied_count} archivos actualizados en todas las plataformas.")

def bump_version(new_version=None, new_build_number=None):
    args = ["node", os.path.join(BASE_DIR, "scripts", "bump-version.mjs")]
    if new_version:
        args.append(str(new_version))
    if new_build_number:
        args.append(str(new_build_number))
    
    subprocess.run(args, cwd=BASE_DIR, check=True)

    print("🎨 Recompilando Tailwind CSS...")
    subprocess.run(
        ["npx", "tailwindcss", "-i", "./tailwind-input.css", "-o", "./tailwind-compiled.css", "--minify"],
        cwd=BASE_DIR,
        shell=(os.name == 'nt'),
        check=True
    )
    print("✅ CSS actualizado y minificado.")

if __name__ == "__main__":
    ver = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] != "" else None
    build = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] != "" else None
    
    if ver or build:
        bump_version(ver, build)
    
    sync_web_assets()
