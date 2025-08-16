// scripts/generate-config.js
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('ERROR: Debes definir SUPABASE_URL y SUPABASE_ANON_KEY como variables de entorno antes de build.');
  // No fallar el build en Vercel si quieres, pero es mejor fallar para detectar config faltante
  process.exit(1);
}

const content = `// supabase-config.js (GENERADO EN BUILD - no subir claves al repo)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

export const SUPABASE_URL = ${JSON.stringify(SUPABASE_URL)};
export const SUPABASE_ANON_KEY = ${JSON.stringify(SUPABASE_ANON_KEY)};
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
`;

const outPath = path.resolve(process.cwd(), 'supabase-config.js');
fs.writeFileSync(outPath, content, { encoding: 'utf8' });
console.log('✅ supabase-config.js generado en', outPath);
