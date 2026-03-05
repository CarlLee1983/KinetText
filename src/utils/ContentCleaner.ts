import fs from 'node:fs';

interface NoisePattern {
    pattern: string;
    flags?: string;
}

interface CleanerRulesFile {
    watermarks?: Record<string, string[]>;
    noisePatterns?: Record<string, NoisePattern[]>;
}

export class ContentCleaner {
    private static watermarks: Record<string, string[]> = {};
    private static noiseRegexes: Record<string, RegExp[]> = {};
    private static loaded = false;

    private static loadRules() {
        if (this.loaded) return;

        const defaultRules: CleanerRulesFile = {
            watermarks: {
                '8novel': [
                    '小主，這個章節後面還有哦，請點擊下一頁繼續閱讀，後面更精彩！',
                    '本小章還未完，請點擊下一頁繼續閱讀後面精彩內容！',
                    '無限輕小說',
                    '8novel.com',
                    'www.8novel.com'
                ],
                'wfxs': [
                    '網腐小說',
                    'wfxs.tw',
                    'www.wfxs.tw',
                    '本章完',
                    '上一章',
                    '下一章'
                ]
            },
            noisePatterns: {
                '8novel': [
                    {
                        pattern: '[8８⒏⑻⑧][\\s]*[nｎＮ][\\s]*[oｏＯσο][\\s]*[vｖＶν][\\s]*[eｅＥЁ][\\s]*[lｌＬ┗└][\\s]*[.．·。][\\s]*[cｃＣС][\\s]*[oｏＯοо][\\s]*[mｍＭｍ]',
                        flags: 'ig'
                    },
                    { pattern: '無限輕小說', flags: 'g' }
                ],
                'wfxs': [
                    { pattern: '網腐小說', flags: 'g' },
                    { pattern: '\\[.*?首發\\]', flags: 'g' }
                ],
                'czbooks': [
                    { pattern: '『PS:.*?』', flags: 'ig' },
                    { pattern: '————以下正文————', flags: 'g' },
                    { pattern: '【.*?】', flags: 'g' }
                ]
            }
        };

        let rules = defaultRules;
        try {
            const rulesUrl = new URL('../../rules/content-cleaner.json', import.meta.url);
            const raw = fs.readFileSync(rulesUrl, 'utf-8');
            rules = JSON.parse(raw) as CleanerRulesFile;
        } catch {
            // Fallback to built-in defaults when rules file is missing or malformed.
        }

        this.watermarks = rules.watermarks || {};
        this.noiseRegexes = {};
        for (const [siteId, patterns] of Object.entries(rules.noisePatterns || {})) {
            this.noiseRegexes[siteId] = patterns.map((item) => new RegExp(item.pattern, item.flags || 'g'));
        }
        this.loaded = true;
    }

    /**
     * Cleans content for a specific site
     */
    static clean(siteId: string, text: string): string {
        this.loadRules();
        let cleaned = text

        // Remove exact watermarks
        const siteWatermarks = this.watermarks[siteId] || []
        for (const wm of siteWatermarks) {
            cleaned = cleaned.split(wm).join('')
        }

        // Apply noise regexes
        const siteRegexes = this.noiseRegexes[siteId] || []
        for (const regex of siteRegexes) {
            cleaned = cleaned.replace(regex, '')
        }

        return cleaned.trim()
    }

    /**
     * Allows dynamic maintenance of watermarks
     */
    static addWatermark(siteId: string, watermark: string) {
        this.loadRules();
        if (!this.watermarks[siteId]) {
            this.watermarks[siteId] = []
        }
        if (!this.watermarks[siteId].includes(watermark)) {
            this.watermarks[siteId].push(watermark)
        }
    }
}
