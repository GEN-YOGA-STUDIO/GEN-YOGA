#!/usr/bin/env python3
import os
import sys
import subprocess
import shutil

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from sync_apps import sync_web_assets, bump_version
from build_android import build_android

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def run_git(cmd):
    return subprocess.run(cmd, cwd=BASE_DIR, shell=True, check=True)

def main():
    print("=" * 70)
    print("🚀 SISTEMA AUTOMATICO DE PUBLICACION Y SINCRONIZACION MULTIPLATAFORMA")
    print("=" * 70)

    new_version = None
    new_build = None
    commit_msg = "Actualizacion y despliegue automatico multiplataforma"

    if len(sys.argv) > 1 and sys.argv[1] != "":
        new_version = sys.argv[1]
    if len(sys.argv) > 2 and sys.argv[2] != "":
        new_build = int(sys.argv[2])
    if len(sys.argv) > 3 and sys.argv[3] != "":
        commit_msg = sys.argv[3]

    # Step 1: Sync Assets across all platforms
    sync_web_assets()

    # Step 2: Bump version if requested
    if new_version or new_build:
        bump_version(new_version, new_build)

    # Step 3: Build Android Artifacts
    print("\n🔨 Compilando paquetes de Android...")
    build_android()

    # Step 4: Commit & Push to GitHub
    print("\n📤 Subiendo cambios a GitHub...")
    try:
        run_git("git add .")
        run_git(f'git commit -m "{commit_msg}"')
        run_git("git push origin main")
        print("✅ Cambios subidos correctamente a GitHub.")
    except Exception as e:
        print(f"ℹ️ Git info: {e}")

    # Step 5: Trigger iOS App Store Connect Deployment
    print("\n🍏 Lanzando compilacion y subida a Apple App Store Connect...")
    try:
        res = subprocess.run(
            ["gh", "workflow", "run", "deploy-ios.yml", "--repo", "jaime312/GEN-YOGA"],
            capture_output=True,
            text=True
        )
        if res.returncode == 0:
            print("✅ ¡Accion de Apple iniciada en la nube de GitHub!")
            print("   Apple compilara el .ipa y lo subira directamente a App Store Connect.")
        else:
            print(f"⚠️ Info gh CLI: {res.stderr}")
    except FileNotFoundError:
        print("ℹ️ Puedes disparar la accion de iOS en: https://github.com/jaime312/GEN-YOGA/actions")

    print("\n" + "=" * 70)
    print("🎉 ¡PROCESO DE PUBLICACION COMPLETADO!")
    print("=" * 70)
    print("1. Android Play Store:")
    print("   👉 Arrastra el archivo 'app android/app-release.aab' a Google Play Console:")
    print("   🔗 https://play.google.com/console")
    print("\n2. Apple App Store:")
    print("   👉 Sigue el estado de la subida a TestFlight/App Store en:")
    print("   🔗 https://github.com/jaime312/GEN-YOGA/actions")
    print("   🔗 https://appstoreconnect.apple.com/apps")
    print("=" * 70)

if __name__ == "__main__":
    main()
