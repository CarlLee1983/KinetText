export class ContentCleaner {
    private static watermarks: Record<string, string[]> = {
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
    }

    private static noiseRegexes: Record<string, RegExp[]> = {
        '8novel': [
            /[8８⒏⑻⑧][\s]*[nｎＮ][\s]*[oｏＯσο][\s]*[vｖＶν][\s]*[eｅＥЁ][\s]*[lｌＬ┗└][\s]*[.．·。][\s]*[cｃＣС][\s]*[oｏＯοо][\s]*[mｍＭｍ]/ig,
            /無限輕小說/g
        ],
        'wfxs': [
            /網腐小說/g,
            /\[.*?首發\]/g
        ],
        'czbooks': [
            /『PS:.*?』/ig,
            /————以下正文————/g,
            /【.*?】/g // 有時候會有類似【為白銀大盟加更】的干擾
        ]
    }

    /**
     * Cleans content for a specific site
     */
    static clean(siteId: string, text: string): string {
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
        if (!this.watermarks[siteId]) {
            this.watermarks[siteId] = []
        }
        if (!this.watermarks[siteId].includes(watermark)) {
            this.watermarks[siteId].push(watermark)
        }
    }
}
