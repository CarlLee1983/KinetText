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
    private static globalWatermarks: string[] = [];
    private static globalRegexes: RegExp[] = [];
    private static loaded = false;

    private static loadRules() {
        if (this.loaded) return;

        const defaultRules: CleanerRulesFile = {
            watermarks: {
                '_global': [
                    '上一章',
                    '下一章',
                    '目錄',
                    '返回目錄',
                    '書架',
                    '首頁',
                    '本章完',
                    '本章未完',
                    '未完待續'
                ],
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
                    'www.wfxs.tw'
                ]
            },
            noisePatterns: {
                '_global': [
                    { pattern: '>>章節報錯<<', flags: 'g' },
                    { pattern: '關燈|護眼|字體：|字號|大|中|小', flags: 'g' },
                    { pattern: '\\(adsbygoogle.*?;', flags: 'g' },
                    { pattern: 'window\\.mg_asy_a\\s*=.*?\\}\\)\\(\\);', flags: 'gs' }
                ],
                '8novel': [
                    {
                        pattern: '[8８⒏⑻⑧][\\s]*[nｎＮ][\\s]*[oｏＯσο][\\s]*[vｖＶν][\\s]*[eｅＥЁ][\\s]*[lｌＬ┗└][\\s]*[.．·。][\\s]*[cｃＣС][\\s]*[oｏＯοο][\\s]*[mｍＭｍ]',
                        flags: 'ig'
                    }
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

        // Load global rules
        this.globalWatermarks = rules.watermarks?.['_global'] || [];
        const globalPatterns = rules.noisePatterns?.['_global'] || [];
        this.globalRegexes = globalPatterns.map((item) => new RegExp(item.pattern, item.flags || 'g'));

        // Load site-specific rules
        this.watermarks = {};
        this.noiseRegexes = {};
        for (const [siteId, wms] of Object.entries(rules.watermarks || {})) {
            if (siteId !== '_global') {
                this.watermarks[siteId] = wms;
            }
        }
        for (const [siteId, patterns] of Object.entries(rules.noisePatterns || {})) {
            if (siteId !== '_global') {
                this.noiseRegexes[siteId] = patterns.map((item) => new RegExp(item.pattern, item.flags || 'g'));
            }
        }
        this.loaded = true;
    }

    /**
     * Cleans content for a specific site
     * Applies both global and site-specific rules
     */
    static clean(siteId: string, text: string): string {
        this.loadRules();
        let cleaned = text;

        // Remove global exact watermarks
        for (const wm of this.globalWatermarks) {
            cleaned = cleaned.split(wm).join('');
        }

        // Remove site-specific exact watermarks
        const siteWatermarks = this.watermarks[siteId] || [];
        for (const wm of siteWatermarks) {
            cleaned = cleaned.split(wm).join('');
        }

        // Apply global noise regexes
        for (const regex of this.globalRegexes) {
            cleaned = cleaned.replace(regex, '');
        }

        // Apply site-specific noise regexes
        const siteRegexes = this.noiseRegexes[siteId] || [];
        for (const regex of siteRegexes) {
            cleaned = cleaned.replace(regex, '');
        }

        // Clean up excessive whitespace
        cleaned = cleaned
            .replace(/\n{3,}/g, '\n\n')  // Max 2 newlines
            .replace(/\s+$/gm, '')        // Trailing whitespace per line
            .trim();

        return cleaned;
    }

    /**
     * Allows dynamic maintenance of watermarks
     */
    static addWatermark(siteId: string, watermark: string) {
        this.loadRules();
        if (!this.watermarks[siteId]) {
            this.watermarks[siteId] = [];
        }
        if (!this.watermarks[siteId].includes(watermark)) {
            this.watermarks[siteId].push(watermark);
        }
    }

    /**
     * Add a global watermark that applies to all sites
     */
    static addGlobalWatermark(watermark: string) {
        this.loadRules();
        if (!this.globalWatermarks.includes(watermark)) {
            this.globalWatermarks.push(watermark);
        }
    }
}
