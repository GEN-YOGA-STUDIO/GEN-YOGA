const fs = require('fs');
const path = require('path');

function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    if (['node_modules','.git','.temp'].includes(f)) continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(html|css|js|mjs|ts)$/i.test(f)) {
      const content = fs.readFileSync(p, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (/cursor|pointer-events/i.test(line)) {
          if (/url|none|custom|wink|image|default|pointer|auto|style/i.test(line)) {
            console.log(`${p}:${idx+1}: ${line.trim()}`);
          }
        }
      });
    }
  }
}
walk('.');
