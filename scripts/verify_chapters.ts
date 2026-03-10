import * as fs from 'fs';
import * as path from 'path';

function printUsage() {
    console.log('Usage: bun run scripts/verify_chapters.ts <directory_path>');
    console.log('Description: Scans all .txt files in the given directory to identify potentially failed or corrupted chapter downloads.');
    console.log('Example: bun run scripts/verify_chapters.ts "output/神秘復甦/txt"');
}

const targetDir = process.argv[2];

if (!targetDir || targetDir === '--help' || targetDir === '-h') {
    printUsage();
    process.exit(targetDir ? 0 : 1);
}

if (!fs.existsSync(targetDir)) {
    console.error(`Error: Directory not found: ${targetDir}`);
    process.exit(1);
}

const files = fs.readdirSync(targetDir)
    .filter(f => f.endsWith('.txt'))
    .sort((a, b) => {
        // Sort by chapter index if the format is "0001 - Title.txt"
        const numA = parseInt(a.split('-')[0]?.trim() || '');
        const numB = parseInt(b.split('-')[0]?.trim() || '');
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return a.localeCompare(b);
    });

console.log(`Verifying ${files.length} .txt files in ${targetDir}...\n`);

let suspiciousCount = 0;
const knownErrorStrings = [
    'Performing security verification',
    'Just a moment',
    'Enable JavaScript',
    'Cloudflare',
    'Please enable cookies',
    'Ray ID:'
];

for (const file of files) {
    const filePath = path.join(targetDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    const issues: string[] = [];

    // Rule 1: Empty or extremely short content
    if (content.trim().length === 0) {
        issues.push('File is empty.');
    } else if (content.trim().length < 100) {
        // Chapters are usually much longer than 100 characters
        issues.push(`Content is suspiciously short (${content.trim().length} chars).`);
    }

    // Rule 2: Known anti-bot / Cloudflare strings
    for (const errorStr of knownErrorStrings) {
        if (content.includes(errorStr)) {
            issues.push(`Detected anti-bot text: "${errorStr}"`);
        }
    }

    if (issues.length > 0) {
        suspiciousCount++;
        console.log(`[Warning] File: ${file}`);
        issues.forEach(issue => console.log(`  - ${issue}`));
        console.log(''); // Empty line for readability
    }
}

console.log('--------------------------------------------------');
if (suspiciousCount === 0) {
    console.log('Verification completed: All files look normal!');
} else {
    console.log(`Verification completed: Found ${suspiciousCount} suspicious ${suspiciousCount > 1 ? 'files' : 'file'}.`);
    console.log('You may want to delete these files and restart the crawler to fetch them again.');
}
