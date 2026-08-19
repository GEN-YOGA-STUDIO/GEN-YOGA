#!/usr/bin/env python3
import os
import subprocess
import shutil
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANDROID_DIR = os.path.join(BASE_DIR, "app android", "android")
OUTPUT_AAB = os.path.join(ANDROID_DIR, "app", "build", "outputs", "bundle", "release", "app-release.aab")
OUTPUT_APK = os.path.join(ANDROID_DIR, "app", "build", "outputs", "apk", "release", "app-release.apk")
DEST_AAB = os.path.join(BASE_DIR, "app android", "app-release.aab")
DEST_APK = os.path.join(BASE_DIR, "app android", "app-release.apk")

def configure_java_home():
    current_java = os.environ.get("JAVA_HOME", "")
    is_valid = current_java and os.path.exists(os.path.join(current_java, "bin", "java.exe" if os.name == 'nt' else "java"))
    if not is_valid:
        candidates = [
            r"C:\Program Files\Android\Android Studio\jbr",
            r"C:\Program Files\Java\jdk-25",
            r"C:\Program Files\Java\latest",
        ]
        for c in candidates:
            if os.path.exists(c):
                os.environ["JAVA_HOME"] = c
                print(f"☕ Configurado JAVA_HOME automáticamente: {c}")
                break

def build_android():
    print("=" * 60)
    print("🤖 Compilando Android App Bundle (.aab) y APK...")
    print("=" * 60)

    configure_java_home()

    gradle_cmd = os.path.join(ANDROID_DIR, "gradlew.bat" if os.name == 'nt' else "./gradlew")

    if not os.path.exists(gradle_cmd):
        print(f"❌ No se encontro gradlew en: {gradle_cmd}")
        return False

    try:
        # Build AAB for Google Play
        print("📦 Generando Android App Bundle (.aab)...")
        subprocess.run([gradle_cmd, "bundleRelease"], cwd=ANDROID_DIR, check=True)
        
        # Build APK for Direct Install
        print("📦 Generando APK firmado (.apk)...")
        subprocess.run([gradle_cmd, "assembleRelease"], cwd=ANDROID_DIR, check=True)

        if os.path.exists(OUTPUT_AAB):
            shutil.copy2(OUTPUT_AAB, DEST_AAB)
            size_mb = os.path.getsize(DEST_AAB) / (1024 * 1024)
            print(f"✅ App Bundle (.aab) generado con exito: {DEST_AAB} ({size_mb:.2f} MB)")

        if os.path.exists(OUTPUT_APK):
            shutil.copy2(OUTPUT_APK, DEST_APK)
            size_mb = os.path.getsize(DEST_APK) / (1024 * 1024)
            print(f"✅ APK listo para instalacion: {DEST_APK} ({size_mb:.2f} MB)")

        return True
    except subprocess.CalledProcessError as e:
        print(f"⚠️ Error durante la compilacion de Gradle: {e}")
        return False

if __name__ == "__main__":
    build_android()
