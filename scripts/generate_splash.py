#!/usr/bin/env python3
"""
scripts/generate_splash.py
Genera las pantallas de inicio (Splash Screens) de GEN Yoga para iOS y Android
usando el logo oficial sobre el fondo corporativo #26160c.
"""
import os
import glob
from PIL import Image

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO_PATH = os.path.join(BASE_DIR, 'img', 'logo1.webp')
BG_COLOR = (38, 22, 12, 255) # #26160c

def create_splash_image(width, height, is_portrait=None):
    logo = Image.open(LOGO_PATH).convert('RGBA')
    bbox = logo.split()[-1].getbbox()
    logo_cropped = logo.crop(bbox)

    if is_portrait is None:
        is_portrait = height >= width

    if is_portrait:
        # En vertical, logo ocupa ~46% del ancho
        target_w = int(width * 0.46)
        target_h = int(logo_cropped.height * (target_w / logo_cropped.width))
        if target_h > int(height * 0.4):
            target_h = int(height * 0.4)
            target_w = int(logo_cropped.width * (target_h / logo_cropped.height))
    else:
        # En horizontal, logo ocupa ~34% del alto
        target_h = int(height * 0.34)
        target_w = int(logo_cropped.width * (target_h / logo_cropped.height))
        if target_w > int(width * 0.5):
            target_w = int(width * 0.5)
            target_h = int(logo_cropped.height * (target_w / logo_cropped.width))

    target_w = max(target_w, 10)
    target_h = max(target_h, 10)

    logo_resized = logo_cropped.resize((target_w, target_h), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (width, height), BG_COLOR)

    pos_x = (width - target_w) // 2
    pos_y = (height - target_h) // 2
    canvas.paste(logo_resized, (pos_x, pos_y), mask=logo_resized)
    return canvas.convert('RGB')

def main():
    print("🎨 Generando Splash Screens oficiales de GEN Yoga (#26160c + logo1.webp)...")

    # 1. iOS Splash (2732 x 2732 universal)
    ios_splash_targets = [
        os.path.join(BASE_DIR, 'app ios', 'ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset', 'splash-2732x2732.png'),
        os.path.join(BASE_DIR, 'app ios', 'ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset', 'splash-2732x2732-1.png'),
        os.path.join(BASE_DIR, 'app ios', 'ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset', 'splash-2732x2732-2.png'),
        os.path.join(BASE_DIR, 'ultima version', 'app ios', 'ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset', 'splash-2732x2732.png'),
        os.path.join(BASE_DIR, 'ultima version', 'app ios', 'ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset', 'splash-2732x2732-1.png'),
        os.path.join(BASE_DIR, 'ultima version', 'app ios', 'ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset', 'splash-2732x2732-2.png'),
    ]

    ios_img = create_splash_image(2732, 2732, is_portrait=True)
    for target in ios_splash_targets:
        if os.path.exists(os.path.dirname(target)):
            ios_img.save(target, 'PNG', optimize=True)
            print(f"  ✅ iOS: {os.path.relpath(target, BASE_DIR)}")

    # 2. Android Splash (múltiples densidades)
    android_roots = [
        os.path.join(BASE_DIR, 'app android', 'android', 'app', 'src', 'main', 'res'),
        os.path.join(BASE_DIR, 'ultima version', 'app android', 'android', 'app', 'src', 'main', 'res'),
    ]

    for aroot in android_roots:
        if not os.path.exists(aroot):
            continue
        for splash_file in glob.glob(os.path.join(aroot, 'drawable*', 'splash.png')):
            # Leer dimensiones actuales del asset
            with Image.open(splash_file) as curr:
                w, h = curr.size
            is_port = 'port' in os.path.basename(os.path.dirname(splash_file)) or (h >= w and 'land' not in os.path.basename(os.path.dirname(splash_file)))
            new_splash = create_splash_image(w, h, is_portrait=is_port)
            new_splash.save(splash_file, 'PNG', optimize=True)
            print(f"  ✅ Android: {os.path.relpath(splash_file, BASE_DIR)} ({w}x{h})")

    print("🎉 Splash Screens generadas correctamente en iOS y Android.")

if __name__ == '__main__':
    main()
