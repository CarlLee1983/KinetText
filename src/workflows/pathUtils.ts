import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolves an input path. If it does not exist, tries `output/<inputPath>`.
 */
export function resolveExistingPathWithOutputFallback(
    inputPath: string,
    cwd: string = process.cwd(),
    outputDirName: string = 'output'
): string {
    const directPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);
    if (fs.existsSync(directPath)) {
        return directPath;
    }

    const fallbackPath = path.resolve(cwd, outputDirName, inputPath);
    if (fs.existsSync(fallbackPath)) {
        return fallbackPath;
    }

    throw new Error(`Path not found: ${inputPath} or ${path.join(outputDirName, inputPath)}`);
}

