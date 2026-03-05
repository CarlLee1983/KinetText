import * as path from 'node:path';

/**
 * Reads `metadata.txt` from a book directory and extracts the `Source:` site id.
 */
export async function getSiteIdFromMetadata(bookDirPath: string): Promise<string | null> {
    try {
        const metadataPath = path.join(bookDirPath, 'metadata.txt');
        const content = await Bun.file(metadataPath).text();
        const lines = content.split('\n');
        for (const line of lines) {
            if (line.startsWith('Source:')) {
                return line.replace('Source:', '').trim();
            }
        }
    } catch {
        // Metadata missing or unreadable
    }
    return null;
}

export interface KinetiTextDocumentParts {
    header: string;
    body: string;
}

/**
 * Splits a stored chapter into KinetiText header/body parts.
 */
export function splitKinetiTextDocument(content: string): KinetiTextDocumentParts {
    const parts = content.split('--------------------------------------------------');
    if (parts.length >= 2) {
        return {
            header: `${parts[0]}--------------------------------------------------\n`,
            body: parts.slice(1).join('--------------------------------------------------').trim()
        };
    }

    return {
        header: '',
        body: content.trim()
    };
}

