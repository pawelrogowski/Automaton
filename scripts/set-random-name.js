import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// List of names based on popular Electron apps for Linux
const electronAppNames = [
  'Code',
  'Studio',
  'Visual',
  'VSCodium',
  'Discord',
  'Slack',
  'Skype',
  'Teams',
  'Signal',
  'WhatsApp',
  'GitHub',
  'Desktop',
  'Atom',
  'Postman',
  'Notion',
  'Simplenote',
  'Joplin',
  'Miro',
  'Twitch',
  'Figma',
  'Docker',
  'Hyper',
  'Termius',
  'Beaker',
  'Browser',
  'Etcher',
  'Insomnia',
  'Bitwarden',
  'Standard',
  'Notes',
  'Tusk',
  'Mailspring',
  'Rambox',
  'Ferdi',
  'WebTorrent',
  'Upterm',
  'Session',
  'Element',
];

const connectors = ['-', '_'];

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function getRandomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function sanitizeForNpm(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]/, 'n');
}

function generateAppName() {
  const wordCount = Math.floor(Math.random() * 2) + 1; // 1 or 2 words

  let nameParts = [];

  if (wordCount === 1) {
    // Use a single, complete app name
    nameParts.push(getRandomItem(electronAppNames));
  } else {
    // Combine two different names/parts for a plausible compound name
    let part1, part2;
    do {
      part1 = getRandomItem(electronAppNames);
      part2 = getRandomItem(electronAppNames);
    } while (part1 === part2); // Ensure the parts are different

    // Avoid nonsensical long names like "Visual Studio" + "GitHub Desktop"
    // by preferring single-word components for combinations.
    if (part1.includes(' ') || part2.includes(' ')) {
      // If we pick a multi-word name, just use that one.
      nameParts.push(Math.random() > 0.5 ? part1 : part2);
    } else {
      nameParts.push(part1, part2);
    }
  }

  // Join with a random connector only if there are multiple parts
  const connector = nameParts.length > 1 ? getRandomItem(connectors) : '';
  const joinedName = nameParts.join(connector);

  const npmName = sanitizeForNpm(joinedName);
  const displayName = nameParts.map(capitalize).join(' ');

  return {
    displayName: displayName,
    packageName: npmName,
  };
}

function updatePackageJson() {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  const { displayName, packageName } = generateAppName();

  packageJson.name = packageName;

  if (packageJson.build) {
    packageJson.build.productName = displayName;
    packageJson.build.appId = `com.electron.${packageName}`;
  }

  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  console.log(`Updated app name to: ${displayName} (package: ${packageName})`);

  return { displayName, packageName };
}

// Run the update
updatePackageJson();
