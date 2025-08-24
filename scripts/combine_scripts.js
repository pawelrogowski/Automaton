const fs = require('fs');
const path = require('path');

// --- Configuration ---
const targetFolder = '../frontend/redux/slices';
const outputFile = 'combined_scripts.txt';
// -------------------

const outputFilePath = path.join(__dirname, outputFile);

// Clear the output file if it already exists
if (fs.existsSync(outputFilePath)) {
  fs.unlinkSync(outputFilePath);
}

/**
 * Recursively finds all relevant source files in a directory and its subdirectories,
 * skipping `build` and `node_modules` directories.
 * @param {string} dir - The directory to search in.
 */
const findJsFiles = (dir) => {
  try {
    const files = fs.readdirSync(dir);

    files.forEach((file) => {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // Skip build and node_modules directories
        if (file === 'build' || file === 'node_modules') {
          return;
        }
        findJsFiles(fullPath);
      } else if (['.js', '.jsx', '.cc', '.h'].includes(path.extname(file))) {
        processFile(fullPath);
      }
    });
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error);
  }
};

/**
 * Reads the content of a file and appends it to the output file.
 * @param {string} filePath - The full path to the source file.
 */
const processFile = (filePath) => {
  try {
    const fullFilePath = path.resolve(filePath);
    const fileContent = fs.readFileSync(filePath, 'utf8');

    const contentToAppend = `// ${fullFilePath}\n//start file\n${fileContent}\n//endFile\n\n`;

    fs.appendFileSync(outputFilePath, contentToAppend);

    console.log(`Added: ${fullFilePath}`);
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
  }
};

// --- Main Execution ---
console.log(`Starting to search in: ${targetFolder}`);

if (!fs.existsSync(targetFolder)) {
  console.log(`Creating target directory: ${targetFolder}`);
  fs.mkdirSync(targetFolder, { recursive: true });
  fs.writeFileSync(
    path.join(targetFolder, 'test1.js'),
    'console.log("hello from test1");',
  );
  const subFolder = path.join(targetFolder, 'sub');
  fs.mkdirSync(subFolder, { recursive: true });
  fs.writeFileSync(
    path.join(subFolder, 'test2.js'),
    'console.log("hello from test2 in subfolder");',
  );
}

findJsFiles(targetFolder);

console.log(`\nScript finished. Output written to: ${outputFile}`);
