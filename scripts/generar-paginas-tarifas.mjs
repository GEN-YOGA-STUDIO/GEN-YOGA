import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const baseHtml = await fs.readFile(path.join(root, 'tarifas.html'), 'utf8');

const pagesConfig = [
  {
    file: 'ofertas.html',
    category: 'ofertas',
    title: 'Ofertas y Promociones | GEN Yoga',
    description: 'Consulta las ofertas y promociones especiales de GEN Yoga: Bono de Bienvenida gratuito para nuevos alumnos.',
    pageTitleKey: 'page_title_ofertas',
    activeColor: '#047857',
    symbolId: 'symbol-clases',
    sectionDisplay: 'block',
  },
  {
    file: 'clases_yoga.html',
    category: 'yoga',
    title: 'Tarifas de Clases de Yoga y Bonos | GEN Yoga',
    description: 'Consulta las tarifas de clases sueltas, bonos mensuales e ilimitados de GEN Yoga.',
    pageTitleKey: 'page_title_clases_yoga',
    activeColor: '#795244',
    symbolId: 'symbol-clases',
    sectionDisplay: 'grid',
  },
  {
    file: 'consultas.html',
    category: 'psicologia',
    title: 'Tarifas de Consultas de Psicología, Ayurveda y Salud | GEN Yoga',
    description: 'Tarifas de acompañamiento psicoterapéutico con Miriam, consultas de Ayurveda con Silvia y salud integral PNI con Isabel en GEN Yoga.',
    pageTitleKey: 'page_title_consultas',
    activeColor: '#8f6b2d',
    symbolId: 'symbol-consultas',
    sectionDisplay: 'grid',
  },
  {
    file: 'eventos.html',
    category: 'talleres',
    title: 'Tarifas de Talleres y Eventos Especiales | GEN Yoga',
    description: 'Consulta los próximos talleres monográficos y clases especiales de fin de semana en GEN Yoga.',
    pageTitleKey: 'page_title_eventos',
    activeColor: '#6a6540',
    symbolId: 'symbol-talleres',
    sectionDisplay: 'block',
  },
];

for (const cfg of pagesConfig) {
  let content = baseHtml;

  // SEO y Canonical
  content = content.replaceAll('https://genyoga.studio/tarifas.html', `https://genyoga.studio/${cfg.file}`);
  content = content.replace(/<title>.*?<\/title>/i, `<title>${cfg.title}</title>`);
  content = content.replace(/<meta property="og:title" content=".*?" \/>/i, `<meta property="og:title" content="${cfg.title}" />`);
  content = content.replace(/<meta name="description" content=".*?" \/>/i, `<meta name="description" content="${cfg.description}" />`);
  content = content.replace(/<meta property="og:description" content=".*?" \/>/i, `<meta property="og:description" content="${cfg.description}" />`);
  content = content.replace(/data-page-title-key="page_title_tarifas"/i, `data-page-title-key="${cfg.pageTitleKey}"`);

  // Estado inicial de pestañas
  const tabIds = {
    ofertas: 'tab-ofertas',
    yoga: 'tab-yoga',
    psicologia: 'tab-psicologia',
    talleres: 'tab-talleres',
  };

  for (const [cat, tabId] of Object.entries(tabIds)) {
    const isActive = cat === cfg.category;
    const tabRegex = new RegExp(`(<a id="${tabId}"[\\s\\S]*?aria-selected=")(true|false)(")([\\s\\S]*?class="[^"]*?bg-\\[#)(?:047857|795244|8f6b2d|6a6540|c3b89a)(\\]\\s+text-)(?:white|black)`, 'i');
    content = content.replace(tabRegex, (m, p1, p2, p3, p4, p5) => {
      const color = isActive ? cfg.activeColor.replace('#', '').toLowerCase() : 'c3b89a';
      const textColor = isActive ? 'white' : 'black';
      return `${p1}${isActive ? 'true' : 'false'}${p3}${p4}${color}] text-${textColor}`;
    });
  }

  // Estado inicial de secciones (mostrar la activa, ocultar las demás)
  const sections = ['section-ofertas', 'section-yoga', 'section-psicologia', 'section-talleres'];
  const activeSecId = `section-${cfg.category}`;

  for (const secId of sections) {
    const isActiveSec = secId === activeSecId;
    if (isActiveSec) {
      // Activar sección
      const secRegex = new RegExp(`(<div id="${secId}" role="tabpanel"[^>]*?style=")([^"]*?)(")`, 'i');
      content = content.replace(secRegex, `$1display: ${cfg.sectionDisplay}; opacity: 1; transform: translateY(0);$3`);
      // Asegurarse de que no tenga hidden
      content = content.replace(new RegExp(`(id="${secId}"[^>]*?)(\\bhidden\\b)`, 'i'), '$1');
      content = content.replace(new RegExp(`(id="${secId}"[^>]*?)(\\bopacity-0\\b)`, 'i'), '$1');
      content = content.replace(new RegExp(`(id="${secId}"[^>]*?)(\\btranslate-y-\\[20px\\]\\b)`, 'i'), '$1');
    } else {
      // Desactivar sección
      const secRegex = new RegExp(`(<div id="${secId}" role="tabpanel"[^>]*?style=")([^"]*?)(")`, 'i');
      content = content.replace(secRegex, `$1display: none; opacity: 0; transform: translateY(10px);$3`);
      content = content.replace(new RegExp(`(id="${secId}" class=")([^"]*?)(")`), (m, p1, p2, p3) => {
        if (!p2.includes('hidden')) return `${p1}${p2} hidden opacity-0${p3}`;
        return m;
      });
    }
  }

  // Símbolos decorativos: activar solo el correspondiente
  const symbols = ['symbol-clases', 'symbol-consultas', 'symbol-talleres'];
  for (const symId of symbols) {
    const isSymActive = symId === cfg.symbolId;
    const symRegex = new RegExp(`(<img id="${symId}"[\\s\\S]*?class="[^"]*?)(\\bopacity-(?:0|95)\\b)([\\s\\S]*?transform\\s+translate-y-)(?:\\[20px\\]|0)`, 'i');
    content = content.replace(symRegex, `$1opacity-${isSymActive ? '95' : '0'}$3${isSymActive ? '0' : '[20px]'}`);
  }

  // DOMContentLoaded inicializar con la categoría de la página si no hay parámetro explícito
  content = content.replace(/updateLocalCategoryView\(['"]ofertas['"]\);/, `updateLocalCategoryView('${cfg.category}');`);

  const destPath = path.join(root, cfg.file);
  await fs.writeFile(destPath, content, 'utf8');
  console.log(`✅ Creada página: ${cfg.file} (${cfg.category})`);
}
