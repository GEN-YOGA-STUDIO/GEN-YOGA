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
ULTIMA_VERSION = os.path.join(BASE_DIR, "ultima version")
ULTIMA_ANDROID_WWW = os.path.join(BASE_DIR, "ultima version", "app android", "www")
ULTIMA_ANDROID_ASSETS = os.path.join(BASE_DIR, "ultima version", "app android", "android", "app", "src", "main", "assets", "public")
ULTIMA_IOS_WWW = os.path.join(BASE_DIR, "ultima version", "app ios", "www")
ULTIMA_IOS_ASSETS = os.path.join(BASE_DIR, "ultima version", "app ios", "ios", "App", "App", "public")

EXCLUDED_DIRS = {
    '.git', '.github', 'node_modules', 'android', 'ios', 'build', '.gradle',
    'app android', 'app ios', 'control de versiones web', 'docs', 'ultima version',
    '.cursor', '.gemini', 'scratch', 'scripts', '.idea', '.temp',
    # Backend Supabase (migraciones, funciones, config): nunca va en los bundles
    # de las apps — el WebView lo consume por CDN/red, no por fichero local.
    'supabase',
    # Restos sin referenciar (también en .gitignore).
    'vibe_images',
}
EXCLUDED_EXTS = {
    '.aab', '.apk', '.zip', '.rar', '.p8', '.keystore', '.jks', '.log',
    '.bat', '.cmd', '.ps1', '.sh', '.md'
}
EXCLUDED_FILES = {
    'package.json', 'package-lock.json', 'tailwind.config.js', 'deno.lock',
    'tailwind-input.css', 'CNAME', '.gitignore',
    'opencode.json', 'opencode.jsonc',
    '-Jaime\u2019s Mac mini.gitignore', "-Jaime's Mac mini.gitignore",
    'package-Jaime\u2019s Mac mini.json', "package-Jaime's Mac mini.json",
}
# Cualquier resto con "mac mini" en el nombre tampoco debe entrar en las apps.
EXCLUDED_SUBSTRINGS = {'mac mini'}


def is_excluded_file(filename):
    if filename in EXCLUDED_FILES or filename.startswith('.'):
        return True
    return any(sub in filename.lower() for sub in EXCLUDED_SUBSTRINGS)

def sync_web_assets():
    print("=" * 60)
    print("🔄 Sincronizando recursos web entre Web, Android, iOS y Última Versión...")
    print("=" * 60)

    targets = [
        ("Android WWW", ANDROID_WWW),
        ("Android Assets", ANDROID_ASSETS),
        ("iOS WWW", IOS_WWW),
        ("iOS Assets", IOS_ASSETS),
        ("Ultima Version", ULTIMA_VERSION),
        ("Ultima Version Android WWW", ULTIMA_ANDROID_WWW),
        ("Ultima Version Android Assets", ULTIMA_ANDROID_ASSETS),
        ("Ultima Version iOS WWW", ULTIMA_IOS_WWW),
        ("Ultima Version iOS Assets", ULTIMA_IOS_ASSETS)
    ]

    for label, target_path in targets:
        os.makedirs(target_path, exist_ok=True)

    copied_count = 0
    for root, dirs, files in os.walk(SRC_DIR):
        dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS and not d.startswith('.')]
        rel_path = os.path.relpath(root, SRC_DIR)

        for file in files:
            if is_excluded_file(file):
                continue
            ext = os.path.splitext(file)[1].lower()
            if ext in EXCLUDED_EXTS:
                continue

            src_file = os.path.join(root, file)

            for label, target_base in targets:
                dst_file = os.path.join(target_base, rel_path, file) if rel_path != "." else os.path.join(target_base, file)
                os.makedirs(os.path.dirname(dst_file), exist_ok=True)
                if os.path.exists(dst_file):
                    try:
                        os.remove(dst_file)
                    except Exception:
                        pass
                shutil.copy2(src_file, dst_file)
                copied_count += 1

    # .well-known/ (App Links / Universal Links) debe publicarse con la web:
    # se refleja solo en la raíz de 'ultima version' (fuente del deploy),
    # nunca dentro de los bundles de las apps.
    well_known_src = os.path.join(SRC_DIR, '.well-known')
    if os.path.isdir(well_known_src):
        well_known_dst = os.path.join(ULTIMA_VERSION, '.well-known')
        # dirs_exist_ok: en OneDrive el rmtree previo puede fallar por bloqueos.
        shutil.copytree(well_known_src, well_known_dst, dirs_exist_ok=True)
        print("✅ .well-known sincronizado a 'ultima version' (fuente del deploy).")

    print(f"✅ Sincronizacion completada: {copied_count} archivos actualizados en todas las plataformas.")

def bump_version(new_version=None, new_build_number=None):
    args = ["node", os.path.join(BASE_DIR, "scripts", "bump-version.mjs")]
    if new_version:
        args.append(str(new_version))
    if new_build_number:
        args.append(str(new_build_number))
    
    subprocess.run(args, cwd=BASE_DIR, check=True)

    print("🎨 Recompilando Tailwind CSS...")
    try:
        subprocess.run(
            ["npx", "tailwindcss", "-i", "./tailwind-input.css", "-o", "./tailwind-compiled.css", "--minify"],
            cwd=BASE_DIR,
            shell=(os.name == 'nt'),
            check=True
        )
        print("✅ CSS actualizado y minificado.")
    except Exception as e:
        print(f"⚠️  Tailwind CSS no se pudo recompilar online ({e}), manteniendo CSS compilado actual.")

if __name__ == "__main__":
    ver = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] != "" else None
    build = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] != "" else None
    
    if ver or build:
        bump_version(ver, build)
    
    sync_web_assets()
