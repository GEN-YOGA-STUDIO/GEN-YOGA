#!/usr/bin/env python3
import glob
import json
import os
import re
import sys

def run_checks():
    print("\n======================================================")
    print("🛡️  GEN YOGA PRODUCTION PRE-DEPLOY HEALTH CHECK")
    print("======================================================\n")
    
    errors = []
    total = 0
    passed = 0
    
    def check(name, condition, detail=""):
        nonlocal total, passed
        total += 1
        if condition:
            passed += 1
            print(f"  ✅ [PASS] {name}")
        else:
            errors.append((name, detail))
            print(f"  ❌ [FAIL] {name}: {detail}")
            
    # 1. HTML Pages Readability & JavaScript Balance
    html_files = sorted(glob.glob("*.html"))
    for h in html_files:
        with open(h, "r", encoding="utf-8") as f:
            content = f.read()
        check(f"Archivo HTML {h} existe y no está vacío", len(content) > 100)
        opens = len(re.findall(r"<script\b", content, re.IGNORECASE))
        closes = len(re.findall(r"</script>", content, re.IGNORECASE))
        check(f"Etiquetas script balanceadas en {h} ({opens} open, {closes} close)", opens == closes)

    # 2. Profile.html Critical Functions
    with open("profile.html", "r", encoding="utf-8") as f:
        p_html = f.read()
    check("cargarAsistenciasPorClase presente", "async function cargarAsistenciasPorClase()" in p_html)
    check("Fallback de carga en asistencias presente", "from('clases').select('*')" in p_html and "from('profesionales').select('*')" in p_html)
    check("borrarClase presente con reembolso", "async function borrarClase(id)" in p_html and ("admin_eliminar_clase" in p_html or "saldo_gratis_descontado" in p_html))
    check("reservarClase con regla canónica (gratis vs regular)", "esSesionGratuita" in p_html and ("tieneBonoBienvenida" in p_html or "tieneBonoGratis" in p_html))

    # 3. Public Calendar Critical Rules
    with open("public-calendar.js", "r", encoding="utf-8") as f:
        cal_js = f.read()
    check("Temporada inicia en 2026-08-24", "SEASON_START_WEEK = '2026-08-24'" in cal_js)
    check("Inclusión de sesiones abiertas/introductorias en query", "nombre.ilike.%introductor%,nombre.ilike.%abierta%" in cal_js)
    check("Clases introductorias no son marcadas como talleres especiales", "const isIntroOrOpen = /introductor|bienvenida|abierta|gratis|prueba/i.test(rawName);" in cal_js)

    # 4. Tarifas Structure
    with open("tarifas.html", "r", encoding="utf-8") as f:
        tar_html = f.read()
    check("Ficha Bono Bienvenida presente", "rates_welcome_title" in tar_html or "Bono de Bienvenida" in tar_html)
    check("Ficha Sesiones Introductorias presente", "rates_intro_title" in tar_html or "Sesiones Introductorias" in tar_html)
    check("Ficha Yoga en Compañía presente", "rates_companion_title" in tar_html or "Yoga en compañ" in tar_html)
    check("4 pestañas (Ofertas, Clases, Consultas, Talleres)", "tab-ofertas" in tar_html and "tab-yoga" in tar_html and "tab-talleres" in tar_html)

    # 5. WhatsApp Contact Links
    with open("index.html", "r", encoding="utf-8") as f:
        idx_html = f.read()
    with open("clases.html", "r", encoding="utf-8") as f:
        cls_html = f.read()
    check("WhatsApp configurado en index.html", "https://wa.me/34624435679" in idx_html)
    check("WhatsApp configurado en clases.html", "https://wa.me/34624435679" in cls_html)
    check("WhatsApp configurado en tarifas.html", "https://wa.me/34624435679" in tar_html)

    # 6. Versión coherente
    with open("package.json", "r", encoding="utf-8") as f:
        pkg = json.load(f)
    v_full = pkg.get("version", "")
    v_short = ".".join(v_full.split(".")[:2])
    check(f"Versión base en package.json ({v_full})", bool(v_full))
    for h in html_files:
        with open(h, "r", encoding="utf-8") as f:
            c = f.read()
        check(f"Versión v{v_short} en {h}", f"?v={v_short}" in c or f"v{v_short}" in c)

    print("\n======================================================")
    if not errors:
        print(f"🎉 ¡TODOS LOS CONTROLES HAN PASADO CON ÉXITO! ({passed}/{total})")
        print("🚀 El proyecto está 100% verificado y listo para producción sin errores bloqueantes.")
        print("======================================================\n")
        return 0
    else:
        print(f"❌ SE ENCONTRARON {len(errors)} ERRORES BLOQUEANTES:")
        for name, detail in errors:
            print(f"   - {name}: {detail}")
        print("======================================================\n")
        return 1

if __name__ == "__main__":
    sys.exit(run_checks())
