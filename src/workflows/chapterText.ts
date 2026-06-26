/**
 * Prepare chapter source text for TTS synthesis.
 * Handles crawler .txt headers and local markdown with a `## 正文` body section.
 */
export function prepareChapterTextForTts(content: string): string {
    let text = content;
    let usedBodySection = false;

    const bodyHeading = /^##\s*正文\s*$/m;
    const bodyMatch = text.match(bodyHeading);
    if (bodyMatch?.index !== undefined) {
        text = text.slice(bodyMatch.index + bodyMatch[0].length).trim();
        usedBodySection = true;
    }

    if (!usedBodySection) {
        const lines = text.split('\n');
        const separatorIndex = lines.findIndex((line, index) => index < 5 && line.startsWith('---'));
        if (separatorIndex !== -1) {
            text = lines.slice(separatorIndex + 1).join('\n').trim();
        }
    }

    return text.replace(/^---+\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}
