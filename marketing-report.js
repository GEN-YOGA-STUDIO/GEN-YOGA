/* marketing-report.js — v15.0 Informe marketing para RRSS/estrategia.
 * Botón del Dashboard Ejecutivo (solo admin): descarga Excel multi-hoja
 * (SheetJS) o PDF (vista de impresión) con datos agregados de Supabase.
 * SOLO LECTURA y SIN DATOS PERSONALES: ni emails, ni nombres de clientas,
 * ni teléfonos. Los nombres de profesoras son públicos (maestros.html).
 * Script clásico (sin import/export) para WebView iOS/Android.
 */
(function () {
  'use strict';

  var REPORT_VERSION = '15.0';
  var FETCH_LIMIT = 10000;

  // Interruptor del informe marketing: en false los botones están ocultos y la
  // descarga bloqueada (ni siquiera por consola). Para activarlo, poner true.
  var INFORME_MARKETING_ENABLED = true;

  // Tablas que el informe puede leer. El resto está prohibido por construcción.
  var ALLOWED_SOURCES = [
    'profiles', 'clases', 'profesionales', 'tipos_clases',
    'reservas_yoga', 'reservas_psicologia', 'reservas_nutricion', 'reservas_talleres',
    'stripe_purchases', 'class_credit_packs', 'unlimited_membership_periods',
    'ofertas_canjeadas', 'stripe_productos', 'bonos_clases_especiales'
  ];

  function getClient() {
    try {
      // `client` es el cliente Supabase global de profile.html.
      // eslint-disable-next-line no-undef
      if (typeof client !== 'undefined' && client) return client;
    } catch (_) { /* noop */ }
    return null;
  }

  // Informe ÚNICO: siempre los últimos 30 días a fecha de generación.
  // No depende del filtro del dashboard (7/14/30/todo) a propósito.
  function getRange() {
    return '30d';
  }

  function rangeStart(range) {
    var days = range === '7d' ? 7 : range === '30d' ? 30 : range === 'all' ? 0 : 14;
    if (!days) return null;
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (days - 1));
    return d;
  }

  // Negocio en Madrid, BD en UTC: formateo explícito Europe/Madrid
  // (recortar el ISO en crudo mostraría la hora UTC: 05:00 en vez de 07:00).
  var MADRID_TZ = 'Europe/Madrid';

  function madridShifted(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return new Date(d.toLocaleString('en-US', { timeZone: MADRID_TZ }));
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-ES', { timeZone: MADRID_TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function fmtMonth(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-ES', { timeZone: MADRID_TZ, month: 'long', year: 'numeric' });
  }

  function fmtTime(iso) {
    if (!iso) return '--:--';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString('es-ES', { timeZone: MADRID_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function monthKey(iso) {
    var m = madridShifted(iso);
    if (!m) return '';
    return m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0');
  }

  function weekdayEs(iso) {
    var m = madridShifted(iso);
    if (!m) return '';
    var s = m.toLocaleDateString('es-ES', { weekday: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function slotEs(iso) {
    var m = madridShifted(iso);
    if (!m) return '';
    var h = m.getHours();
    if (h < 13) return 'Mañana';
    if (h < 19) return 'Tarde';
    return 'Noche';
  }

  function verticalOfClase(c) {
    var t = String((c && c.tipo_clase) || 'yoga').toLowerCase();
    if (t === 'psicologia') return 'Psicología';
    if (t === 'nutricion') return 'Nutrición';
    if (t === 'taller' || t === 'clase_especial' || (c && c.es_especial === true)) return 'Talleres';
    return 'Yoga';
  }

  function euros(cents) {
    var n = Number(cents || 0) / 100;
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  function fileStamp() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function swalError(title, text) {
    if (window.Swal && window.Swal.fire) {
      window.Swal.fire({ icon: 'error', title: title, text: text, confirmButtonColor: '#795244' });
    } else {
      window.alert(title + ': ' + text);
    }
  }

  // ------------------------------------------------------------------
  // Capa de datos: todo con Promise.allSettled; cada fuente informa su estado.
  // ------------------------------------------------------------------
  async function fetchReportData(range) {
    var sb = getClient();
    if (!sb) throw new Error('Sin conexión con la base de datos (cliente Supabase no disponible).');
    var start = rangeStart(range);
    var startIso = start ? start.toISOString() : null;

    function q(table, select, orderCol, dateCol) {
      // Paginado: PostgREST/Supabase topa en 1000 filas por petición; sin
      // paginar, las tablas grandes (clases) salían TRUNCADAS y todos los
      // agregados por clase/profesora quedaban mal.
      var pageSize = 1000;
      var all = [];
      var fetchPage = function (offset) {
        var query = sb.from(table).select(select);
        if (dateCol && startIso) query = query.gte(dateCol, startIso);
        if (orderCol) query = query.order(orderCol, { ascending: true });
        return query.range(offset, offset + pageSize - 1).then(function (res) {
          if (res.error) throw res.error;
          var rows = res.data || [];
          all = all.concat(rows);
          if (rows.length === pageSize) return fetchPage(offset + pageSize);
          return { table: table, rows: all, status: 'ok' };
        });
      };
      return fetchPage(0).then(
        function (ok) { return ok; },
        function (err) {
          return { table: table, rows: [], status: 'error: ' + ((err && err.message) || err) };
        }
      );
    }

    var jobs = [
      q('profiles', 'id,created_at,rol,oferta_bienvenida_canjeada,codigo_promo_usado,bono_mensual_activo,stripe_subscription_status', 'created_at', 'created_at'),
      q('clases', 'id,nombre,fecha_inicio,fecha_fin,capacidad_max,profesor_id,tipo_clase,activa,es_especial', 'fecha_inicio', 'fecha_inicio'),
      q('profesionales', 'id,nombre,apellidos,especialidad', 'nombre', null),
      q('reservas_yoga', 'id,clase_id,user_id,created_at,estado,num_plazas', 'created_at', 'created_at'),
      q('reservas_psicologia', 'id,clase_id,user_id,created_at,estado', 'created_at', 'created_at'),
      q('reservas_nutricion', 'id,clase_id,user_id,created_at,estado', 'created_at', 'created_at'),
      q('reservas_talleres', 'id,clase_id,user_id,created_at,estado', 'created_at', 'created_at'),
      q('stripe_purchases', 'purchase_type,price_id,amount_total,currency,payment_status,fulfilled_at,created_at,is_guest', 'created_at', 'created_at'),
      q('class_credit_packs', 'pack_type,credits_total,credits_remaining,purchased_at,expires_at', 'purchased_at', 'purchased_at'),
      q('unlimited_membership_periods', 'membership_month,starts_at,ends_at,purchased_at', 'membership_month', 'purchased_at'),
      q('ofertas_canjeadas', 'tipo_oferta,canjeado_el', 'canjeado_el', 'canjeado_el'),
      q('stripe_productos', 'nombre,unit_amount,currency,categoria,activo', 'nombre', null),
      q('bonos_clases_especiales', 'mes,saldo,origen,created_at', 'created_at', 'created_at')
    ];

    var results = await Promise.all(jobs);
    var data = {};
    results.forEach(function (r) { data[r.table] = r; });
    return data;
  }

  // ------------------------------------------------------------------
  // Agregados para marketing.
  // ------------------------------------------------------------------
  function buildReport(data, range) {
    var now = new Date();
    var get = function (t) { return (data[t] && data[t].rows) || []; };
    var clases = get('clases');
    var profes = get('profesionales');
    var profName = {};
    profes.forEach(function (p) {
      profName[p.id] = ((p.nombre || '') + ' ' + (p.apellidos || '')).trim() || ('Profe #' + p.id);
    });

    var profiles = get('profiles');
    var clients = profiles.filter(function (u) {
      var r = String(u.rol || 'user').toLowerCase().trim();
      return ['admin', 'profesor', 'trabajador'].indexOf(r) < 0;
    });

    var resYoga = get('reservas_yoga');
    var resPsi = get('reservas_psicologia');
    var resNut = get('reservas_nutricion');
    var resTal = get('reservas_talleres');

    // VERDAD TERRENA: la ocupación sale de las reservas confirmadas, NO de la
    // columna clases.plazas_reservadas (no se mantiene: sale 0 en clases con
    // 8 reservas reales). Mapa clase_id -> plazas confirmadas.
    var occPlazas = {};
    resYoga.forEach(function (r) {
      if (String(r.estado || 'confirmada') === 'cancelada' || r.clase_id == null) return;
      occPlazas[r.clase_id] = (occPlazas[r.clase_id] || 0) + Number(r.num_plazas || 1);
    });
    var occCountPsi = {}, occCountNut = {}, occCountTal = {};
    resPsi.forEach(function (r) {
      if (String(r.estado || 'confirmada') !== 'cancelada' && r.clase_id != null) {
        occCountPsi[r.clase_id] = (occCountPsi[r.clase_id] || 0) + 1;
      }
    });
    resNut.forEach(function (r) {
      if (String(r.estado || 'confirmada') !== 'cancelada' && r.clase_id != null) {
        occCountNut[r.clase_id] = (occCountNut[r.clase_id] || 0) + 1;
      }
    });
    resTal.forEach(function (r) {
      if (String(r.estado || 'confirmada') !== 'cancelada' && r.clase_id != null) {
        occCountTal[r.clase_id] = (occCountTal[r.clase_id] || 0) + Number(r.num_plazas || 1);
      }
    });

    // Retención y funnel por clienta (todas las verticales).
    var userConf = {};
    [resYoga, resPsi, resNut, resTal].forEach(function (rows) {
      rows.forEach(function (r) {
        if (String(r.estado || 'confirmada') === 'cancelada' || r.user_id == null) return;
        userConf[r.user_id] = (userConf[r.user_id] || 0) + 1;
      });
    });
    var idsActivas = Object.keys(userConf);
    var rep2 = idsActivas.filter(function (id) { return userConf[id] >= 2; }).length;
    var n1 = idsActivas.filter(function (id) { return userConf[id] === 1; }).length;
    var n24 = idsActivas.filter(function (id) { return userConf[id] >= 2 && userConf[id] <= 4; }).length;
    var n5 = idsActivas.filter(function (id) { return userConf[id] >= 5; }).length;

    function splitEstado(rows) {
      var conf = 0, canc = 0, plazas = 0;
      rows.forEach(function (r) {
        if (String(r.estado || 'confirmada') === 'cancelada') canc++;
        else { conf++; plazas += Number(r.num_plazas || 1); }
      });
      return { conf: conf, canc: canc, plazas: plazas };
    }
    var yogaSt = splitEstado(resYoga);
    var psiSt = splitEstado(resPsi);
    var nutSt = splitEstado(resNut);
    var talSt = splitEstado(resTal);
    var totalConf = yogaSt.conf + psiSt.conf + nutSt.conf + talSt.conf;
    var totalCanc = yogaSt.canc + psiSt.canc + nutSt.canc + talSt.canc;

    // Altas por mes.
    var byMonth = {};
    clients.forEach(function (u) {
      if (!u.created_at) return;
      var k = monthKey(u.created_at);
      byMonth[k] = (byMonth[k] || 0) + 1;
    });
    var months = Object.keys(byMonth).sort();
    var acc = 0;
    var altasRows = months.map(function (k) {
      acc += byMonth[k];
      return [fmtMonth(k + '-01'), byMonth[k], acc];
    });

    // Ocupación por clase (solo yoga/talleres con fecha).
    var claseById = {};
    clases.forEach(function (c) { claseById[c.id] = c; });
    var ocupRows = [];
    var ocupSum = 0, ocupN = 0;
    clases.forEach(function (c) {
      if (!c.fecha_inicio) return;
      var v = verticalOfClase(c);
      if (v === 'Psicología' || v === 'Nutrición') return;
      var cap = Number(c.capacidad_max || 10);
      var ocu = occPlazas[c.id] || 0;
      var pct = cap > 0 ? Math.round((ocu / cap) * 100) : 0;
      ocupSum += pct; ocupN++;
      ocupRows.push([fmtDate(c.fecha_inicio), fmtTime(c.fecha_inicio), c.nombre || 'Sesión', profName[c.profesor_id] || '—', v, cap, ocu, pct + ' %']);
    });
    ocupRows.sort(function (a, b) { return b[7] - a[7]; });
    var ocupMedia = ocupN > 0 ? Math.round(ocupSum / ocupN) : 0;

    // Horarios estrella: reservas confirmadas de yoga por día × franja.
    var heat = {};
    resYoga.forEach(function (r) {
      if (String(r.estado || 'confirmada') === 'cancelada') return;
      var c = claseById[r.clase_id];
      if (!c || !c.fecha_inicio) return;
      var key = weekdayEs(c.fecha_inicio) + '|' + slotEs(c.fecha_inicio);
      heat[key] = (heat[key] || 0) + Number(r.num_plazas || 1);
    });
    var orderDia = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    var heatRows = Object.keys(heat).map(function (k) {
      var parts = k.split('|');
      return [parts[0], parts[1], heat[k]];
    }).sort(function (a, b) {
      var d = orderDia.indexOf(a[0]) - orderDia.indexOf(b[0]);
      return d !== 0 ? d : b[2] - a[2];
    });

    // Profesoras (ocupación desde reservas reales).
    var profRows = profes.map(function (p) {
      var mine = clases.filter(function (c) { return c.profesor_id === p.id && c.fecha_inicio; });
      var plazas = 0, cap = 0;
      mine.forEach(function (c) {
        plazas += occPlazas[c.id] || 0;
        cap += Number(c.capacidad_max || 10);
      });
      return [((p.nombre || '') + ' ' + (p.apellidos || '')).trim(), p.especialidad || '—', mine.length, plazas + '/' + cap, cap > 0 ? Math.round((plazas / cap) * 100) + ' %' : '—'];
    });

    // Ventas.
    var purchases = get('stripe_purchases');
    var ingresosCents = 0, ingresosN = 0;
    var ventasRows = purchases.map(function (s) {
      var paid = String(s.payment_status || '').toLowerCase() === 'paid';
      if (paid) { ingresosCents += Number(s.amount_total || 0); ingresosN++; }
      return [fmtDate(s.fulfilled_at || s.created_at), s.purchase_type || '—', euros(s.amount_total), s.currency || 'eur', paid ? 'Cobrado' : String(s.payment_status || '—'), s.is_guest ? 'Invitada' : 'Clienta'];
    });
    // Ingresos por tipo + ticket medio.
    var revByType = {};
    purchases.forEach(function (s) {
      if (String(s.payment_status || '').toLowerCase() !== 'paid') return;
      var k = s.purchase_type || '—';
      revByType[k] = revByType[k] || { n: 0, cents: 0 };
      revByType[k].n++;
      revByType[k].cents += Number(s.amount_total || 0);
    });
    var revTipoRows = Object.keys(revByType).map(function (k) {
      return [k, revByType[k].n, euros(revByType[k].cents), euros(revByType[k].cents / revByType[k].n)];
    }).sort(function (a, b) { return revByType[b[0]].cents - revByType[a[0]].cents; });
    var ticketMedio = ingresosN > 0 ? ingresosCents / ingresosN : 0;

    // Consultas por profesional (quién atrae cada especialidad).
    var consProMap = {};
    function addCons(rows, esp) {
      rows.forEach(function (r) {
        if (String(r.estado || 'confirmada') === 'cancelada') return;
        var c = claseById[r.clase_id];
        if (!c) return;
        var key = (profName[c.profesor_id] || '—') + '|' + esp;
        consProMap[key] = (consProMap[key] || 0) + 1;
      });
    }
    addCons(resPsi, 'Psicología');
    addCons(resNut, 'Nutrición');
    var consProRows = Object.keys(consProMap).map(function (k) {
      var parts = k.split('|');
      return [parts[0], parts[1], consProMap[k]];
    }).sort(function (a, b) { return b[2] - a[2]; });

    // Packs y membresías.
    var packs = get('class_credit_packs');
    var packByType = {};
    packs.forEach(function (p) {
      var k = p.pack_type || '—';
      packByType[k] = packByType[k] || { n: 0, cred: 0, disp: 0 };
      packByType[k].n++;
      packByType[k].cred += Number(p.credits_total || 0);
      packByType[k].disp += Number(p.credits_remaining || 0);
    });
    var packsRows = Object.keys(packByType).map(function (k) {
      return [k, packByType[k].n, packByType[k].cred, packByType[k].disp];
    });
    var membs = get('unlimited_membership_periods');
    var membAct = membs.filter(function (m) { return m.ends_at && new Date(m.ends_at) >= now; }).length;

    // Ofertas.
    var ofertas = get('ofertas_canjeadas');
    var ofByType = {};
    ofertas.forEach(function (o) {
      var k = o.tipo_oferta || '—';
      ofByType[k] = (ofByType[k] || 0) + 1;
    });
    var ofertasRows = Object.keys(ofByType).map(function (k) { return [k, ofByType[k]]; });

    // Consultas por especialidad.
    var consRows = [
      ['Psicología', psiSt.conf, psiSt.canc],
      ['Nutrición', nutSt.conf, nutSt.canc]
    ];

    // Retención y funnel (marketing: ¿vuelven? ¿por dónde entran?).
    var pctOf = function (n, d) { return d > 0 ? Math.round((n / d) * 100) + ' %' : '—'; };
    var retRows = [
      ['Sin reservas', clients.length - idsActivas.length, pctOf(clients.length - idsActivas.length, clients.length)],
      ['Con 1 reserva', n1, pctOf(n1, clients.length)],
      ['Con 2-4 reservas', n24, pctOf(n24, clients.length)],
      ['Con 5 o más', n5, pctOf(n5, clients.length)]
    ];
    var flagCount = function (f) { return clients.filter(function (u) { return u[f] === true; }).length; };
    var funnelRows = [
      ['Clientas totales', clients.length, '—'],
      ['Con al menos 1 reserva', idsActivas.length, pctOf(idsActivas.length, clients.length)],
      ['Repetidoras (2+ reservas)', rep2, pctOf(rep2, clients.length)],
      ['Bienvenida canjeada', flagCount('oferta_bienvenida_canjeada'), pctOf(flagCount('oferta_bienvenida_canjeada'), clients.length)],
      ['Promo canjeada', flagCount('codigo_promo_usado'), pctOf(flagCount('codigo_promo_usado'), clients.length)],
      ['Bono mensual activo', flagCount('bono_mensual_activo'), pctOf(flagCount('bono_mensual_activo'), clients.length)],
      ['Suscripción Stripe activa', clients.filter(function (u) { return String(u.stripe_subscription_status || '') === 'active'; }).length, pctOf(clients.filter(function (u) { return String(u.stripe_subscription_status || '') === 'active'; }).length, clients.length)]
    ];

    // Reservas por vertical.
    var vertRows = [
      ['Yoga', yogaSt.conf, yogaSt.canc, yogaSt.plazas],
      ['Psicología', psiSt.conf, psiSt.canc, '—'],
      ['Nutrición', nutSt.conf, nutSt.canc, '—'],
      ['Talleres', talSt.conf, talSt.canc, talSt.plazas]
    ];

    var rangeLabel = range === '7d' ? 'Últimos 7 días' : range === '30d' ? 'Últimos 30 días' : range === 'all' ? 'Histórico completo' : 'Últimos 14 días';
    var kpis = [
      ['Periodo del informe', rangeLabel],
      ['Generado', new Date().toLocaleString('es-ES')],
      ['Clientas totales', clients.length],
      ['Clientas activas (≥1 reserva)', idsActivas.length + ' (' + pctOf(idsActivas.length, clients.length) + ')'],
      ['Retención (2+ reservas)', rep2 + ' (' + pctOf(rep2, clients.length) + ')'],
      ['Reservas confirmadas (periodo)', totalConf],
      ['Reservas canceladas (periodo)', totalCanc],
      ['Tasa de cancelación', (totalConf + totalCanc) > 0 ? Math.round((totalCanc / (totalConf + totalCanc)) * 100) + ' %' : '—'],
      ['Ocupación media (plazas reservadas, yoga/talleres)', ocupMedia + ' %'],
      ['Ingresos cobrados (periodo)', euros(ingresosCents) + ' (' + ingresosN + ' cobros)'],
      ['Ticket medio', euros(ticketMedio)],
      ['Packs vendidos (periodo)', packs.length],
      ['Membresías ilimitadas activas', membAct],
      ['Ofertas canjeadas (periodo)', ofertas.length]
    ];

    var sources = ALLOWED_SOURCES.map(function (t) {
      var s = data[t];
      return [t, s ? s.rows.length + ' filas' : 'no consultada', s ? (s.status === 'ok' ? 'OK' : s.status) : '—'];
    });

    return {
      rangeLabel: rangeLabel,
      kpis: kpis,
      sheets: [
        { name: 'Resumen', head: ['Indicador', 'Valor'], rows: kpis },
        { name: 'Altas por mes', head: ['Mes', 'Nuevas clientas', 'Acumuladas'], rows: altasRows },
        { name: 'Reservas por vertical', head: ['Vertical', 'Confirmadas', 'Canceladas', 'Plazas'], rows: vertRows },
        { name: 'Ocupacion por clase', head: ['Fecha', 'Hora', 'Clase', 'Profesora', 'Vertical', 'Capacidad', 'Ocupadas', '%'], rows: ocupRows.slice(0, 500) },
        { name: 'Horarios estrella', head: ['Día', 'Franja', 'Plazas reservadas'], rows: heatRows },
        { name: 'Profesoras', head: ['Profesora', 'Especialidad', 'Clases', 'Plazas (ocup/cap)', 'Ocupación'], rows: profRows },
        { name: 'Ventas', head: ['Fecha', 'Tipo', 'Importe', 'Moneda', 'Estado', 'Canal'], rows: ventasRows },
        { name: 'Ingresos por tipo', head: ['Tipo', 'Cobros', 'Total', 'Ticket medio'], rows: revTipoRows },
        { name: 'Retencion', head: ['Tramo', 'Clientas', '%'], rows: retRows },
        { name: 'Funnel', head: ['Etapa', 'Clientas', '%'], rows: funnelRows },
        { name: 'Consultas por profesional', head: ['Profesional', 'Especialidad', 'Reservas'], rows: consProRows },
        { name: 'Packs', head: ['Tipo de pack', 'Vendidos', 'Créditos', 'Disponibles'], rows: packsRows },
        { name: 'Consultas', head: ['Especialidad', 'Confirmadas', 'Canceladas'], rows: consRows },
        { name: 'Ofertas', head: ['Tipo de oferta', 'Canjes'], rows: ofertasRows },
        { name: 'Origenes', head: ['Fuente', 'Filas', 'Estado'], rows: sources }
      ]
    };
  }

  // ------------------------------------------------------------------
  // Salida Excel (SheetJS) con fallback CSV.
  // ------------------------------------------------------------------
  function downloadExcel(report) {
    var fname = 'GEN-Yoga-Informe-Marketing-' + fileStamp() + '.xlsx';
    if (window.XLSX && window.XLSX.utils) {
      var wb = window.XLSX.utils.book_new();
      report.sheets.forEach(function (sh) {
        var ws = window.XLSX.utils.aoa_to_sheet([sh.head].concat(sh.rows));
        ws['!cols'] = sh.head.map(function (h) { return { wch: Math.min(42, Math.max(14, String(h || '').length + 4)) }; });
        var safe = sh.name.substring(0, 31).replace(/[\\/?*[\]]/g, '-');
        window.XLSX.utils.book_append_sheet(wb, ws, safe);
      });
      window.XLSX.writeFile(wb, fname);
      return { file: fname, via: 'Excel (.xlsx)' };
    }
    // Fallback sin dependencias: CSV compatible con Excel ES (punto y coma).
    var sh0 = report.sheets[0];
    var csv = '\uFEFF' + sh0.rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(';');
    }).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname.replace(/\.xlsx$/, '.csv');
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    return { file: a.download, via: 'CSV (SheetJS no disponible)' };
  }

  // ------------------------------------------------------------------
  // Salida PDF: vista de impresión con KPIs, tablas clave y gráficas del dashboard.
  // ------------------------------------------------------------------
  function chartImages() {
    var ids = [
      'chart-daily-registrations', 'chart-cumulative-growth', 'chart-weekday-occupancy',
      'chart-clients-distribution', 'chart-gym-timeslots', 'chart-consultations-specialty',
      'chart-professors-performance'
    ];
    var imgs = [];
    ids.forEach(function (id) {
      try {
        var cv = document.getElementById(id);
        if (cv && cv.tagName === 'CANVAS' && cv.width > 0) {
          imgs.push({ id: id, src: cv.toDataURL('image/png') });
        }
      } catch (_) { /* tainted o ausente: se omite */ }
    });
    return imgs;
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function tableHtml(title, head, rows, limit) {
    var body = rows.slice(0, limit).map(function (r) {
      return '<tr>' + r.map(function (c) { return '<td>' + escHtml(c) + '</td>'; }).join('') + '</tr>';
    }).join('');
    var more = rows.length > limit ? '<p class="rpt-note">+' + (rows.length - limit) + ' filas más en el Excel completo.</p>' : '';
    return '<h2>' + escHtml(title) + '</h2><table><thead><tr>' +
      head.map(function (h) { return '<th>' + escHtml(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + body + '</tbody></table>' + more;
  }

  function downloadPdf(report) {
    var old = document.getElementById('marketing-report-print');
    if (old) old.remove();
    var oldCss = document.getElementById('marketing-report-print-css');
    if (oldCss) oldCss.remove();

    var css = document.createElement('style');
    css.id = 'marketing-report-print-css';
    css.textContent = '@media print {' +
      'body > *:not(#marketing-report-print) { display: none !important; }' +
      '#marketing-report-print { display: block !important; }' +
      '}' +
      '#marketing-report-print { display: none; font-family: Ubuntu, Arial, sans-serif; color: #3c2a21; padding: 24px; }' +
      '#marketing-report-print h1 { font-size: 22px; margin: 0 0 4px; }' +
      '#marketing-report-print h2 { font-size: 15px; margin: 18px 0 6px; border-bottom: 2px solid #795244; padding-bottom: 4px; }' +
      '#marketing-report-print table { width: 100%; border-collapse: collapse; font-size: 11px; }' +
      '#marketing-report-print th, #marketing-report-print td { border: 1px solid #d8c9b8; padding: 4px 6px; text-align: left; }' +
      '#marketing-report-print th { background: #f3ece1; }' +
      '#marketing-report-print .rpt-kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; font-size: 12px; }' +
      '#marketing-report-print .rpt-note { font-size: 10px; color: #795244; }' +
      '#marketing-report-print img.rpt-chart { max-width: 100%; margin: 8px 0; border: 1px solid #eee; }';
    document.head.appendChild(css);

    var byName = {};
    report.sheets.forEach(function (s) { byName[s.name] = s; });
    var kpiLis = report.kpis.map(function (k) {
      return '<div><strong>' + escHtml(k[0]) + ':</strong> ' + escHtml(k[1]) + '</div>';
    }).join('');
    var charts = chartImages().map(function (c) {
      return '<img class="rpt-chart" src="' + c.src + '" alt="gráfica ' + escHtml(c.id) + '"/>';
    }).join('');

    var div = document.createElement('div');
    div.id = 'marketing-report-print';
    div.innerHTML =
      '<h1>GEN Yoga · Informe Marketing (' + escHtml(report.rangeLabel) + ')</h1>' +
      '<p class="rpt-note">Generado el ' + escHtml(new Date().toLocaleString('es-ES')) + ' · Datos agregados sin información personal.</p>' +
      '<div class="rpt-kpis">' + kpiLis + '</div>' +
      tableHtml('Horarios estrella (cuándo publicar)', byName['Horarios estrella'].head, byName['Horarios estrella'].rows, 21) +
      tableHtml('Ocupación por clase (top)', byName['Ocupacion por clase'].head, byName['Ocupacion por clase'].rows.slice(0, 20), 20) +
      tableHtml('Reservas por vertical', byName['Reservas por vertical'].head, byName['Reservas por vertical'].rows, 10) +
      tableHtml('Retención (¿vuelven?)', byName['Retencion'].head, byName['Retencion'].rows, 10) +
      tableHtml('Ingresos por tipo', byName['Ingresos por tipo'].head, byName['Ingresos por tipo'].rows, 10) +
      tableHtml('Altas por mes', byName['Altas por mes'].head, byName['Altas por mes'].rows.slice(-12), 12) +
      (charts ? '<h2>Gráficas del dashboard</h2>' + charts : '');
    document.body.appendChild(div);
    window.print();
    return { via: 'PDF (diálogo de impresión)' };
  }

  // ------------------------------------------------------------------
  // Entrada principal (global: la llaman los botones del dashboard).
  // ------------------------------------------------------------------
  async function descargarInformeMarketing(formato) {
    if (!INFORME_MARKETING_ENABLED) {
      swalError('No disponible', 'La descarga de informes está desactivada actualmente.');
      return;
    }
    try {
      // eslint-disable-next-line no-undef
      if (typeof isAdmin !== 'undefined' && !isAdmin) {
        swalError('Sin permiso', 'El informe marketing solo está disponible para administración.');
        return;
      }
    } catch (_) { /* noop */ }
    if (!getClient()) {
      swalError('Sin conexión', 'No hay conexión con la base de datos. Revisa tu conexión e inténtalo de nuevo.');
      return;
    }
    var range = getRange();
    var prog = null;
    if (window.Swal && window.Swal.fire) {
      prog = window.Swal.fire({
        title: 'Generando informe…',
        text: 'Descargando datos actualizados de Supabase.',
        allowOutsideClick: false,
        didOpen: function () { window.Swal.showLoading(); }
      });
    }
    try {
      var data = await fetchReportData(range);
      var report = buildReport(data, range);
      var failed = Object.keys(data).filter(function (t) { return data[t].status !== 'ok'; });
      var res = formato === 'pdf' ? downloadPdf(report) : downloadExcel(report);
      if (window.Swal && window.Swal.fire) {
        window.Swal.fire({
          icon: failed.length ? 'warning' : 'success',
          title: formato === 'pdf' ? 'Informe listo para PDF' : 'Informe descargado',
          html: (formato === 'pdf'
            ? 'Usa el diálogo de impresión para <strong>guardar como PDF</strong> y enviarlo a RRSS.'
            : 'Archivo <strong>' + escHtml(res.file) + '</strong> (' + escHtml(res.via) + ') listo para RRSS.') +
            (failed.length ? '<br><br>Fuentes sin acceso: ' + escHtml(failed.join(', ')) + '.' : ''),
          confirmButtonColor: '#795244'
        });
      }
    } catch (err) {
      if (prog && window.Swal) { try { window.Swal.close(); } catch (_) { /* noop */ } }
      swalError('No se pudo generar', (err && err.message) || String(err));
    }
  }

  window.descargarInformeMarketing = descargarInformeMarketing;
  window.ejecutarConciliacionPagos = ejecutarConciliacionPagos;
  // ------------------------------------------------------------------
  // Conciliación Stripe <-> BD (S6): solo lectura, vía edge function admin.
  // ------------------------------------------------------------------
  async function ejecutarConciliacionPagos() {
    try {
      // eslint-disable-next-line no-undef
      if (typeof isAdmin !== 'undefined' && !isAdmin) {
        swalError('Sin permiso', 'La conciliación solo está disponible para administración.');
        return;
      }
    } catch (_) { /* noop */ }
    var sb = getClient();
    if (!sb) {
      swalError('Sin conexión', 'No hay conexión con la base de datos.');
      return;
    }
    if (window.Swal && window.Swal.fire) {
      window.Swal.fire({
        title: 'Conciliando pagos…',
        text: 'Cruzando Stripe con la base de datos (solo lectura).',
        allowOutsideClick: false,
        didOpen: function () { window.Swal.showLoading(); }
      });
    }
    try {
      var res = await sb.functions.invoke('reconcile-stripe', {});
      if (res.error) throw res.error;
      var d = res.data || {};
      var bad = (d.paid_sin_fila || []).length + (d.filas_sin_stripe || []).length + (d.reembolsos_sin_anular || []).length;
      var line = function (x) {
        return '<div>· ' + escHtml(x.session || x.refund || '?') + ' — ' + escHtml(String(x.total != null ? (x.total / 100) + ' €' : (x.amount != null ? (x.amount / 100) + ' €' : ''))) + (x.type ? ' (' + escHtml(x.type) + ')' : '') + '</div>';
      };
      var html = '<p><strong>' + d.stripe_paid + '</strong> cobros en Stripe · <strong>' + d.db_rows + '</strong> filas en BD.</p>';
      html += '<p class="rpt-note">Pagados sin fila: ' + (d.paid_sin_fila || []).length +
        ' · Filas sin Stripe: ' + (d.filas_sin_stripe || []).length +
        ' · Reembolsos sin anular: ' + (d.reembolsos_sin_anular || []).length + '</p>';
      (d.paid_sin_fila || []).slice(0, 20).forEach(function (x) { html += line(x); });
      (d.filas_sin_stripe || []).slice(0, 20).forEach(function (x) { html += line(x); });
      (d.reembolsos_sin_anular || []).slice(0, 20).forEach(function (x) { html += line(x); });
      if (window.Swal && window.Swal.fire) {
        window.Swal.fire({
          icon: bad === 0 ? 'success' : 'warning',
          title: bad === 0 ? 'Conciliación limpia' : bad + ' descuadre(s)',
          html: html,
          confirmButtonColor: '#795244'
        });
      }
    } catch (err) {
      swalError('No se pudo conciliar', (err && err.message) || String(err));
    }
  }

  window.GENMarketingReport = {
    version: REPORT_VERSION,
    descargarInformeMarketing: descargarInformeMarketing,
    _helpers: { fmtDate: fmtDate, fmtMonth: fmtMonth, fmtTime: fmtTime, monthKey: monthKey, weekdayEs: weekdayEs, slotEs: slotEs }
  };

  // Los botones nacen ocultos; solo se muestran con el interruptor activo.
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', function () {
      if (!INFORME_MARKETING_ENABLED) return;
      ['btn-informe-excel', 'btn-informe-pdf'].forEach(function (id) {
        var b = document.getElementById(id);
        if (b) b.classList.remove('hidden');
      });
    });
  }
})();
