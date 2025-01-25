// scripts/set-random-name.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const adjectives = [
  // Original adjectives
  'swift',
  'bright',
  'silent',
  'hidden',
  'rapid',
  'smart',
  'quick',
  'quiet',
  'fast',
  'smooth',
  'steady',
  'sharp',
  'clear',
  'peak',
  'prime',
  'fresh',

  // Technical adjectives
  'digital',
  'cyber',
  'quantum',
  'neural',
  'binary',
  'mobile',
  'cloud',
  'secure',
  'crypto',
  'dynamic',
  'instant',
  'active',
  'power',
  'ultra',
  'mega',
  'hyper',
  'turbo',
  'nano',
  'micro',
  'macro',
  'multi',
  'flex',
  'auto',
  'eco',

  // Performance adjectives
  'agile',
  'lite',
  'rapid',
  'boost',
  'speed',
  'flash',
  'dash',
  'zoom',
  'swift',
  'quick',
  'fast',
  'sonic',
  'nitro',
  'turbo',
  'jet',
  'rocket',

  // Quality adjectives
  'pro',
  'elite',
  'premium',
  'prime',
  'ideal',
  'pure',
  'fine',
  'select',
  'choice',
  'expert',
  'master',
  'sharp',
  'keen',
  'wise',
  'smart',
  'bright',

  // Modern tech terms
  'smart',
  'intel',
  'net',
  'web',
  'tech',
  'soft',
  'ware',
  'app',
  'data',
  'info',
  'sys',
  'net',
  'com',
  'bit',
  'byte',
  'code',

  // Creative adjectives
  'nova',
  'stellar',
  'cosmic',
  'astro',
  'solar',
  'lunar',
  'nebula',
  'apex',
  'peak',
  'zenith',
  'prime',
  'alpha',
  'beta',
  'omega',
  'delta',
  'sigma',

  // Additional modern adjectives
  'async',
  'real',
  'live',
  'stream',
  'cloud',
  'edge',
  'mesh',
  'grid',
  'nexus',
  'hub',
  'core',
  'base',
  'node',
  'flow',
  'flux',
  'wave',
];

const nouns = [
  // Original nouns
  'helper',
  'buddy',
  'tools',
  'spark',
  'wave',
  'pulse',
  'flow',
  'beam',
  'core',
  'sync',
  'link',
  'path',
  'edge',
  'point',
  'space',
  'view',

  // Technology nouns
  'system',
  'network',
  'device',
  'engine',
  'module',
  'platform',
  'server',
  'client',
  'portal',
  'matrix',
  'proxy',
  'router',
  'sensor',
  'beacon',
  'signal',
  'stream',

  // Function nouns
  'tools',
  'suite',
  'works',
  'office',
  'studio',
  'lab',
  'forge',
  'hub',
  'center',
  'space',
  'zone',
  'spot',
  'point',
  'base',
  'dock',
  'port',

  // Data-related nouns
  'data',
  'file',
  'code',
  'cache',
  'byte',
  'bit',
  'pixel',
  'node',
  'block',
  'chain',
  'graph',
  'grid',
  'map',
  'net',
  'web',
  'cloud',

  // Action nouns
  'runner',
  'keeper',
  'master',
  'wizard',
  'expert',
  'genius',
  'mind',
  'brain',
  'guard',
  'shield',
  'force',
  'power',
  'boost',
  'drive',
  'thrust',
  'pulse',

  // Connectivity nouns
  'link',
  'bridge',
  'gate',
  'port',
  'relay',
  'nexus',
  'hub',
  'core',
  'mesh',
  'grid',
  'net',
  'web',
  'chain',
  'stack',
  'array',
  'cluster',

  // Modern tech nouns
  'api',
  'sdk',
  'cli',
  'gui',
  'app',
  'bot',
  'aid',
  'lite',
  'pro',
  'plus',
  'max',
  'ultra',
  'flex',
  'sync',
  'flow',
  'dash',

  // Abstract nouns
  'logic',
  'mind',
  'brain',
  'soul',
  'core',
  'heart',
  'pulse',
  'spirit',
  'force',
  'power',
  'energy',
  'flow',
  'wave',
  'beam',
  'ray',
  'light',
];

const connectors = [
  '-',
  '_', // Only using hyphen and underscore as they're npm-safe
];

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getRandomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function sanitizeForNpm(name) {
  return name
    .toLowerCase() // npm names must be lowercase
    .replace(/[^a-z0-9-_]/g, '-') // Replace any other characters with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, '') // Remove leading and trailing hyphens
    .replace(/^[^a-z]/, 'n'); // Ensure name starts with a letter (npm requirement)
}

function generateAppName() {
  // Randomly decide the number of words (1-4)
  const wordCount = Math.floor(Math.random() * 4) + 1;

  let nameParts = [];

  switch (wordCount) {
    case 1:
      // Single word - either noun or adjective + noun combined
      if (Math.random() > 0.5) {
        nameParts.push(getRandomItem(nouns));
      } else {
        const adj = getRandomItem(adjectives);
        const noun = getRandomItem(nouns);
        nameParts.push(adj + noun);
      }
      break;

    case 2:
      // Two words
      if (Math.random() > 0.5) {
        // Adjective + Noun
        nameParts.push(getRandomItem(adjectives));
        nameParts.push(getRandomItem(nouns));
      } else {
        // Noun + Noun
        do {
          nameParts = [getRandomItem(nouns), getRandomItem(nouns)];
        } while (nameParts[0] === nameParts[1]);
      }
      break;

    case 3:
      // Three words
      do {
        nameParts = [getRandomItem(adjectives), getRandomItem(adjectives), getRandomItem(nouns)];
      } while (nameParts[0] === nameParts[1]);
      break;

    case 4:
      // Four words
      do {
        nameParts = [getRandomItem(adjectives), getRandomItem(nouns), getRandomItem(adjectives), getRandomItem(nouns)];
      } while (nameParts[1] === nameParts[3]);
      break;
  }

  // Join with random connector for multiple words
  const connector = getRandomItem(connectors);
  const npmName = sanitizeForNpm(nameParts.join(connector));

  // Generate a display name (can be more fancy) and package name (npm-safe)
  return {
    displayName: nameParts.map(capitalize).join(' '),
    packageName: npmName,
  };
}

function updatePackageJson() {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  const { displayName, packageName } = generateAppName();

  // Update package.json
  packageJson.name = packageName; // npm-safe name

  // Update build configuration if it exists
  if (packageJson.build) {
    packageJson.build.productName = displayName; // Can use fancy name for display
    packageJson.build.appId = `com.electron.${packageName}`;
  }

  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  console.log(`Updated app name to: ${displayName} (package: ${packageName})`);

  return { displayName, packageName };
}

// Run the update
updatePackageJson();
