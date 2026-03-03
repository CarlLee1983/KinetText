export class ContentCleaner {
    private static watermarks: Record<string, string[]> = {
        '8novel': [
            '本小章還未完，請點擊下一頁繼續閱讀後面精彩內容！',
            '⑧NOνE┕。cОｍ',
            '8ｎσＶＥｌ．cоm'
        ]
    }

    private static noiseRegexes: Record<string, RegExp[]> = {
        '8novel': [
            // Original complex noise regex
            /[8８⒏⑻⑧][\s]*[nｎＮ][\s]*[oｏＯσο][\s]*[vｖＶ][\s]*[eｅＥЁ][\s]*[lｌＬ┗└][\s]*[.．·。][\s]*[cｃＣС][\s]*[oｏＯοо][\s]*[mｍＭｍ]/ig
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
