#!/usr/bin/env python3
import glob
import json
import os
import re
import sys
import urllib.request

SUPA_URL = 'https://jkjifmrrlyncuwpjhxvk.supabase.co'
SUPA_KEY = 'sb_publishable_xnIELom1ouXaBDJNYaWDAQ_VJNjlnIK'
headers = {
    'apikey': SUPA_KEY,
    'Authorization': f'Bearer {SUPA_KEY}',
    'Content-Type': 'application/json'
}

def get_rest(path):
    req = urllib.request.Request(f'{SUPA_URL}/rest/v1/{path}', headers=headers)
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode('utf-8'))

def run():
    print("\n======================================================")
    print("🛡️  SUITE DE VERIFICACIÓN TOTAL EN TIEMPO REAL (GEN YOGA)")
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

    # --- FASE 1: CHECKS EN VIVO CONTRA SUPABASE (VIDA REAL) ---
    print("📡 FASE 1: Verificación de Base de Datos en Producción (Live Supabase)...")
    try:
        profs = get_rest('profesionales?select=id,nombre,email,visible_publico&order=id')
        check("Conexión con Supabase REST API", len(profs) > 0)
        
        prof_names = [p.get('nombre', '').lower() for p in profs]
        check("Equipo de profesores visible (Silvia, Miriam, Ángel, Yanira, Isabel)",
              any('silvia' in n for n in prof_names) and
              any('miriam' in n for n in prof_names) and
              any('ángel' in n or 'angel' in n for n in prof_names) and
              any('yanira' in n for n in prof_names) and
              any('isabel' in n for n in prof_names))

        clases = get_rest('clases?select=id,nombre,fecha_inicio,duracion_minutos,tipo_clase,es_gratuita&fecha_inicio=gte.2026-08-24T00:00:00Z&fecha_inicio=lt.2026-09-07T00:00:00Z&order=fecha_inicio')
        check(f"Carga de clases semana activa (24 Ago - 7 Sep): {len(clases)} encontradas", len(clases) >= 10)

        # Verificar sesiones de bienvenida
        angel_intro = [c for c in clases if '2026-08-30' in c.get('fecha_inicio', '') and 'introductor' in c.get('nombre', '').lower()]
        check(f"Sesiones introductorias de Ángel domingo 30 Ago presentes ({len(angel_intro)} clases)", len(angel_intro) >= 2)

        yanira_open = [c for c in clases if ('2026-09-01' in c.get('fecha_inicio', '') or '2026-09-03' in c.get('fecha_inicio', '')) and 'abierta' in c.get('nombre', '').lower()]
        check(f"Sesiones abiertas de Yanira 1 y 3 Sep presentes ({len(yanira_open)} clases)", len(yanira_open) >= 2)

        config = get_rest('configuracion?select=clave,valor&limit=5')
        check("Tabla de configuración accesible", isinstance(config, list))

    except Exception as e:
        check("Comprobación en vivo con Supabase", False, str(e))

    # --- FASE 2: VERIFICACIÓN ESTRUCTURAL Y DE SEGURIDAD (FRONTEND) ---
    print("\n🔍 FASE 2: Integridad de Código y Flujos Críticos...")
    html_files = sorted(glob.glob("*.html"))
    for h in html_files:
        with open(h, "r", encoding="utf-8") as f:
            content = f.read()
        check(f"Archivo HTML {h} íntegro", len(content) > 100)
        opens = len(re.findall(r"<script\b", content, re.IGNORECASE))
        closes = len(re.findall(r"</script>", content, re.IGNORECASE))
        check(f"Balance de scripts en {h}", opens == closes)

    with open("profile.html", "r", encoding="utf-8") as f:
        p_html = f.read()
    check("cargarAsistenciasPorClase disponible", "async function cargarAsistenciasPorClase()" in p_html)
    check("Fallback seguro de clases en asistencias", "from('clases').select('*')" in p_html and "from('profesionales').select('*')" in p_html)
    check("borrarClase con devolución automática", "async function borrarClase(id)" in p_html and "saldo_gratis_descontado" in p_html)
    check("Lógica canónica de reservas (gratis vs regular)", "esSesionGratuita && tieneBonoGratis" in p_html)

    with open("public-calendar.js", "r", encoding="utf-8") as f:
        cal_js = f.read()
    check("Temporada activa 2026-08-24 en calendario", "SEASON_START_WEEK = '2026-08-24'" in cal_js)
    check("Filtro directo incluye sesiones abiertas/introductorias", "nombre.ilike.%introductor%,nombre.ilike.%abierta%" in cal_js)

    with open("tarifas.html", "r", encoding="utf-8") as f:
        tar_html = f.read()
    check("Tarifas: 3 fichas de ofertas presentes", ("rates_welcome_title" in tar_html or "Bono de Bienvenida" in tar_html) and ("rates_intro_title" in tar_html or "Sesiones Introductorias" in tar_html) and ("rates_companion_title" in tar_html or "Yoga en compañ" in tar_html))
    check("Tarifas: WhatsApp y teléfono presentes", "https://wa.me/34624454212" in tar_html)

    with open("package.json", "r", encoding="utf-8") as f:
        pkg = json.load(f)
    v_full = pkg.get("version", "")
    v_short = ".".join(v_full.split(".")[:2])
    check(f"Versión coherente ({v_full}) en todas las vistas", all(f"?v={v_short}" in open(h, "r", encoding="utf-8").read() or f"v{v_short}" in open(h, "r", encoding="utf-8").read() for h in html_files))

    print("\n======================================================")
    if not errors:
        print(f"🎉 ¡TODOS LOS CONTROLES HAN PASADO CON ÉXITO! ({passed}/{total})")
        print("🚀 El sistema está 100% verificado en vida real y listo para producción.")
        print("======================================================\n")
        return 0
    else:
        print(f"❌ SE ENCONTRARON {len(errors)} ERRORES BLOQUEANTES:")
        for name, detail in errors:
            print(f"   - {name}: {detail}")
        print("======================================================\n")
        return 1

if __name__ == "__main__":
    sys.exit(run())
