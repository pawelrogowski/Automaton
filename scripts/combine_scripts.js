const fs = require('fs');
const path = require('path');

// --- Configuration ---
// The folder you want to search for .js files.
// Use '.' for the current directory.
const targetFolder = '../electron';

// The name of the output text file.
const outputFile = 'combined_scripts.txt';
// -------------------

const outputFilePath = path.join(__dirname, outputFile);

// Clear the output file if it already exists to start fresh
if (fs.existsSync(outputFilePath)) {
  fs.unlinkSync(outputFilePath);
}

/**
 * Recursively finds all .js files in a directory and its subdirectories.
 * @param {string} dir - The directory to search in.
 */
const findJsFiles = (dir) => {
  try {
    const files = fs.readdirSync(dir);

    files.forEach((file) => {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // If it's a directory, recurse into it
        findJsFiles(fullPath);
      } else if (path.extname(file) === '.js') {
        // If it's a .js file, process it
        processFile(fullPath);
      }
    });
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error);
  }
};

/**
 * Reads the content of a file and appends it to the output file
 * with the specified structure.
 * @param {string} filePath - The full path to the .js file.
 */
const processFile = (filePath) => {
  try {
    // Get the absolute path for the comment
    const fullFilePath = path.resolve(filePath);

    // Read the content of the file
    const fileContent = fs.readFileSync(filePath, 'utf8');
    [6];

    // Construct the content to be appended
    const contentToAppend = `// ${fullFilePath}\n//start file\n${fileContent}\n//endFile\n\n`;

    // Append the content to the output file
    fs.appendFileSync(outputFilePath, contentToAppend);
    [5];

    console.log(`Added: ${fullFilePath}`);
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
  }
};

// --- Main Execution ---
console.log(`Starting to search for .js files in: ${targetFolder}`);

// Create the target directory if it doesn't exist for demonstration
if (!fs.existsSync(targetFolder)) {
  console.log(`Creating target directory: ${targetFolder}`);
  fs.mkdirSync(targetFolder, { recursive: true });
  // Create some dummy files for testing
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

console.log(
  `\nScript finished. All .js file contents have been combined into: ${outputFile}`,
);
