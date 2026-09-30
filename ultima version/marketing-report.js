/* marketing-report.js — v16.0 INFORME ESTRATÉGICO Y DE DIRECCIÓN (GEN YOGA)
 * Genera el informe empresarial definitivo para la dirección del gimnasio.
 * Muestra SIEMPRE el análisis multitemporal consolidado en 4 horizontes:
 *   1. Histórico Total (Todo el tiempo registrado)
 *   2. Último Año (Últimos 12 meses / 365 días)
 *   3. Últimos 3 Meses (Últimos 90 días)
 *   4. Último Mes (Últimos 30 días)
 * 
 * Áreas clave analizadas en profundidad:
 *   A) ¿QUIÉNES NOS COMPRAN? Demografía de compradores (edad media, tramos de edad,
 *      género estimado, volumen de gasto por perfil y fidelización/recurrencia).
 *   B) ¿QUÉ COMPRAN MÁS? Ranking de productos, bonos de clases, membresías,
 *      clases sueltas, talleres y consultas de salud por facturación (€) y unidades.
 *   C) ¿QUÉ HORARIOS Y CLASES VAN MEJOR? Días estrella, franjas horarias más demandadas,
 *      horas punta con máxima afluencia y ranking de clases por tasa real de ocupación (% aforo).
 *   D) DESEMPEÑO DEL EQUIPO: Clases, plazas ocupadas y ocupación media por profesora.
 * 
 * Formatos de exportación:
 *   - Excel multi-hoja (.xlsx con SheetJS, fallback CSV) con 10 hojas estructuradas.
 *   - PDF de alta dirección (vista de impresión estilizada @media print con diseño ejecutivo).
 * 
 * Compatible con web de escritorio, tabletas y WebView de Capacitor iOS/Android.
 */
(function () {
  'use strict';

  var REPORT_VERSION = '16.0';
  var FETCH_PAGE_SIZE = 1000;
  var INFORME_MARKETING_ENABLED = true;

  // Tablas autorizadas para el informe administrativo
  var ALLOWED_SOURCES = [
    'profiles', 'clases', 'profesionales', 'tipos_clases',
    'reservas_yoga', 'reservas_psicologia', 'reservas_nutricion', 'reservas_talleres',
    'stripe_purchases', 'class_credit_packs', 'unlimited_membership_periods',
    'ofertas_canjeadas', 'stripe_productos', 'bonos_clases_especiales'
  ];

  function getClient() {
    try {
      // eslint-disable-next-line no-undef
      if (typeof client !== 'undefined' && client) return client;
    } catch (_) { /* noop */ }
    return null;
  }

  // Zona horaria de Madrid para todas las agrupaciones horarias
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

  function fmtTime(iso) {
    if (!iso) return '--:--';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString('es-ES', { timeZone: MADRID_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function fmtDateTime(iso) {
    if (!iso) return '';
    return fmtDate(iso) + ' ' + fmtTime(iso);
  }

  function fmtMonth(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-ES', { timeZone: MADRID_TZ, month: 'long', year: 'numeric' });
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

  function getSlotInfo(iso) {
    var m = madridShifted(iso);
    if (!m) return { day: 'Desconocido', slot: 'Desconocido', hour: '--:--', h: 0 };
    var day = weekdayEs(iso);
    var h = m.getHours();
    var min = m.getMinutes();
    var hourStr = String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
    var slot = 'Noche';
    if (h >= 7 && h < 13) slot = 'Mañana (07:00 - 13:00)';
    else if (h >= 13 && h < 16) slot = 'Mediodía (13:00 - 16:00)';
    else if (h >= 16 && h < 19.5) slot = 'Tarde (16:00 - 19:30)';
    else slot = 'Noche (19:30 - 22:00)';
    return { day: day, slot: slot, hour: hourStr, h: h };
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

  function pctStr(num, den) {
    if (!den || den <= 0) return '0,0 %';
    var p = (num / den) * 100;
    return p.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';
  }

  function fileStamp() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function swalError(title, text) {
    if (window.Swal && window.Swal.fire) {
      window.Swal.fire({ icon: 'error', title: title, text: text, confirmButtonColor: '#795244' });
    } else {
      window.alert(title + ': ' + text);
    }
  }

  // ------------------------------------------------------------------
  // MOTOR DEMOGRÁFICO: CÁLCULO DE EDAD Y CLASIFICACIÓN DE GÉNERO
  // ------------------------------------------------------------------
  function calculateAge(dobStr, refDate) {
    if (!dobStr) return null;
    var d = new Date(dobStr);
    if (isNaN(d.getTime())) return null;
    var now = refDate || new Date();
    var age = now.getFullYear() - d.getFullYear();
    var m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) {
      age--;
    }
    // Filtrado de fechas erróneas de prueba (ej. año 0007 o recién nacidos 2026)
    if (age < 10 || age > 110) return null;
    return age;
  }

  function getAgeBracket(age) {
    if (age === null || age === undefined) return 'Sin especificar';
    if (age < 25) return '< 25 años';
    if (age <= 34) return '25 - 34 años';
    if (age <= 44) return '35 - 44 años';
    if (age <= 54) return '45 - 54 años';
    if (age <= 64) return '55 - 64 años';
    return '65+ años';
  }

  var AGE_BRACKETS_ORDER = [
    '< 25 años',
    '25 - 34 años',
    '35 - 44 años',
    '45 - 54 años',
    '55 - 64 años',
    '65+ años',
    'Sin especificar'
  ];

  var FEMALE_NAMES = new Set([
    'maria', 'maría', 'carmen', 'ana', 'laura', 'lucia', 'lucía', 'elena', 'marta', 'sara',
    'paula', 'cristina', 'raquel', 'beatriz', 'isabel', 'silvia', 'patricia', 'andrea', 'irene',
    'natalia', 'victoria', 'sofia', 'sofía', 'alba', 'claudia', 'eva', 'rocio', 'rocío', 'sandra',
    'lorena', 'alicia', 'nuria', 'rosa', 'pilar', 'mercedes', 'antonia', 'margarita', 'teresa',
    'dolores', 'vanessa', 'vanesa', 'sonia', 'monica', 'mónica', 'miriam', 'michelle', 'lisa',
    'vlora', 'mckenzie', 'encarnacion', 'encarnación', 'ruth', 'sally', 'helena', 'amparo',
    'clemi', 'leidy', 'sabrina', 'inma', 'inmaculada', 'amelia', 'blanca', 'josefa', 'mariana',
    'nieves', 'maite', 'francisca', 'yanira', 'noelle', 'noëlle', 'aurora', 'conchi', 'puri',
    'purificacion', 'purificación', 'reme', 'remedios', 'maribel', 'celia', 'concepcion',
    'concepción', 'gloria', 'delcy', 'yolanda', 'carla', 'ines', 'inés', 'karen', 'reyes',
    'adoracion', 'adoración', 'salma', 'elisabet', 'elizabeth', 'mariona', 'gemma', 'susana',
    'leticia', 'noelia', 'tamara', 'olga', 'clara', 'belen', 'belén', 'berta', 'lola', 'mari',
    'ainoa', 'ainhoa', 'marina', 'concha', 'asuncion', 'asunción', 'milagros', 'begoña', 'begona',
    'aranzazu', 'montserrat', 'arantxa', 'loreto', 'caridad', 'fatima', 'fátima', 'esperanza',
    'manuela', 'juana', 'ángela', 'angela', 'paloma', 'virginia', 'soledad', 'rosario', 'paz',
    'merche', 'charo', 'chelo', 'pepa', 'toñi', 'consuelo', 'macarena', 'soraya',
    'lauren', 'charlotte', 'emma', 'olivia', 'mia', 'zoe', 'chloe', 'julia', 'daniela', 'valeria'
  ]);

  var MALE_NAMES = new Set([
    'antonio', 'manuel', 'jose', 'josé', 'francisco', 'david', 'juan', 'javier', 'daniel',
    'carlos', 'jesus', 'jesús', 'alejandro', 'miguel', 'rafael', 'pedro', 'angel', 'ángel',
    'fernando', 'pablo', 'luis', 'sergio', 'alberto', 'jorge', 'diego', 'alvaro', 'álvaro',
    'benito', 'francesc', 'arturo', 'adrian', 'adrián', 'ruben', 'rubén', 'agustin', 'agustín',
    'raul', 'raúl', 'benigno', 'atmaran', 'enrique', 'marcos', 'oscar', 'óscar', 'victor', 'víctor',
    'ivan', 'iván', 'eduardo', 'roberto', 'ignacio', 'cesar', 'césar', 'mario', 'ramon', 'ramón',
    'vicente', 'joaquin', 'joaquín', 'jaime', 'andres', 'andrés', 'guillermo', 'salva', 'salvador',
    'felipe', 'borja', 'hector', 'héctor', 'alfonso', 'gonzalo', 'santiago', 'emilio', 'gabriel',
    'felix', 'félix', 'cristian', 'joan', 'jordi', 'hugo', 'mateo', 'leo', 'lucas', 'martin', 'martín',
    'nicolas', 'nicolás', 'guille', 'paco', 'pepe', 'nacho', 'quique', 'curro', 'chema', 'joselu',
    'josel', 'txema', 'alber', 'dani', 'alex', 'álex'
  ]);

  function estimateGender(fullName) {
    if (!fullName) return 'No determinado';
    var clean = String(fullName)
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    var tokens = clean.split(/[^a-zñ]+/).filter(Boolean);
    if (!tokens.length) return 'No determinado';

    var first = tokens[0];
    var second = tokens[1] || '';

    // Reglas compuestas frecuentes en España
    if (first === 'maria' && (second === 'jose' || second === 'jesus')) return 'Femenino';
    if (first === 'jose' && (second === 'maria' || second === 'manuel' || second === 'antonio')) return 'Masculino';
    if (first === 'francisco' && second === 'jose') return 'Masculino';
    if (first === 'ana' && (second === 'belen' || second === 'maria' || second === 'isabel')) return 'Femenino';

    if (FEMALE_NAMES.has(first)) return 'Femenino';
    if (MALE_NAMES.has(first)) return 'Masculino';

    if (second && FEMALE_NAMES.has(second)) return 'Femenino';
    if (second && MALE_NAMES.has(second)) return 'Masculino';

    // Heurísticas de terminación en español
    if (/(a|ia|ina|ela|ica|isa|ita|ana|ora)$/.test(first) && !/^(luca|borja|andrea)$/.test(first)) {
      return 'Femenino';
    }
    if (/(o|or|on|an|el|os|er|ur|us)$/.test(first)) {
      return 'Masculino';
    }

    return 'No determinado';
  }

  // ------------------------------------------------------------------
  // CATEGORIZACIÓN COMERCIAL DE PRODUCTOS Y SERVICIOS
  // ------------------------------------------------------------------
  function categorizeProduct(item) {
    var t = String((item && item.purchase_type) || '').toLowerCase();
    var name = String((item && item.product_name) || '').toLowerCase();

    if (t === 'pack_10' || name.indexOf('10 clases') >= 0 || name.indexOf('bono 10') >= 0) {
      return { id: 'pack_10', label: 'Bono 10 Clases', cat: 'Bonos de Clases' };
    }
    if (t === 'pack_6' || name.indexOf('6 clases') >= 0 || name.indexOf('bono 6') >= 0) {
      return { id: 'pack_6', label: 'Bono 6 Clases', cat: 'Bonos de Clases' };
    }
    if (t === 'pack_4' || name.indexOf('4 clases') >= 0 || name.indexOf('bono 4') >= 0) {
      return { id: 'pack_4', label: 'Bono 4 Clases', cat: 'Bonos de Clases' };
    }
    if (t === 'bono_ilimitado' || t === 'monthly_pass' || t === 'subscription' || name.indexOf('ilimitado') >= 0 || name.indexOf('bono mensual') >= 0) {
      return { id: 'ilimitado', label: 'Bono Mensual Ilimitado', cat: 'Membresías' };
    }
    if (t === 'single_class_promo_50' || name.indexOf('promo 50') >= 0 || name.indexOf('50%') >= 0) {
      return { id: 'promo_50', label: 'Clase Suelta Promo 50%', cat: 'Clases Sueltas' };
    }
    if (t === 'single_class' || t === 'clase_suelta' || name.indexOf('clase suelta') >= 0) {
      return { id: 'single_class', label: 'Clase Suelta Presencial', cat: 'Clases Sueltas' };
    }
    if (t === 'taller' || t === 'clase_especial' || name.indexOf('taller') >= 0 || name.indexOf('especial') >= 0) {
      return { id: 'taller', label: 'Talleres y Clases Especiales', cat: 'Talleres' };
    }
    if (name.indexOf('ayurveda') >= 0 || name.indexOf('psicolog') >= 0 || name.indexOf('nutric') >= 0 || name.indexOf('pni') >= 0 || name.indexOf('terapia') >= 0) {
      return { id: 'salud', label: 'Consultas Salud Integrativa', cat: 'Consultas' };
    }
    return { id: t || 'otro', label: (item && item.purchase_type) || 'Otros Servicios', cat: 'Otros' };
  }

  // ------------------------------------------------------------------
  // CAPA DE EXTRACCIÓN DE DATOS COMPLETOS (HISTÓRICOS SIN CORTES)
  // ------------------------------------------------------------------
  async function fetchAllReportData() {
    var sb = getClient();
    if (!sb) throw new Error('Sin conexión con la base de datos (cliente Supabase no disponible).');

    var now = new Date();
    // Filtro prudente para clases: traer todo el histórico más los próximos 90 días,
    // evitando miles de clases recurrentes vacías generadas en 2027/2028.
    var futureClassCutoff = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();

    function q(table, select, orderCol, maxDateFilter) {
      var all = [];
      var fetchPage = function (offset) {
        var query = sb.from(table).select(select);
        if (maxDateFilter && maxDateFilter.col && maxDateFilter.val) {
          query = query.lte(maxDateFilter.col, maxDateFilter.val);
        }
        if (orderCol) query = query.order(orderCol, { ascending: true });
        return query.range(offset, offset + FETCH_PAGE_SIZE - 1).then(function (res) {
          if (res.error) throw res.error;
          var rows = res.data || [];
          all = all.concat(rows);
          if (rows.length === FETCH_PAGE_SIZE) return fetchPage(offset + FETCH_PAGE_SIZE);
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
      q('profiles', 'id,nombre,apellidos,fecha_nacimiento,rol,created_at,oferta_bienvenida_canjeada,codigo_promo_usado,bono_mensual_activo,stripe_subscription_status', 'created_at', null),
      q('clases', 'id,nombre,fecha_inicio,fecha_fin,capacidad_max,profesor_id,tipo_clase,activa,es_especial', 'fecha_inicio', { col: 'fecha_inicio', val: futureClassCutoff }),
      q('profesionales', 'id,nombre,apellidos,especialidad', 'nombre', null),
      q('reservas_yoga', 'id,clase_id,user_id,created_at,estado,num_plazas,tipo_reserva,usado_bono_mensual,bono_descontado', 'created_at', null),
      q('reservas_psicologia', 'id,clase_id,user_id,created_at,estado,tipo_reserva', 'created_at', null),
      q('reservas_nutricion', 'id,clase_id,user_id,created_at,estado,tipo_reserva', 'created_at', null),
      q('reservas_talleres', 'id,clase_id,user_id,created_at,estado,num_plazas', 'created_at', null),
      q('stripe_purchases', 'id,user_id,purchase_type,price_id,amount_total,currency,payment_status,fulfilled_at,created_at,is_guest', 'created_at', null),
      q('class_credit_packs', 'id,user_id,pack_type,credits_total,credits_remaining,purchased_at,expires_at,created_at', 'purchased_at', null),
      q('unlimited_membership_periods', 'id,user_id,membership_month,starts_at,ends_at,purchased_at,created_at', 'membership_month', null),
      q('ofertas_canjeadas', 'tipo_oferta,canjeado_el', 'canjeado_el', null),
      q('stripe_productos', 'id,nombre,unit_amount,currency,categoria,activo', 'nombre', null),
      q('bonos_clases_especiales', 'id,mes,saldo,origen,created_at', 'created_at', null)
    ];

    var results = await Promise.all(jobs);
    var data = {};
    results.forEach(function (r) { data[r.table] = r; });
    return data;
  }

  // ------------------------------------------------------------------
  // MOTOR DE CÁLCULO MULTITEMPORAL: 4 HORIZONTES CONSOLIDADOS
  // ------------------------------------------------------------------
  function buildMasterReport(data) {
    var now = new Date();
    var get = function (t) { return (data[t] && data[t].rows) || []; };

    var profiles = get('profiles');
    var clases = get('clases');
    var profes = get('profesionales');
    var resYoga = get('reservas_yoga');
    var resPsi = get('reservas_psicologia');
    var resNut = get('reservas_nutricion');
    var resTal = get('reservas_talleres');
    var purchases = get('stripe_purchases');
    var creditPacks = get('class_credit_packs');
    var memberships = get('unlimited_membership_periods');
    var ofertas = get('ofertas_canjeadas');
    var stripeProds = get('stripe_productos');

    // Mapeos rápidos
    var profMap = {};
    profes.forEach(function (p) {
      profMap[p.id] = {
        id: p.id,
        nombre: ((p.nombre || '') + ' ' + (p.apellidos || '')).trim() || ('Profe #' + p.id),
        especialidad: p.especialidad || '—'
      };
    });

    var claseMap = {};
    clases.forEach(function (c) { claseMap[c.id] = c; });

    var prodMap = {};
    stripeProds.forEach(function (pr) { prodMap[pr.id] = pr; });

    var profileMap = {};
    profiles.forEach(function (u) {
      var nombreCompleto = ((u.nombre || '') + ' ' + (u.apellidos || '')).trim();
      var edad = calculateAge(u.fecha_nacimiento, now);
      var genero = estimateGender(u.nombre || nombreCompleto);
      profileMap[u.id] = {
        id: u.id,
        nombre: nombreCompleto || 'Usuario #' + String(u.id).substring(0, 6),
        nombrePila: (u.nombre || '').trim() || 'Usuario',
        rol: String(u.rol || 'user').toLowerCase().trim(),
        fecha_nacimiento: u.fecha_nacimiento,
        edad: edad,
        tramoEdad: getAgeBracket(edad),
        genero: genero,
        created_at: u.created_at,
        oferta_bienvenida_canjeada: u.oferta_bienvenida_canjeada,
        codigo_promo_usado: u.codigo_promo_usado,
        bono_mensual_activo: u.bono_mensual_activo,
        stripe_subscription_status: u.stripe_subscription_status
      };
    });

    // Clientas puras (excluyendo administradores y profesores)
    var clients = profiles.filter(function (u) {
      var r = String(u.rol || 'user').toLowerCase().trim();
      return ['admin', 'profesor', 'trabajador'].indexOf(r) < 0;
    }).map(function (u) { return profileMap[u.id]; });

    // Definición estricta de los 4 horizontes solicitados por el usuario
    var HORIZONS = [
      { key: 'hist', label: 'Histórico Total', desc: 'Todo el tiempo registrado', days: 0 },
      { key: '1y',   label: 'Último Año (12m)', desc: 'Últimos 365 días', days: 365 },
      { key: '3m',   label: 'Últimos 3 Meses',  desc: 'Últimos 90 días', days: 90 },
      { key: '1m',   label: 'Último Mes (30d)', desc: 'Últimos 30 días', days: 30 }
    ];

    function inHorizon(iso, days) {
      if (!days || days === 0) return true;
      if (!iso) return false;
      var d = new Date(iso);
      if (isNaN(d.getTime())) return false;
      var cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      return d >= cutoff;
    }

    // ----------------------------------------------------------------
    // CÁLCULO DE MÉTRICAS PARA CADA HORIZONTE
    // ----------------------------------------------------------------
    var H = {};

    HORIZONS.forEach(function (h) {
      var days = h.days;

      // 1. Facturación y Compras
      var paidPurchases = purchases.filter(function (p) {
        var isPaid = String(p.payment_status || '').toLowerCase() === 'paid';
        var hasAmount = Number(p.amount_total || 0) > 0;
        var inPeriod = inHorizon(p.fulfilled_at || p.created_at, days);
        return isPaid && hasAmount && inPeriod;
      });

      var revCents = 0;
      var buyerPurchasesCount = {};
      var buyerSpentCents = {};
      var buyerProducts = {};
      var salesByProduct = {};

      paidPurchases.forEach(function (p) {
        var cents = Number(p.amount_total || 0);
        revCents += cents;

        var uid = p.user_id || (p.is_guest ? 'invitada' : 'anonimo');
        buyerPurchasesCount[uid] = (buyerPurchasesCount[uid] || 0) + 1;
        buyerSpentCents[uid] = (buyerSpentCents[uid] || 0) + cents;

        var prodInfo = categorizeProduct({
          purchase_type: p.purchase_type,
          product_name: (prodMap[p.price_id] && prodMap[p.price_id].nombre) || ''
        });

        salesByProduct[prodInfo.label] = salesByProduct[prodInfo.label] || {
          id: prodInfo.id,
          label: prodInfo.label,
          cat: prodInfo.cat,
          n: 0,
          cents: 0
        };
        salesByProduct[prodInfo.label].n++;
        salesByProduct[prodInfo.label].cents += cents;
      });

      var uniqueBuyersCount = Object.keys(buyerPurchasesCount).length;
      var recurringBuyers = Object.keys(buyerPurchasesCount).filter(function (uid) {
        return buyerPurchasesCount[uid] >= 2;
      }).length;
      var singleBuyers = uniqueBuyersCount - recurringBuyers;

      // 2. Demografía de Compradores (Quiénes nos compran)
      var buyerAges = [];
      var buyerAgeBrackets = {};
      var buyerGenders = { Femenino: { n: 0, cents: 0, buyers: 0 }, Masculino: { n: 0, cents: 0, buyers: 0 }, 'No determinado': { n: 0, cents: 0, buyers: 0 } };

      AGE_BRACKETS_ORDER.forEach(function (b) {
        buyerAgeBrackets[b] = { n: 0, cents: 0, buyers: 0 };
      });

      Object.keys(buyerSpentCents).forEach(function (uid) {
        var u = profileMap[uid];
        var spent = buyerSpentCents[uid];
        var nSales = buyerPurchasesCount[uid];

        if (u) {
          if (u.edad !== null) buyerAges.push(u.edad);
          var b = u.tramoEdad;
          buyerAgeBrackets[b].buyers++;
          buyerAgeBrackets[b].cents += spent;
          buyerAgeBrackets[b].n += nSales;

          var g = u.genero;
          buyerGenders[g].buyers++;
          buyerGenders[g].cents += spent;
          buyerGenders[g].n += nSales;
        } else {
          // Invitada o sin perfil en profiles
          buyerAgeBrackets['Sin especificar'].buyers++;
          buyerAgeBrackets['Sin especificar'].cents += spent;
          buyerAgeBrackets['Sin especificar'].n += nSales;

          buyerGenders['No determinado'].buyers++;
          buyerGenders['No determinado'].cents += spent;
          buyerGenders['No determinado'].n += nSales;
        }
      });

      var buyerAvgAge = buyerAges.length > 0
        ? Math.round((buyerAges.reduce(function (a, b) { return a + b; }, 0) / buyerAges.length) * 10) / 10
        : null;

      // 3. Reservas y Asistencia
      var yogaConf = 0, yogaCanc = 0, yogaPlazas = 0;
      var resYogaPeriod = resYoga.filter(function (r) { return inHorizon(r.created_at, days); });
      resYogaPeriod.forEach(function (r) {
        if (String(r.estado || 'confirmada') === 'cancelada') {
          yogaCanc++;
        } else {
          yogaConf++;
          yogaPlazas += Number(r.num_plazas || 1);
        }
      });

      var psiConf = 0, psiCanc = 0;
      var resPsiPeriod = resPsi.filter(function (r) { return inHorizon(r.created_at, days); });
      resPsiPeriod.forEach(function (r) {
        if (String(r.estado || 'confirmada') === 'cancelada') psiCanc++;
        else psiConf++;
      });

      var nutConf = 0, nutCanc = 0;
      var resNutPeriod = resNut.filter(function (r) { return inHorizon(r.created_at, days); });
      resNutPeriod.forEach(function (r) {
        if (String(r.estado || 'confirmada') === 'cancelada') nutCanc++;
        else nutConf++;
      });

      var talConf = 0, talCanc = 0, talPlazas = 0;
      var resTalPeriod = resTal.filter(function (r) { return inHorizon(r.created_at, days); });
      resTalPeriod.forEach(function (r) {
        if (String(r.estado || 'confirmada') === 'cancelada') talCanc++;
        else { talConf++; talPlazas += Number(r.num_plazas || 1); }
      });

      var totalConf = yogaConf + psiConf + nutConf + talConf;
      var totalCanc = yogaCanc + psiCanc + nutCanc + talCanc;
      var totalPlazasBooked = yogaPlazas + talPlazas;

      // 4. Clases y Ocupación Real
      var clasesInPeriod = clases.filter(function (c) {
        if (!c.fecha_inicio) return false;
        var isPastOrCurrent = new Date(c.fecha_inicio) <= now;
        var inPeriod = inHorizon(c.fecha_inicio, days);
        var v = verticalOfClase(c);
        return isPastOrCurrent && inPeriod && (v === 'Yoga' || v === 'Talleres');
      });

      var totalCapOfertada = 0;
      clasesInPeriod.forEach(function (c) {
        totalCapOfertada += Number(c.capacidad_max || 10);
      });

      var occRate = totalCapOfertada > 0
        ? Math.round((totalPlazasBooked / totalCapOfertada) * 1000) / 10
        : 0;

      // 5. Horarios y Días con Mayor Demanda (en reservas confirmadas de yoga)
      var heatDays = {}, heatHours = {}, heatSlots = {};
      resYogaPeriod.forEach(function (r) {
        if (String(r.estado || 'confirmada') === 'cancelada') return;
        var c = claseMap[r.clase_id];
        if (!c || !c.fecha_inicio) return;
        var info = getSlotInfo(c.fecha_inicio);
        var pz = Number(r.num_plazas || 1);

        heatDays[info.day] = (heatDays[info.day] || 0) + pz;
        heatHours[info.hour] = (heatHours[info.hour] || 0) + pz;
        heatSlots[info.slot] = (heatSlots[info.slot] || 0) + pz;
      });

      var topDay = Object.keys(heatDays).sort(function (a, b) { return heatDays[b] - heatDays[a]; })[0] || '—';
      var topHour = Object.keys(heatHours).sort(function (a, b) { return heatHours[b] - heatHours[a]; })[0] || '—';
      var topSlot = Object.keys(heatSlots).sort(function (a, b) { return heatSlots[b] - heatSlots[a]; })[0] || '—';

      // 6. Nuevas Clientas Registradas
      var newClients = clients.filter(function (u) { return inHorizon(u.created_at, days); }).length;

      // Producto más vendido
      var sortedProds = Object.keys(salesByProduct).sort(function (a, b) {
        return salesByProduct[b].cents - salesByProduct[a].cents;
      });
      var topProdRev = sortedProds[0] || '—';
      var topProdUnits = Object.keys(salesByProduct).sort(function (a, b) {
        return salesByProduct[b].n - salesByProduct[a].n;
      })[0] || '—';

      H[h.key] = {
        days: days,
        label: h.label,
        desc: h.desc,
        revCents: revCents,
        salesCount: paidPurchases.length,
        avgTicketCents: paidPurchases.length > 0 ? Math.round(revCents / paidPurchases.length) : 0,
        newClients: newClients,
        uniqueBuyersCount: uniqueBuyersCount,
        recurringBuyers: recurringBuyers,
        recurrenceRate: uniqueBuyersCount > 0 ? Math.round((recurringBuyers / uniqueBuyersCount) * 1000) / 10 : 0,
        buyerAvgAge: buyerAvgAge,
        buyerAgeBrackets: buyerAgeBrackets,
        buyerGenders: buyerGenders,
        salesByProduct: salesByProduct,
        yogaConf: yogaConf,
        consultasConf: psiConf + nutConf,
        talleresConf: talConf,
        totalConf: totalConf,
        totalCanc: totalCanc,
        cancRate: (totalConf + totalCanc) > 0 ? Math.round((totalCanc / (totalConf + totalCanc)) * 1000) / 10 : 0,
        totalPlazasBooked: totalPlazasBooked,
        totalCapOfertada: totalCapOfertada,
        occRate: occRate,
        topDay: topDay,
        topHour: topHour,
        topSlot: topSlot,
        topProdRev: topProdRev,
        topProdUnits: topProdUnits,
        heatDays: heatDays,
        heatHours: heatHours,
        heatSlots: heatSlots,
        buyerPurchasesCount: buyerPurchasesCount,
        buyerSpentCents: buyerSpentCents
      };
    });

    // ----------------------------------------------------------------
    // DESGLOSE COMPLETO DE PRODUCTOS (MATRIZ COMPARATIVA EN LOS 4 PERIODOS)
    // ----------------------------------------------------------------
    var allProductLabels = new Set();
    HORIZONS.forEach(function (h) {
      Object.keys(H[h.key].salesByProduct).forEach(function (k) { allProductLabels.add(k); });
    });
    // Añadir productos base del gimnasio para asegurar visibilidad
    ['Bono 10 Clases', 'Bono 6 Clases', 'Bono 4 Clases', 'Bono Mensual Ilimitado', 'Clase Suelta Presencial', 'Clase Suelta Promo 50%'].forEach(function (p) {
      allProductLabels.add(p);
    });

    var productMatrixRows = Array.from(allProductLabels).map(function (lbl) {
      var hHist = (H.hist.salesByProduct[lbl]) || { n: 0, cents: 0, cat: 'Bonos/Servicios' };
      var h1y   = (H['1y'].salesByProduct[lbl]) || { n: 0, cents: 0, cat: hHist.cat };
      var h3m   = (H['3m'].salesByProduct[lbl]) || { n: 0, cents: 0, cat: hHist.cat };
      var h1m   = (H['1m'].salesByProduct[lbl]) || { n: 0, cents: 0, cat: hHist.cat };
      var ticketMedio = hHist.n > 0 ? euros(hHist.cents / hHist.n) : '—';
      var pctFacturacion = H.hist.revCents > 0 ? pctStr(hHist.cents, H.hist.revCents) : '0,0 %';

      return {
        label: lbl,
        cat: hHist.cat,
        nHist: hHist.n,
        revHist: euros(hHist.cents),
        revHistCents: hHist.cents,
        n1y: h1y.n,
        rev1y: euros(h1y.cents),
        n3m: h3m.n,
        rev3m: euros(h3m.cents),
        n1m: h1m.n,
        rev1m: euros(h1m.cents),
        ticketMedio: ticketMedio,
        pctFacturacion: pctFacturacion
      };
    }).sort(function (a, b) { return b.revHistCents - a.revHistCents; });

    // ----------------------------------------------------------------
    // DESGLOSE COMPLETO DE HORARIOS Y CLASES
    // ----------------------------------------------------------------
    var DAYS_ORDER = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

    // Ocupación por día de la semana (Histórico completo)
    var dayStats = {};
    DAYS_ORDER.forEach(function (d) { dayStats[d] = { clases: 0, cap: 0, plazas: 0 }; });

    // Plazas ocupadas por clase_id (a partir de reservas confirmadas)
    var occPlazasByClase = {};
    resYoga.forEach(function (r) {
      if (String(r.estado || 'confirmada') === 'cancelada' || r.clase_id == null) return;
      occPlazasByClase[r.clase_id] = (occPlazasByClase[r.clase_id] || 0) + Number(r.num_plazas || 1);
    });
    resTal.forEach(function (r) {
      if (String(r.estado || 'confirmada') === 'cancelada' || r.clase_id == null) return;
      occPlazasByClase[r.clase_id] = (occPlazasByClase[r.clase_id] || 0) + Number(r.num_plazas || 1);
    });

    clases.forEach(function (c) {
      if (!c.fecha_inicio || new Date(c.fecha_inicio) > now) return;
      var v = verticalOfClase(c);
      if (v !== 'Yoga' && v !== 'Talleres') return;
      var day = weekdayEs(c.fecha_inicio);
      if (dayStats[day]) {
        dayStats[day].clases++;
        dayStats[day].cap += Number(c.capacidad_max || 10);
        dayStats[day].plazas += (occPlazasByClase[c.id] || 0);
      }
    });

    var daysReportRows = DAYS_ORDER.map(function (d) {
      var s = dayStats[d];
      var occ = s.cap > 0 ? Math.round((s.plazas / s.cap) * 1000) / 10 : 0;
      var diag = occ >= 40 ? 'Día Estrella (Alta demanda)' : occ >= 20 ? 'Demanda Moderada' : s.clases > 0 ? 'Franja Valle / Oportunidad' : 'Sin clases regulares';
      return [d, s.clases, s.cap, s.plazas, occ.toLocaleString('es-ES', { minimumFractionDigits: 1 }) + ' %', diag];
    });

    // Franjas Horarias
    var slotStats = {
      'Mañana (07:00 - 13:00)': { clases: 0, cap: 0, plazas: 0 },
      'Mediodía (13:00 - 16:00)': { clases: 0, cap: 0, plazas: 0 },
      'Tarde (16:00 - 19:30)': { clases: 0, cap: 0, plazas: 0 },
      'Noche (19:30 - 22:00)': { clases: 0, cap: 0, plazas: 0 }
    };
    clases.forEach(function (c) {
      if (!c.fecha_inicio || new Date(c.fecha_inicio) > now) return;
      var v = verticalOfClase(c);
      if (v !== 'Yoga' && v !== 'Talleres') return;
      var slot = getSlotInfo(c.fecha_inicio).slot;
      if (slotStats[slot]) {
        slotStats[slot].clases++;
        slotStats[slot].cap += Number(c.capacidad_max || 10);
        slotStats[slot].plazas += (occPlazasByClase[c.id] || 0);
      }
    });

    var slotReportRows = Object.keys(slotStats).map(function (sl) {
      var s = slotStats[sl];
      var occ = s.cap > 0 ? Math.round((s.plazas / s.cap) * 1000) / 10 : 0;
      var diag = occ >= 35 ? 'Franja Pico' : occ >= 15 ? 'Afluencia Normal' : 'Franja Valle';
      return [sl, s.clases, s.cap, s.plazas, occ.toLocaleString('es-ES', { minimumFractionDigits: 1 }) + ' %', diag];
    });

    // Ranking de Horas Punta Exactas
    var hourStats = {};
    clases.forEach(function (c) {
      if (!c.fecha_inicio || new Date(c.fecha_inicio) > now) return;
      var v = verticalOfClase(c);
      if (v !== 'Yoga' && v !== 'Talleres') return;
      var hr = getSlotInfo(c.fecha_inicio).hour;
      hourStats[hr] = hourStats[hr] || { sesiones: 0, cap: 0, plazas: 0 };
      hourStats[hr].sesiones++;
      hourStats[hr].cap += Number(c.capacidad_max || 10);
      hourStats[hr].plazas += (occPlazasByClase[c.id] || 0);
    });

    var peakHoursRows = Object.keys(hourStats).map(function (hr) {
      var s = hourStats[hr];
      var occ = s.cap > 0 ? Math.round((s.plazas / s.cap) * 1000) / 10 : 0;
      var media = s.sesiones > 0 ? (Math.round((s.plazas / s.sesiones) * 10) / 10).toLocaleString('es-ES') : '0';
      return [hr, s.plazas, s.sesiones, media, occ.toLocaleString('es-ES', { minimumFractionDigits: 1 }) + ' %'];
    }).sort(function (a, b) { return b[1] - a[1]; });

    // Matriz Cruzada Día × Franja (Mapa de Calor de Demanda)
    var SLOTS_ORDER = ['Mañana (07:00 - 13:00)', 'Mediodía (13:00 - 16:00)', 'Tarde (16:00 - 19:30)', 'Noche (19:30 - 22:00)'];
    var daySlotCross = {};
    DAYS_ORDER.forEach(function (d) {
      daySlotCross[d] = {};
      SLOTS_ORDER.forEach(function (sl) { daySlotCross[d][sl] = { plazas: 0, cap: 0 }; });
    });

    clases.forEach(function (c) {
      if (!c.fecha_inicio || new Date(c.fecha_inicio) > now) return;
      var v = verticalOfClase(c);
      if (v !== 'Yoga' && v !== 'Talleres') return;
      var info = getSlotInfo(c.fecha_inicio);
      if (daySlotCross[info.day] && daySlotCross[info.day][info.slot]) {
        daySlotCross[info.day][info.slot].plazas += (occPlazasByClase[c.id] || 0);
        daySlotCross[info.day][info.slot].cap += Number(c.capacidad_max || 10);
      }
    });

    var heatmapMatrixRows = DAYS_ORDER.map(function (d) {
      var row = [d];
      var totDayPlazas = 0, totDayCap = 0;
      SLOTS_ORDER.forEach(function (sl) {
        var cell = daySlotCross[d][sl];
        totDayPlazas += cell.plazas;
        totDayCap += cell.cap;
        var occ = cell.cap > 0 ? Math.round((cell.plazas / cell.cap) * 100) : 0;
        row.push(cell.plazas + ' (' + occ + '%)');
      });
      var totOcc = totDayCap > 0 ? Math.round((totDayPlazas / totDayCap) * 100) : 0;
      row.push(totDayPlazas + ' (' + totOcc + '%)');
      return row;
    });

    // Ranking de Clases por Nombre y Disciplina
    var classAgg = {};
    clases.forEach(function (c) {
      if (!c.fecha_inicio || new Date(c.fecha_inicio) > now) return;
      var v = verticalOfClase(c);
      if (v !== 'Yoga' && v !== 'Talleres') return;
      var name = c.nombre || 'Sesión de Yoga';
      classAgg[name] = classAgg[name] || {
        name: name,
        tipo: v,
        sesiones: 0,
        cap: 0,
        plazas: 0,
        profe: (profMap[c.profesor_id] && profMap[c.profesor_id].nombre) || '—'
      };
      classAgg[name].sesiones++;
      classAgg[name].cap += Number(c.capacidad_max || 10);
      classAgg[name].plazas += (occPlazasByClase[c.id] || 0);
    });

    var classRankingRows = Object.keys(classAgg).map(function (k) {
      var c = classAgg[k];
      var occ = c.cap > 0 ? Math.round((c.plazas / c.cap) * 1000) / 10 : 0;
      var avgPlazas = c.sesiones > 0 ? (Math.round((c.plazas / c.sesiones) * 10) / 10).toLocaleString('es-ES') : '0';
      var evalTxt = occ >= 60 ? 'Éxito Rotundo (Clase Llena)' : occ >= 30 ? 'Muy Buena Ocupación' : c.plazas > 0 ? 'Demanda Moderada' : 'Baja Asistencia';
      return [c.name, c.tipo, c.profe, c.sesiones, c.cap, c.plazas, occ.toLocaleString('es-ES', { minimumFractionDigits: 1 }) + ' %', avgPlazas, evalTxt];
    }).sort(function (a, b) { return b[5] - a[5]; });

    // Desempeño de Profesoras y Consultas
    var teacherStats = profes.map(function (p) {
      var mine = clases.filter(function (c) {
        return c.profesor_id === p.id && c.fecha_inicio && new Date(c.fecha_inicio) <= now;
      });
      var cap = 0, plazas = 0;
      mine.forEach(function (c) {
        cap += Number(c.capacidad_max || 10);
        plazas += (occPlazasByClase[c.id] || 0);
      });

      // Consultas de salud asociadas
      var consultas = 0;
      [resPsi, resNut].forEach(function (list) {
        list.forEach(function (r) {
          if (String(r.estado || 'confirmada') === 'cancelada') return;
          var c = claseMap[r.clase_id];
          if (c && c.profesor_id === p.id) consultas++;
        });
      });

      var occ = cap > 0 ? Math.round((plazas / cap) * 1000) / 10 : 0;
      var evalTxt = mine.length === 0 && consultas > 0 ? 'Especialista en Consultas' : occ >= 30 ? 'Alta Convocatoria' : 'Activa';
      var nombreProfe = ((p.nombre || '') + ' ' + (p.apellidos || '')).trim();

      return [nombreProfe, p.especialidad || '—', mine.length, plazas, cap, (cap > 0 ? occ.toLocaleString('es-ES', { minimumFractionDigits: 1 }) + ' %' : '—'), consultas, evalTxt];
    }).sort(function (a, b) { return b[3] - a[3]; });

    // ----------------------------------------------------------------
    // DETALLE DE VENTAS INDIVIDUALES (HISTÓRICO)
    // ----------------------------------------------------------------
    var salesDetailRows = purchases.map(function (s) {
      var isPaid = String(s.payment_status || '').toLowerCase() === 'paid';
      var u = profileMap[s.user_id];
      var prod = categorizeProduct({
        purchase_type: s.purchase_type,
        product_name: (prodMap[s.price_id] && prodMap[s.price_id].nombre) || ''
      });

      var buyerName = u ? (u.nombrePila + ' (' + u.genero.charAt(0) + (u.edad ? ', ' + u.edad + 'a' : '') + ')') : (s.is_guest ? 'Invitada' : 'Cliente Web');

      return [
        fmtDate(s.fulfilled_at || s.created_at),
        fmtTime(s.fulfilled_at || s.created_at),
        prod.label,
        prod.cat,
        euros(s.amount_total),
        s.currency || 'eur',
        isPaid ? 'Cobrado' : String(s.payment_status || '—'),
        s.is_guest ? 'Invitada' : 'Registrada',
        buyerName
      ];
    });

    // ----------------------------------------------------------------
    // DETALLE DE SESIONES DE CLASES
    // ----------------------------------------------------------------
    var classDetailRows = [];
    clases.forEach(function (c) {
      if (!c.fecha_inicio || new Date(c.fecha_inicio) > now) return;
      var v = verticalOfClase(c);
      if (v !== 'Yoga' && v !== 'Talleres') return;
      var cap = Number(c.capacidad_max || 10);
      var ocu = occPlazasByClase[c.id] || 0;
      var occ = cap > 0 ? Math.round((ocu / cap) * 100) : 0;
      var profe = (profMap[c.profesor_id] && profMap[c.profesor_id].nombre) || '—';

      classDetailRows.push([
        fmtDate(c.fecha_inicio),
        fmtTime(c.fecha_inicio),
        c.nombre || 'Sesión',
        profe,
        v,
        cap,
        ocu,
        occ + ' %'
      ]);
    });
    classDetailRows.sort(function (a, b) { return new Date(b[0] + ' ' + b[1]) - new Date(a[0] + ' ' + a[1]); });

    // ----------------------------------------------------------------
    // AUDITORÍA DE FUENTES
    // ----------------------------------------------------------------
    var sourcesAuditRows = ALLOWED_SOURCES.map(function (t) {
      var s = data[t];
      return [t, s ? s.rows.length + ' registros' : 'No consultada', s ? (s.status === 'ok' ? 'OK (Sincronizado)' : s.status) : '—', 'Extracción completa sin límites'];
    });

    // ----------------------------------------------------------------
    // TABLA COMPARATIVA PRINCIPAL: LOS 4 HORIZONTES LADO A LADO
    // ----------------------------------------------------------------
    var kpisComparisonTable = [
      ['Facturación Total Cobrada', euros(H.hist.revCents), euros(H['1y'].revCents), euros(H['3m'].revCents), euros(H['1m'].revCents)],
      ['Número de Ventas / Cobros', H.hist.salesCount, H['1y'].salesCount, H['3m'].salesCount, H['1m'].salesCount],
      ['Ticket Medio de Venta', euros(H.hist.avgTicketCents), euros(H['1y'].avgTicketCents), euros(H['3m'].avgTicketCents), euros(H['1m'].avgTicketCents)],
      ['Nuevas Clientas Registradas', H.hist.newClients, H['1y'].newClients, H['3m'].newClients, H['1m'].newClients],
      ['Clientas Compradoras Únicas', H.hist.uniqueBuyersCount, H['1y'].uniqueBuyersCount, H['3m'].uniqueBuyersCount, H['1m'].uniqueBuyersCount],
      ['Compradoras Recurrentes (2+ compras)', H.hist.recurringBuyers, H['1y'].recurringBuyers, H['3m'].recurringBuyers, H['1m'].recurringBuyers],
      ['Tasa de Recurrencia de Compra', H.hist.recurrenceRate.toLocaleString('es-ES') + ' %', H['1y'].recurrenceRate.toLocaleString('es-ES') + ' %', H['3m'].recurrenceRate.toLocaleString('es-ES') + ' %', H['1m'].recurrenceRate.toLocaleString('es-ES') + ' %'],
      ['Edad Media de Compradoras', H.hist.buyerAvgAge ? H.hist.buyerAvgAge.toLocaleString('es-ES') + ' años' : '—', H['1y'].buyerAvgAge ? H['1y'].buyerAvgAge.toLocaleString('es-ES') + ' años' : '—', H['3m'].buyerAvgAge ? H['3m'].buyerAvgAge.toLocaleString('es-ES') + ' años' : '—', H['1m'].buyerAvgAge ? H['1m'].buyerAvgAge.toLocaleString('es-ES') + ' años' : '—'],
      ['Compradores Mujeres (%)', pctStr(H.hist.buyerGenders.Femenino.buyers, H.hist.uniqueBuyersCount), pctStr(H['1y'].buyerGenders.Femenino.buyers, H['1y'].uniqueBuyersCount), pctStr(H['3m'].buyerGenders.Femenino.buyers, H['3m'].uniqueBuyersCount), pctStr(H['1m'].buyerGenders.Femenino.buyers, H['1m'].uniqueBuyersCount)],
      ['Compradores Hombres (%)', pctStr(H.hist.buyerGenders.Masculino.buyers, H.hist.uniqueBuyersCount), pctStr(H['1y'].buyerGenders.Masculino.buyers, H['1y'].uniqueBuyersCount), pctStr(H['3m'].buyerGenders.Masculino.buyers, H['3m'].uniqueBuyersCount), pctStr(H['1m'].buyerGenders.Masculino.buyers, H['1m'].uniqueBuyersCount)],
      ['Reservas Confirmadas de Yoga', H.hist.yogaConf, H['1y'].yogaConf, H['3m'].yogaConf, H['1m'].yogaConf],
      ['Reservas de Consultas de Salud', H.hist.consultasConf, H['1y'].consultasConf, H['3m'].consultasConf, H['1m'].consultasConf],
      ['Total Plazas Reservadas (Yoga/Talleres)', H.hist.totalPlazasBooked, H['1y'].totalPlazasBooked, H['3m'].totalPlazasBooked, H['1m'].totalPlazasBooked],
      ['Tasa Media de Ocupación (% aforo)', H.hist.occRate.toLocaleString('es-ES') + ' %', H['1y'].occRate.toLocaleString('es-ES') + ' %', H['3m'].occRate.toLocaleString('es-ES') + ' %', H['1m'].occRate.toLocaleString('es-ES') + ' %'],
      ['Tasa de Cancelación de Reservas', H.hist.cancRate.toLocaleString('es-ES') + ' %', H['1y'].cancRate.toLocaleString('es-ES') + ' %', H['3m'].cancRate.toLocaleString('es-ES') + ' %', H['1m'].cancRate.toLocaleString('es-ES') + ' %'],
      ['Día con Mayor Afluencia', H.hist.topDay, H['1y'].topDay, H['3m'].topDay, H['1m'].topDay],
      ['Horario Punta Más Concurrido', H.hist.topHour, H['1y'].topHour, H['3m'].topHour, H['1m'].topHour],
      ['Producto Líder por Facturación', H.hist.topProdRev, H['1y'].topProdRev, H['3m'].topProdRev, H['1m'].topProdRev],
      ['Producto Líder por Unidades', H.hist.topProdUnits, H['1y'].topProdUnits, H['3m'].topProdUnits, H['1m'].topProdUnits]
    ];

    // Desglose de compradores por tramo de edad
    var buyersAgeRows = AGE_BRACKETS_ORDER.map(function (b) {
      var stat = H.hist.buyerAgeBrackets[b];
      var pctBuyers = H.hist.uniqueBuyersCount > 0 ? pctStr(stat.buyers, H.hist.uniqueBuyersCount) : '0,0 %';
      var pctFact = H.hist.revCents > 0 ? pctStr(stat.cents, H.hist.revCents) : '0,0 %';
      var avgTk = stat.n > 0 ? euros(stat.cents / stat.n) : '—';
      return [b, stat.buyers, pctBuyers, stat.n, euros(stat.cents), pctFact, avgTk];
    });

    // Desglose de compradores por género
    var buyersGenderRows = ['Femenino', 'Masculino', 'No determinado'].map(function (g) {
      var stat = H.hist.buyerGenders[g];
      var pctBuyers = H.hist.uniqueBuyersCount > 0 ? pctStr(stat.buyers, H.hist.uniqueBuyersCount) : '0,0 %';
      var pctFact = H.hist.revCents > 0 ? pctStr(stat.cents, H.hist.revCents) : '0,0 %';
      var avgTk = stat.n > 0 ? euros(stat.cents / stat.n) : '—';
      return [g === 'Femenino' ? 'Mujeres (Femenino)' : g === 'Masculino' ? 'Hombres (Masculino)' : 'No determinado', stat.buyers, pctBuyers, stat.n, euros(stat.cents), pctFact, avgTk];
    });

    // Top compradores
    var topBuyersRows = Object.keys(H.hist.buyerSpentCents).map(function (uid) {
      var u = profileMap[uid];
      var name = u ? (u.nombrePila + ' ' + (u.nombre.split(' ')[1] ? u.nombre.split(' ')[1].charAt(0) + '.' : '')) : (uid === 'invitada' ? 'Invitada Web' : 'Cliente');
      var spent = H.hist.buyerSpentCents[uid] || 0;
      var n = H.hist.buyerPurchasesCount[uid] || 0;
      var gen = u ? u.genero : '—';
      var edad = u && u.edad ? u.edad + ' años' : '—';
      return { row: [name, n, euros(spent), euros(spent / (n || 1)), gen, edad], spent: spent };
    }).sort(function (a, b) { return b.spent - a.spent; }).map(function (item) { return item.row; });

    // Estructura completa de hojas de Excel
    var sheets = [
      {
        name: 'Resumen Ejecutivo',
        head: ['Indicador de Negocio', 'Histórico Total', 'Último Año (12m)', 'Últimos 3 Meses (90d)', 'Último Mes (30d)'],
        rows: kpisComparisonTable
      },
      {
        name: 'Demografía Compradores',
        head: ['Tramo de Edad', 'Compradores Únicos', '% Compradores', 'Compras Realizadas', 'Facturación Total (€)', '% Facturación', 'Ticket Medio (€)'],
        rows: buyersAgeRows.concat([
          ['', '', '', '', '', '', ''],
          ['GÉNERO', 'Compradores Únicos', '% Compradores', 'Compras Realizadas', 'Facturación Total (€)', '% Facturación', 'Ticket Medio (€)']
        ]).concat(buyersGenderRows)
      },
      {
        name: 'Qué Compran (Productos)',
        head: ['Producto / Servicio', 'Categoría', 'Uds (Hist)', '€ (Histórico)', 'Uds (1 Año)', '€ (1 Año)', 'Uds (3 Meses)', '€ (3 Meses)', 'Uds (1 Mes)', '€ (1 Mes)', 'Ticket Medio (€)', '% Facturación'],
        rows: productMatrixRows.map(function (p) {
          return [p.label, p.cat, p.nHist, p.revHist, p.n1y, p.rev1y, p.n3m, p.rev3m, p.n1m, p.rev1m, p.ticketMedio, p.pctFacturacion];
        })
      },
      {
        name: 'Mejores Horarios',
        head: ['Día de la Semana', 'Sesiones Programadas', 'Aforo Ofertado', 'Plazas Reservadas', 'Tasa Ocupación Media', 'Diagnóstico Demanda'],
        rows: daysReportRows.concat([
          ['', '', '', '', '', ''],
          ['FRANJA HORARIA', 'Sesiones', 'Aforo Ofertado', 'Plazas Reservadas', 'Tasa Ocupación Media', 'Diagnóstico']
        ]).concat(slotReportRows).concat([
          ['', '', '', '', '', ''],
          ['RANKING HORAS PUNTA', 'Plazas Reservadas', 'Sesiones Impartidas', 'Media Asistentes/Sesión', 'Tasa Ocupación', '']
        ]).concat(peakHoursRows.slice(0, 15).map(function (r) { return [r[0], r[1], r[2], r[3], r[4], 'Hora Concurrida']; }))
      },
      {
        name: 'Mapa Calor (Día x Franja)',
        head: ['Día de la Semana', 'Mañana (07-13h)', 'Mediodía (13-16h)', 'Tarde (16-19:30h)', 'Noche (19:30-22h)', 'Total Día (Plazas y %)'],
        rows: heatmapMatrixRows
      },
      {
        name: 'Mejores Clases',
        head: ['Clase / Sesión', 'Disciplina', 'Profesora Principal', 'Sesiones Impartidas', 'Aforo Total', 'Plazas Reservadas', 'Tasa Ocupación Media', 'Media Alumnos/Sesión', 'Evaluación'],
        rows: classRankingRows
      },
      {
        name: 'Profesoras',
        head: ['Profesional', 'Especialidad', 'Clases Impartidas', 'Plazas Reservadas', 'Aforo Ofertado', 'Tasa Ocupación Media', 'Consultas Privadas', 'Evaluación'],
        rows: teacherStats
      },
      {
        name: 'Fidelización Clientes',
        head: ['Comportamiento', 'Compradores', '% Total', 'Facturación (€)'],
        rows: [
          ['Compradores de 1 sola compra', (H.hist.uniqueBuyersCount - H.hist.recurringBuyers), pctStr(H.hist.uniqueBuyersCount - H.hist.recurringBuyers, H.hist.uniqueBuyersCount), '—'],
          ['Compradores recurrentes (2 o más compras)', H.hist.recurringBuyers, pctStr(H.hist.recurringBuyers, H.hist.uniqueBuyersCount), '—'],
          ['Base total de compradores', H.hist.uniqueBuyersCount, '100 %', euros(H.hist.revCents)]
        ].concat([
          ['', '', '', ''],
          ['TOP COMPRADORES', 'Compras Realizadas', 'Total Gastado (€)', 'Ticket Medio (€)']
        ]).concat(topBuyersRows.slice(0, 20).map(function (r) { return [r[0], r[1], r[2], r[3]]; }))
      },
      {
        name: 'Detalle Ventas',
        head: ['Fecha', 'Hora', 'Producto / Concepto', 'Categoría', 'Importe (€)', 'Moneda', 'Estado Pago', 'Canal Cliente', 'Comprador (Ref)'],
        rows: salesDetailRows
      },
      {
        name: 'Detalle Clases',
        head: ['Fecha', 'Hora', 'Clase', 'Profesora', 'Disciplina', 'Capacidad Aforo', 'Plazas Reservadas', 'Tasa Ocupación (%)'],
        rows: classDetailRows.slice(0, 500)
      },
      {
        name: 'Auditoría Fuentes',
        head: ['Tabla Supabase', 'Registros Cargados', 'Estado de Conexión', 'Notas Técnicas'],
        rows: sourcesAuditRows
      }
    ];

    return {
      version: REPORT_VERSION,
      generatedAt: now.toLocaleString('es-ES', { timeZone: MADRID_TZ }),
      horizons: H,
      productMatrixRows: productMatrixRows,
      daysReportRows: daysReportRows,
      slotReportRows: slotReportRows,
      peakHoursRows: peakHoursRows,
      heatmapMatrixRows: heatmapMatrixRows,
      classRankingRows: classRankingRows,
      teacherStats: teacherStats,
      buyersAgeRows: buyersAgeRows,
      buyersGenderRows: buyersGenderRows,
      topBuyersRows: topBuyersRows,
      kpisComparisonTable: kpisComparisonTable,
      sheets: sheets
    };
  }

  // ------------------------------------------------------------------
  // EXPORTACIÓN A EXCEL (.XLSX MULTI-HOJA CON SHEETJS)
  // ------------------------------------------------------------------
  function downloadExcel(report) {
    var fname = 'GEN-Yoga-Informe-Direccion-' + fileStamp() + '.xlsx';

    if (window.XLSX && window.XLSX.utils) {
      var wb = window.XLSX.utils.book_new();

      report.sheets.forEach(function (sh) {
        var ws = window.XLSX.utils.aoa_to_sheet([sh.head].concat(sh.rows));

        // Auto-ancho de columnas optimizado
        ws['!cols'] = sh.head.map(function (h, i) {
          var maxLen = String(h || '').length;
          for (var r = 0; r < Math.min(sh.rows.length, 60); r++) {
            var cellVal = String((sh.rows[r] && sh.rows[r][i]) || '');
            if (cellVal.length > maxLen) maxLen = cellVal.length;
          }
          return { wch: Math.min(48, Math.max(13, maxLen + 3)) };
        });

        var safeName = sh.name.substring(0, 31).replace(/[\\/?*[\]]/g, '-');
        window.XLSX.utils.book_append_sheet(wb, ws, safeName);
      });

      window.XLSX.writeFile(wb, fname);
      return { file: fname, via: 'Excel Multi-Hoja (.xlsx)' };
    }

    // Fallback CSV si SheetJS no estuviese cargado
    var sh0 = report.sheets[0];
    var csv = '\uFEFF' + [sh0.head].concat(sh0.rows).map(function (r) {
      return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(';');
    }).join('\r\n');

    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname.replace(/\.xlsx$/, '.csv');
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    return { file: a.download, via: 'CSV Compatible con Excel' };
  }

  // ------------------------------------------------------------------
  // EXPORTACIÓN A PDF: VISTA DE IMPRESIÓN PROFESIONAL DE ALTA DIRECCIÓN
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
      } catch (_) { /* noop */ }
    });
    return imgs;
  }

  function tableHtml(title, head, rows, limit, subtitle) {
    var maxR = limit || rows.length;
    var sliceRows = rows.slice(0, maxR);
    var body = sliceRows.map(function (r) {
      return '<tr>' + r.map(function (c, idx) {
        var align = idx === 0 ? 'left' : 'center';
        return '<td style="text-align:' + align + ';">' + escHtml(c) + '</td>';
      }).join('') + '</tr>';
    }).join('');

    var more = rows.length > maxR ? '<p class="rpt-note">+' + (rows.length - maxR) + ' filas adicionales incluidas en el archivo Excel completo.</p>' : '';
    return '<div class="rpt-table-card">' +
      '<div class="rpt-table-header">' +
        '<h3>' + escHtml(title) + '</h3>' +
        (subtitle ? '<div class="rpt-table-subtitle">' + escHtml(subtitle) + '</div>' : '') +
      '</div>' +
      '<table><thead><tr>' +
        head.map(function (h, idx) {
          var align = idx === 0 ? 'left' : 'center';
          return '<th style="text-align:' + align + ';">' + escHtml(h) + '</th>';
        }).join('') +
      '</tr></thead><tbody>' + body + '</tbody></table>' + more +
    '</div>';
  }

  function downloadPdf(report) {
    var old = document.getElementById('marketing-report-print');
    if (old) old.remove();
    var oldCss = document.getElementById('marketing-report-print-css');
    if (oldCss) oldCss.remove();

    var css = document.createElement('style');
    css.id = 'marketing-report-print-css';
    css.textContent = '@media print {' +
      '  @page { size: A4 portrait; margin: 10mm 12mm 14mm 12mm; }' +
      '  body > *:not(#marketing-report-print) { display: none !important; }' +
      '  #marketing-report-print { display: block !important; }' +
      '}' +
      '#marketing-report-print {' +
      '  display: none;' +
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;' +
      '  color: #2b1f1a;' +
      '  background: #ffffff;' +
      '  padding: 24px;' +
      '  line-height: 1.45;' +
      '}' +
      '#marketing-report-print h1 { font-size: 24px; font-weight: 800; color: #3c2a21; margin: 0 0 4px; letter-spacing: -0.5px; }' +
      '#marketing-report-print h2 { font-size: 15px; font-weight: 700; color: #795244; margin: 22px 0 10px; border-bottom: 2px solid #e7dcd1; padding-bottom: 5px; text-transform: uppercase; letter-spacing: 0.5px; page-break-after: avoid; }' +
      '#marketing-report-print .rpt-header-box { border-bottom: 3px solid #795244; padding-bottom: 14px; margin-bottom: 20px; }' +
      '#marketing-report-print .rpt-badge { display: inline-block; background: #795244; color: #ffffff; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }' +
      '#marketing-report-print .rpt-meta { font-size: 11px; color: #7d6e65; margin-top: 4px; }' +
      '#marketing-report-print .rpt-kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }' +
      '#marketing-report-print .rpt-kpi-card { background: #faf6f1; border: 1px solid #ebdccb; border-radius: 8px; padding: 12px; text-align: center; }' +
      '#marketing-report-print .rpt-kpi-val { font-size: 19px; font-weight: 800; color: #3c2a21; margin: 2px 0; }' +
      '#marketing-report-print .rpt-kpi-sub { font-size: 10px; color: #795244; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }' +
      '#marketing-report-print .rpt-kpi-detail { font-size: 10px; color: #666; margin-top: 2px; }' +
      '#marketing-report-print .rpt-table-card { margin-bottom: 16px; page-break-inside: avoid; }' +
      '#marketing-report-print .rpt-table-header { margin-bottom: 6px; }' +
      '#marketing-report-print .rpt-table-header h3 { font-size: 13px; font-weight: 700; color: #3c2a21; margin: 0; }' +
      '#marketing-report-print .rpt-table-subtitle { font-size: 10px; color: #7d6e65; margin-top: 2px; }' +
      '#marketing-report-print table { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-bottom: 6px; }' +
      '#marketing-report-print th, #marketing-report-print td { border: 1px solid #e2d5c7; padding: 5px 8px; }' +
      '#marketing-report-print th { background: #f3ece1; color: #3c2a21; font-weight: 700; text-transform: uppercase; font-size: 9.5px; letter-spacing: 0.3px; }' +
      '#marketing-report-print tr:nth-child(even) td { background: #fdfbf8; }' +
      '#marketing-report-print .rpt-note { font-size: 9.5px; color: #8c7b70; margin: 2px 0 10px; font-style: italic; }' +
      '#marketing-report-print .rpt-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; page-break-inside: avoid; }' +
      '#marketing-report-print img.rpt-chart { max-width: 100%; margin: 8px 0; border: 1px solid #e7dcd1; border-radius: 6px; page-break-inside: avoid; }';
    document.head.appendChild(css);

    var H = report.horizons;

    // Tarjetas destacadas superiores
    var kpiCardsHtml =
      '<div class="rpt-kpi-grid">' +
        '<div class="rpt-kpi-card">' +
          '<div class="rpt-kpi-sub">Facturación Histórica</div>' +
          '<div class="rpt-kpi-val">' + euros(H.hist.revCents) + '</div>' +
          '<div class="rpt-kpi-detail">Último mes: ' + euros(H['1m'].revCents) + ' (' + H['1m'].salesCount + ' ventas)</div>' +
        '</div>' +
        '<div class="rpt-kpi-card">' +
          '<div class="rpt-kpi-sub">Perfil Comprador</div>' +
          '<div class="rpt-kpi-val">' + (H.hist.buyerAvgAge ? H.hist.buyerAvgAge.toLocaleString('es-ES') + ' años' : '—') + '</div>' +
          '<div class="rpt-kpi-detail">' + pctStr(H.hist.buyerGenders.Femenino.buyers, H.hist.uniqueBuyersCount) + ' Femenino · ' + H.hist.uniqueBuyersCount + ' compradoras</div>' +
        '</div>' +
        '<div class="rpt-kpi-card">' +
          '<div class="rpt-kpi-sub">Producto Más Vendido</div>' +
          '<div class="rpt-kpi-val" style="font-size:16px;">' + escHtml(H.hist.topProdRev) + '</div>' +
          '<div class="rpt-kpi-detail">Mayor volumen: ' + escHtml(H.hist.topProdUnits) + '</div>' +
        '</div>' +
        '<div class="rpt-kpi-card">' +
          '<div class="rpt-kpi-sub">Horario y Día Estrella</div>' +
          '<div class="rpt-kpi-val">' + escHtml(H.hist.topDay) + ' · ' + escHtml(H.hist.topHour) + '</div>' +
          '<div class="rpt-kpi-detail">Ocupación media global: ' + H.hist.occRate.toLocaleString('es-ES') + ' %</div>' +
        '</div>' +
      '</div>';

    // Gráficas del dashboard
    var charts = chartImages().map(function (c) {
      return '<img class="rpt-chart" src="' + c.src + '" alt="Gráfica dashboard"/>';
    }).join('');

    var div = document.createElement('div');
    div.id = 'marketing-report-print';
    div.innerHTML =
      '<div class="rpt-header-box">' +
        '<div class="rpt-badge">GEN Yoga · Informe Estratégico y de Dirección</div>' +
        '<h1>Análisis de Negocio, Demografía y Demanda</h1>' +
        '<div class="rpt-meta">Generado el ' + escHtml(report.generatedAt) + ' · Análisis comparativo multitemporal (Histórico Total, 1 Año, 3 Meses y 30 Días) · Datos oficiales de Supabase</div>' +
      '</div>' +

      kpiCardsHtml +

      '<h2>1. Cuadro de Mandos Comparativo Multitemporal</h2>' +
      tableHtml('Indicadores Clave del Gimnasio (4 Horizontes)', ['Métrica Empresarial', 'Histórico Total', 'Último Año (12m)', 'Últimos 3 Meses', 'Último Mes (30d)'], report.kpisComparisonTable, 25, 'Visión longitudinal y reciente del rendimiento económico y operativo') +

      '<h2>2. ¿Quiénes nos compran? (Perfil Demográfico y Fidelización)</h2>' +
      '<div class="rpt-two-col">' +
        tableHtml('Distribución por Edad de Compradores', ['Tramo de Edad', 'Compradores', '% Comp.', 'Ventas', 'Total Cobrado', 'Ticket Medio'], report.buyersAgeRows, 10, '¿Qué edades compran y cuánto gastan?') +
        tableHtml('Distribución por Género de Compradores', ['Género Estimado', 'Compradores', '% Comp.', 'Ventas', 'Total Cobrado', 'Ticket Medio'], report.buyersGenderRows, 5, '¿Quién aporta más ingresos?') +
      '</div>' +

      '<h2>3. ¿Qué compran más? (Productos, Bonos y Facturación)</h2>' +
      tableHtml('Matriz Completa de Ventas por Producto en los 4 Periodos', ['Producto / Servicio', 'Categoría', 'Uds (Hist)', '€ (Histórico)', 'Uds (1 Año)', '€ (1 Año)', 'Uds (3m)', '€ (3m)', 'Uds (1m)', '€ (1m)', 'Ticket Medio'], report.productMatrixRows.map(function (p) {
        return [p.label, p.cat, p.nHist, p.revHist, p.n1y, p.rev1y, p.n3m, p.rev3m, p.n1m, p.rev1m, p.ticketMedio];
      }), 15, 'Evolución de ventas por producto: histórico vs últimos meses') +

      '<h2>4. ¿Qué horarios y clases van mejor? (Ocupación y Afluencia)</h2>' +
      '<div class="rpt-two-col">' +
        tableHtml('Afluencia por Día de la Semana', ['Día', 'Sesiones', 'Aforo', 'Plazas', 'Ocupación %', 'Diagnóstico'], report.daysReportRows, 8, 'Días de mayor aforo y asistencia') +
        tableHtml('Horas Punta Más Concurridas', ['Hora Inicio', 'Plazas Reservadas', 'Sesiones', 'Media Asistentes', 'Tasa Ocupación'], report.peakHoursRows, 8, 'Horas de máxima afluencia del gimnasio') +
      '</div>' +

      tableHtml('Ranking de Clases por Plazas Reservadas y Ocupación', ['Clase', 'Disciplina', 'Profesora Principal', 'Sesiones', 'Aforo Total', 'Plazas Reservadas', 'Tasa Ocupación Media', 'Alumnos/Sesión', 'Evaluación'], report.classRankingRows, 12, 'Las clases más demandadas vs oportunidades de mejora') +

      '<h2>5. Rendimiento del Equipo de Profesoras y Consultas</h2>' +
      tableHtml('Desempeño del Profesorado y Profesionales de Salud', ['Profesional', 'Especialidad', 'Clases', 'Plazas Ocupadas', 'Aforo Ofertado', 'Ocupación Media', 'Consultas Privadas', 'Evaluación'], report.teacherStats, 10, 'Convocatoria y rendimiento de cada profesional') +

      (charts ? '<h2>6. Gráficas del Dashboard Ejecutivo</h2>' + charts : '');

    document.body.appendChild(div);
    window.print();
    return { via: 'PDF (diálogo de impresión nativo del navegador)' };
  }

  // ------------------------------------------------------------------ 
  // CONTROLADOR PRINCIPAL LLAMADO DESDE PROFILE.HTML
  // ------------------------------------------------------------------
  async function descargarInformeMarketing(formato) {
    if (!INFORME_MARKETING_ENABLED) {
      swalError('No disponible', 'La descarga de informes está desactivada actualmente.');
      return;
    }
    if (window.__gyInformeBusy) return;

    try {
      // eslint-disable-next-line no-undef
      if (typeof isAdmin !== 'undefined' && !isAdmin) {
        swalError('Sin permiso', 'El informe estratégico de dirección solo está disponible para administración.');
        return;
      }
    } catch (_) { /* noop */ }

    if (!getClient()) {
      swalError('Sin conexión', 'No hay conexión con la base de datos Supabase. Revisa tu conexión.');
      return;
    }

    window.__gyInformeBusy = true;
    var prog = null;
    if (window.Swal && window.Swal.fire) {
      prog = window.Swal.fire({
        title: 'Generando informe estratégico…',
        html: 'Extrayendo datos históricos completos, demografía y ocupación en 4 horizontes.',
        allowOutsideClick: false,
        didOpen: function () { window.Swal.showLoading(); }
      });
    }

    try {
      var data = await fetchAllReportData();
      var report = buildMasterReport(data);

      var failed = Object.keys(data).filter(function (t) { return data[t].status !== 'ok'; });
      var res = formato === 'pdf' ? downloadPdf(report) : downloadExcel(report);

      if (window.Swal && window.Swal.fire) {
        window.Swal.fire({
          icon: failed.length ? 'warning' : 'success',
          title: formato === 'pdf' ? 'Informe listo para imprimir / PDF' : 'Informe Excel descargado',
          html: (formato === 'pdf'
            ? 'Se ha abierto la vista de impresión ejecutiva. Elige <strong>"Guardar como PDF"</strong> en la impresora.'
            : 'Archivo <strong>' + escHtml(res.file) + '</strong> generado con 10 hojas de análisis.') +
            (failed.length ? '<br><br><span style="font-size:11px;color:#c0392b;">Fuentes no disponibles: ' + escHtml(failed.join(', ')) + '.</span>' : ''),
          confirmButtonColor: '#795244'
        });
      }
    } catch (err) {
      if (prog && window.Swal) { try { window.Swal.close(); } catch (_) { /* noop */ } }
      swalError('Error al generar informe', (err && err.message) || String(err));
    } finally {
      window.__gyInformeBusy = false;
    }
  }

  // Conciliación Stripe <-> BD
  async function ejecutarConciliacionPagos() {
    if (window.__gyConciliacionBusy) return;
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

    window.__gyConciliacionBusy = true;
    const btnConciliar = document.getElementById('btn-conciliar-pagos');
    if (btnConciliar) btnConciliar.disabled = true;

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
    } finally {
      window.__gyConciliacionBusy = false;
      const btnConciliarFinal = document.getElementById('btn-conciliar-pagos');
      if (btnConciliarFinal) btnConciliarFinal.disabled = false;
    }
  }

  // Exportar al ámbito global
  window.descargarInformeMarketing = descargarInformeMarketing;
  window.ejecutarConciliacionPagos = ejecutarConciliacionPagos;
  window.GENMarketingReport = {
    version: REPORT_VERSION,
    descargarInformeMarketing: descargarInformeMarketing,
    buildMasterReport: buildMasterReport,
    fetchAllReportData: fetchAllReportData,
    _helpers: {
      fmtDate: fmtDate,
      fmtMonth: fmtMonth,
      fmtTime: fmtTime,
      fmtDateTime: fmtDateTime,
      monthKey: monthKey,
      weekdayEs: weekdayEs,
      getSlotInfo: getSlotInfo,
      calculateAge: calculateAge,
      getAgeBracket: getAgeBracket,
      estimateGender: estimateGender,
      categorizeProduct: categorizeProduct
    }
  };

  // Mostrar botones al cargar el DOM si está habilitado
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', function () {
      if (!INFORME_MARKETING_ENABLED) return;
      var esAdmin = false;
      try { esAdmin = typeof isAdmin !== 'undefined' && !!isAdmin; } catch (_) { esAdmin = false; }
      ['btn-informe-excel', 'btn-informe-pdf', 'btn-conciliar-pagos'].forEach(function (id) {
        var b = document.getElementById(id);
        if (b) {
          b.classList.remove('hidden');
          // Solo se habilita el clic cuando el rol resuelto es admin (si el rol
          // llega después, cargarDashboardAdmin() los habilita al abrir el panel).
          if (esAdmin) b.disabled = false;
        }
      });
    });
  }
})();
