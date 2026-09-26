// Script to aggregate all project source files into a single unified Markdown file
import fs from 'fs';
import path from 'path';

const projectRoot = process.cwd();
const outputFile = path.join(projectRoot, 'tarteeb_medical_os.md');
const artifactOutput = path.join(
  'C:\\Users\\Toshiba\\.gemini\\antigravity-ide\\brain\\c32f6ced-e9df-4b0f-ba5a-b0db496385c3',
  'tarteeb_medical_os.md'
);

const includeExtensions = ['.ts', '.tsx', '.js', '.mjs', '.json', '.css', '.sql', '.md'];
const excludeDirs = ['node_modules', '.next', '.git', 'dist', 'coverage', '.cache'];
const excludeFiles = [
  'package-lock.json',
  'tarteeb_medical_os.md',
  'nashmi_ops_full_codebase.md',
  'project.zip',
  'tsconfig.tsbuildinfo',
  '.env',
  '.env.local',
];

function getFiles(dir: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);

  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat && stat.isDirectory()) {
      if (!excludeDirs.includes(file)) {
        results = results.concat(getFiles(filePath));
      }
    } else {
      const ext = path.extname(file);
      if (includeExtensions.includes(ext) && !excludeFiles.includes(file)) {
        // Skip huge data dumps if any
        if (file === 'nashmi_db.json' && stat.size > 100000) continue;
        results.push(filePath);
      }
    }
  }
  return results;
}

const targetDirs = [
  path.join(projectRoot, 'app'),
  path.join(projectRoot, 'components'),
  path.join(projectRoot, 'lib'),
  path.join(projectRoot, 'types'),
  path.join(projectRoot, 'supabase'),
  path.join(projectRoot, 'tests'),
  path.join(projectRoot, 'scripts'),
];

// Specific root files
const specificFiles = [
  path.join(projectRoot, 'package.json'),
  path.join(projectRoot, 'tsconfig.json'),
  path.join(projectRoot, 'vercel.json'),
  path.join(projectRoot, 'tailwind.config.ts'),
  path.join(projectRoot, 'next.config.ts'),
  path.join(projectRoot, 'postcss.config.mjs'),
  path.join(projectRoot, 'GEMINI.md'),
  path.join(projectRoot, 'bundle-codebase.ts'),
];

let allFiles: string[] = [];
for (const dir of targetDirs) {
  if (fs.existsSync(dir)) {
    allFiles = allFiles.concat(getFiles(dir));
  }
}
for (const sf of specificFiles) {
  if (fs.existsSync(sf) && !allFiles.includes(sf)) {
    allFiles.push(sf);
  }
}

// Remove duplicates and sort alphabetically
allFiles = Array.from(new Set(allFiles));
allFiles.sort((a, b) => {
  const relA = path.relative(projectRoot, a).toLowerCase();
  const relB = path.relative(projectRoot, b).toLowerCase();
  return relA.localeCompare(relB);
});

console.log(`Found ${allFiles.length} files to aggregate.`);

let mdContent = `# 🦷 كود مشروع نظام ترتيب لإدارة العيادات (Tarteeb Medical OS)
> **تاريخ التصدير:** ${new Date().toLocaleString('ar-JO', { timeZone: 'Asia/Amman' })}  
> **عدد الملفات:** ${allFiles.length} ملفاً برمجياً  
> **البنية:** Next.js 15, TypeScript, Supabase, Google GenAI (Gemini 3.5), JoFotara UBL 2.1 XML

---

## 📑 فهرس المحتويات (Index of Files)
`;

allFiles.forEach((file, index) => {
  const relPath = path.relative(projectRoot, file).replace(/\\/g, '/');
  const anchor = relPath.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  mdContent += `${index + 1}. [${relPath}](#${anchor})\n`;
});

mdContent += `\n---\n\n`;

for (const file of allFiles) {
  const relPath = path.relative(projectRoot, file).replace(/\\/g, '/');
  const anchor = relPath.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const ext = path.extname(file).replace('.', '') || 'text';
  const code = fs.readFileSync(file, 'utf-8');

  let lang = 'typescript';
  if (ext === 'tsx') lang = 'tsx';
  else if (ext === 'ts') lang = 'typescript';
  else if (ext === 'js' || ext === 'mjs') lang = 'javascript';
  else if (ext === 'json') lang = 'json';
  else if (ext === 'css') lang = 'css';
  else if (ext === 'sql') lang = 'sql';
  else if (ext === 'md') lang = 'markdown';

  mdContent += `## <a id="${anchor}"></a>📁 \`${relPath}\`\n\n`;
  mdContent += `\`\`\`${lang}\n// File: ${relPath}\n${code}\n\`\`\`\n\n---\n\n`;
}

// Write to project root
fs.writeFileSync(outputFile, mdContent, 'utf-8');
const legacyOutputFile = path.join(projectRoot, 'nashmi_ops_full_codebase.md');
fs.writeFileSync(legacyOutputFile, mdContent, 'utf-8');
console.log(`✅ Saved bundle to: ${outputFile} and ${legacyOutputFile} (${(Buffer.byteLength(mdContent) / 1024).toFixed(1)} KB)`);

// Also copy to artifacts directory
try {
  fs.writeFileSync(artifactOutput, mdContent, 'utf-8');
  const legacyArtifactOutput = path.join(
    'C:\\Users\\Toshiba\\.gemini\\antigravity-ide\\brain\\c32f6ced-e9df-4b0f-ba5a-b0db496385c3',
    'nashmi_ops_full_codebase.md'
  );
  fs.writeFileSync(legacyArtifactOutput, mdContent, 'utf-8');
  console.log(`✅ Saved copies to artifacts directory`);
} catch (e) {
  console.warn('Could not write to artifact dir:', e);
}

// Copy to public directory for download links
try {
  const publicOutput = path.join(projectRoot, 'public', 'tarteeb_medical_os.md');
  const legacyPublicOutput = path.join(projectRoot, 'public', 'nashmi_ops_full_codebase.md');
  fs.writeFileSync(publicOutput, mdContent, 'utf-8');
  fs.writeFileSync(legacyPublicOutput, mdContent, 'utf-8');
  console.log(`✅ Saved copies to public directory`);
} catch (e) {
  console.warn('Could not write to public dir:', e);
}
