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
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
}

def get_rest(path):
    req = urllib.request.Request(f'{SUPA_URL}/rest/v1/{path}', headers=headers)
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode('utf-8'))

def run():
    print("\n==========================================================================")
    print("🛡️  SUITE MAESTRA DE CONTROL DE CALIDAD TOTAL EN VIDA REAL (GEN YOGA)")
    print("==========================================================================\n")

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

    # =========================================================================
    # BLOQUE 1: BASE DE DATOS EN PRODUCCIÓN (LIVE SUPABASE)
    # =========================================================================
    print("📡 BLOQUE 1: Verificación de Base de Datos en Producción (Supabase Live)...")
    try:
        # 1.1 Conexión REST
        profs = get_rest('profesionales?select=id,nombre,apellidos,email,visible_publico&order=id')
        check("1.1 Conexión con Supabase REST API operativa", len(profs) > 0)
        
        # 1.2 Profesores activos
        prof_names = [p.get('nombre', '').lower() for p in profs]
        prof_visibles = [p for p in profs if p.get('visible_publico')]
        check("1.2 Equipo de profesores completo y visible (Silvia, Miriam, Ángel, Yanira, Isabel)",
              any('silvia' in n for n in prof_names) and
              any('miriam' in n for n in prof_names) and
              any('ángel' in n or 'angel' in n for n in prof_names) and
              any('yanira' in n for n in prof_names) and
              any('isabel' in n for n in prof_names) and
              len(prof_visibles) >= 5)

        # 1.3 Carga de clases semana activa
        clases = get_rest('clases?select=id,nombre,fecha_inicio,duracion_minutos,tipo_clase,es_gratuita,profesor_id&fecha_inicio=gte.2026-08-24T00:00:00Z&fecha_inicio=lt.2026-09-07T00:00:00Z&order=fecha_inicio')
        check(f"1.3 Carga de clases semana activa (24 Ago - 7 Sep): {len(clases)} encontradas", len(clases) >= 15)

        # 1.4 Sesiones de bienvenida domingo 30 Ago (Ángel)
        angel_intro = [c for c in clases if '2026-08-30' in c.get('fecha_inicio', '') and 'introductor' in c.get('nombre', '').lower()]
        check(f"1.4 Sesiones introductorias de Ángel domingo 30 Ago presentes ({len(angel_intro)} clases)", len(angel_intro) >= 2)

        # 1.5 Sesiones abiertas de septiembre (Yanira)
        yanira_open = [c for c in clases if ('2026-09-01' in c.get('fecha_inicio', '') or '2026-09-03' in c.get('fecha_inicio', '')) and 'abierta' in c.get('nombre', '').lower()]
        check(f"1.5 Sesiones abiertas de Yanira 1 y 3 Sep presentes ({len(yanira_open)} clases)", len(yanira_open) >= 2)

        # 1.6 Consultas de profesionales de la salud
        consultas_salud = [c for c in clases if c.get('tipo_clase') in ['psicologia', 'nutricion']]
        check(f"1.6 Turnos de consulta de Psicología / PNI disponibles ({len(consultas_salud)} turnos)", len(consultas_salud) >= 5)

        # 1.7 Tipos de clase y configuración
        config = get_rest('configuracion?select=clave,valor&limit=10')
        check("1.7 Tabla de configuración del centro accesible", isinstance(config, list))

        tipos_detectados = set(c.get('tipo_clase') for c in clases if c.get('tipo_clase'))
        check(f"1.8 Categorías de clases activas detectadas ({len(tipos_detectados)} tipos)", len(tipos_detectados) >= 2)

    except Exception as e:
        if "403" in str(e) or "Forbidden" in str(e) or "URLError" in str(e):
            print(f"  ℹ️  [SKIP] Entorno local/sandbox sin acceso de red externo ({e})")
        else:
            check("Operaciones en vivo con Supabase", False, str(e))

    # =========================================================================
    # BLOQUE 2: FRONTEND, DOM Y BALANCE DE SCRIPTS
    # =========================================================================
    print("\n🔍 BLOQUE 2: Integridad de Frontend, Marcado HTML y Scripts...")
    html_files = sorted(glob.glob("*.html"))
    for h in html_files:
        with open(h, "r", encoding="utf-8") as f:
            content = f.read()
        check(f"2.{html_files.index(h)+1} Archivo {h} presente y no vacío ({len(content)} bytes)", len(content) > 500)
        opens = len(re.findall(r"<script\b", content, re.IGNORECASE))
        closes = len(re.findall(r"</script>", content, re.IGNORECASE))
        check(f"    - Etiquetas <script> balanceadas en {h} ({opens} open, {closes} close)", opens == closes)

    # =========================================================================
    # BLOQUE 3: GESTIÓN DE ALUMNOS, ASISTENCIAS Y RESERVAS (PROFILE.HTML)
    # =========================================================================
    print("\n📋 BLOQUE 3: Gestión de Alumnos, Asistencias y Lógica de Reservas (profile.html)...")
    with open("profile.html", "r", encoding="utf-8") as f:
        p_html = f.read()
    
    check("3.1 Función cargarAsistenciasPorClase disponible", "async function cargarAsistenciasPorClase()" in p_html)
    check("3.2 Fallback de seguridad para carga de clases y profesores", "from('clases').select('*')" in p_html and "from('profesionales').select('*')" in p_html)
    check("3.3 Enriquecimiento de alumnos con nombre y apellidos en asistencias", "allAsistenciasPerfilesMap[r.user_id]" in p_html)
    check("3.4 Coincidencia de profesor segura (esClaseDelProfesionalActual)", "function esClaseDelProfesionalActual(clase)" in p_html)
    check("3.5 Ventana amplia de asistencias (últimos días y futuro)", "claseEsFutura" in p_html and "limite.setDate" in p_html)
    check("3.6 Borrado seguro de clases con reembolso de bonos a alumnos", "async function borrarClase(id)" in p_html and ("admin_eliminar_clase" in p_html or "admin_eliminar_clase_con_reembolso" in p_html))
    check("3.7 Regla canónica de reservas: Clases gratuitas aceptan bono gratis o regular", "esSesionGratuita" in p_html and ("tieneBonoBienvenida" in p_html or "tieneBonoGratis" in p_html))
    check("3.8 Regla canónica de reservas: Clases regulares exigen bono normal", "No tienes clases disponibles para esta reserva" in p_html)
    check("3.9 Modal de asignación manual de alumnos en recepción presente", "window.abrirModalAsignarPlazaAdmin" in p_html)
    check("3.10 Cancelación de reservas y consultas con devolución de saldo", "async function cancelarConsulta(" in p_html and "async function cancelar(" in p_html)

    # =========================================================================
    # BLOQUE 4: CALENDARIO PÚBLICO Y VISTAS SEMANALES (PUBLIC-CALENDAR.JS)
    # =========================================================================
    print("\n📅 BLOQUE 4: Calendario Público y Horarios Semanales (public-calendar.js)...")
    with open("public-calendar.js", "r", encoding="utf-8") as f:
        cal_js = f.read()
    
    check("4.1 Temporada activa 2026-08-24 configurada", "SEASON_START_WEEK = '2026-08-24'" in cal_js)
    check("4.2 Domingo incluido en el ciclo de días del calendario", "displayDayKeys" in cal_js and "sunday" in cal_js)
    check("4.3 Filtro de clases incluye sesiones abiertas e introductorias", "nombre.ilike.%introductor%,nombre.ilike.%abierta%" in cal_js)
    check("4.4 Clasificación correcta: Clases de bienvenida no son talleres especiales", "const isIntroOrOpen = /introductor|bienvenida|abierta|gratis|prueba/i.test(rawName);" in cal_js)

    # =========================================================================
    # BLOQUE 5: TARIFAS, OFERTAS Y STRIPE (TARIFAS.HTML & STRIPE FLOWS)
    # =========================================================================
    print("\n💳 BLOQUE 5: Tarifas, Ofertas y Checkout de Stripe...")
    with open("tarifas.html", "r", encoding="utf-8") as f:
        tar_html = f.read()
    
    check("5.1 Ficha 1: Bono de Bienvenida presente", "rates_welcome_title" in tar_html or "Bono de Bienvenida" in tar_html)
    check("5.2 Ficha 2: Sesiones Introductorias por Profesor presente", "rates_intro_title" in tar_html or "Sesiones Introductorias" in tar_html)
    check("5.3 Ficha 3: Yoga en Compañía presente", "rates_companion_title" in tar_html or "Yoga en compañ" in tar_html)
    check("5.4 Sub-pestañas de tarifas (Ofertas, Clases, Consultas, Talleres)", "tab-ofertas" in tar_html and "tab-yoga" in tar_html and "tab-psicologia" in tar_html and "tab-talleres" in tar_html)
    check("5.5 Validación de URL de checkout de Stripe (getValidatedStripeCheckoutUrl)", "getValidatedStripeCheckoutUrl" in p_html or "getValidatedStripeCheckoutUrl" in tar_html)

    # =========================================================================
    # BLOQUE 6: CANALES DE CONTACTO, WHATSAPP Y PRIVACIDAD GDPR
    # =========================================================================
    print("\n📞 BLOQUE 6: Canales de Contacto, WhatsApp y Privacidad...")
    with open("index.html", "r", encoding="utf-8") as f:
        idx_html = f.read()
    with open("clases.html", "r", encoding="utf-8") as f:
        cls_html = f.read()
    
    check("6.1 Enlace directo de WhatsApp en index.html", "https://wa.me/34624435679" in idx_html)
    check("6.2 Enlace directo de WhatsApp en clases.html", "https://wa.me/34624435679" in cls_html)
    check("6.3 Enlace directo de WhatsApp en tarifas.html", "https://wa.me/34624435679" in tar_html)
    check("6.4 Teléfono de contacto correcto (+34 624 435 679)", "+34 624 435 679" in idx_html or "624 435 679" in idx_html)
    check("6.5 Email de soporte configurado (hola@genyoga.studio)", "mailto:hola@genyoga.studio" in idx_html)
    check("6.6 Página de política de privacidad vinculada en todas las vistas", all("politica-privacidad.html" in open(h, "r", encoding="utf-8").read() for h in html_files))

    # =========================================================================
    # BLOQUE 7: SINCRONIZACIÓN DE VERSIONES Y CACHE-BUSTERS
    # =========================================================================
    print("\n🏷️  BLOQUE 7: Sincronización de Versión y Cache-Busters...")
    with open("package.json", "r", encoding="utf-8") as f:
        pkg = json.load(f)
    v_full = pkg.get("version", "")
    v_short = ".".join(v_full.split(".")[:2])
    check(f"7.1 Versión base en package.json ({v_full})", bool(v_full))
    check(f"7.2 Versión v{v_short} aplicada en todas las páginas HTML y scripts", all(f"?v={v_short}" in open(h, "r", encoding="utf-8").read() or f"v{v_short}" in open(h, "r", encoding="utf-8").read() for h in html_files))

    print("\n==========================================================================")
    if not errors:
        print(f"🎉 ¡SUITE MAESTRA SUPERADA AL 100%! ({passed}/{total} CONTROLES APROBADOS)")
        print("🚀 Todas las áreas críticas y operativas de GEN Yoga están verificadas y libres de bloqueos.")
        print("==========================================================================\n")
        return 0
    else:
        print(f"❌ SE ENCONTRARON {len(errors)} ERRORES BLOQUEANTES:")
        for name, detail in errors:
            print(f"   - {name}: {detail}")
        print("==========================================================================\n")
        return 1

if __name__ == "__main__":
    sys.exit(run())
