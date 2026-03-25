# KinetiText 浮水印自動改善策略

## 概述
建立一個持續學習和改善文字清理規則的系統，無需手動干預即可優化浮水印移除效果。

---

## 策略 1: 運行時異常偵測系統 ⭐ 推薦優先

### 原理
監控清理前後的內容變化，自動識別「漏掉」的浮水印。

### 實現

```typescript
// src/utils/WatermarkAnalyzer.ts
export class WatermarkAnalyzer {
    /**
     * 分析清理效果，識別未被移除的干擾文字
     */
    static analyzeAndRecord(
        siteId: string,
        original: string,
        cleaned: string
    ): UncleanedPattern[] {
        const uncleanedPatterns: UncleanedPattern[] = [];

        // 1. 識別移除量過少的片段 (<10% 實際移除)
        if (original.length < cleaned.length * 1.1) {
            return uncleanedPatterns; // 很好，大量內容被移除
        }

        // 2. 尋找常見干擾詞
        const suspiciousPatterns = [
            { regex: /\b(廣告|推薦|點擊|訪問|下載)\b/g, weight: 0.5 },
            { regex: /http[s]?:\/\/[^\s]+/g, weight: 0.8 },  // 未被移除的URL
            { regex: /【.*?】/g, weight: 0.6 },             // 括號文字
            { regex: /\(.*?(作者|編者|譯者).*?\)/g, weight: 0.7 }
        ];

        for (const pattern of suspiciousPatterns) {
            const matches = cleaned.match(pattern.regex);
            if (matches && matches.length > 0) {
                uncleanedPatterns.push({
                    pattern: pattern.regex.source,
                    frequency: matches.length,
                    weight: pattern.weight,
                    siteId,
                    timestamp: Date.now()
                });
            }
        }

        return uncleanedPatterns;
    }

    /**
     * 記錄異常到日誌，用於後續分析
     */
    static logSuspiciousPatterns(patterns: UncleanedPattern[]) {
        patterns.forEach(p => {
            // 寫到日誌文件供人工審查
            console.log(`[${p.siteId}] Uncleaned: "${p.pattern}" (${p.frequency}x)`);
        });
    }
}
```

### 用途流程

```typescript
// 在 adapters 中集成
async getChapterContent(url: string): Promise<string> {
    let content = await fetchContent(url);
    const original = content;

    content = ContentCleaner.clean('hjwzw', content);

    // 自動分析清理效果
    const uncleanedPatterns = WatermarkAnalyzer.analyzeAndRecord(
        'hjwzw',
        original,
        content
    );

    // 如果發現問題，記錄以供後續改善
    if (uncleanedPatterns.length > 0) {
        WatermarkAnalyzer.logSuspiciousPatterns(uncleanedPatterns);
        // 也可以發送到遠端服務用於集中管理
    }

    return content;
}
```

---

## 策略 2: 啟發式浮水印探測 🤖

### 概念
基於內容特徵自動識別和提議新規則。

```typescript
// src/utils/HeuristicWatermarkDetector.ts
export class HeuristicWatermarkDetector {
    static detectWatermarks(text: string, siteId: string) {
        const candidates: WatermarkCandidate[] = [];

        // 1. 重複短語檢測（通常是浮水印）
        const phrases = text.split(/[\n。，！？]/);
        const phraseCounts = new Map<string, number>();

        phrases.forEach(phrase => {
            const clean = phrase.trim();
            if (clean.length > 3 && clean.length < 30) {
                phraseCounts.set(clean, (phraseCounts.get(clean) ?? 0) + 1);
            }
        });

        // 重複出現 3 次以上的短語可能是浮水印
        phraseCounts.forEach((count, phrase) => {
            if (count >= 3) {
                candidates.push({
                    text: phrase,
                    confidence: Math.min(count / 5, 1.0),  // 越多次越確定
                    type: 'repeated_phrase',
                    siteId
                });
            }
        });

        // 2. 超鏈接檢測
        const urlPattern = /http[s]?:\/\/[^\s]+/g;
        const urls = text.match(urlPattern) || [];
        urls.forEach(url => {
            candidates.push({
                text: url,
                confidence: 0.9,  // URL 很可能是廣告
                type: 'url',
                siteId
            });
        });

        // 3. 特殊字符模式（可能是廣告或章節標記）
        const specialPattern = /【[^】]+】|『[^』]+』|《[^》]+》/g;
        (text.match(specialPattern) || []).forEach(match => {
            candidates.push({
                text: match,
                confidence: 0.6,  // 中等信心
                type: 'bracketed',
                siteId
            });
        });

        return candidates.filter(c => c.confidence > 0.7);
    }

    /**
     * 提議新規則，供管理員審核
     */
    static proposeRules(candidates: WatermarkCandidate[]): ProposedRule[] {
        return candidates.map(c => ({
            type: c.type === 'url' ? 'regex' : 'exact',
            pattern: c.type === 'url'
                ? 'http[s]?:\\/\\/[^\\s]+'
                : c.text,
            siteId: c.siteId,
            confidence: c.confidence,
            recommendation: c.confidence > 0.85
                ? 'auto_apply'
                : 'needs_review'
        }));
    }
}
```

---

## 策略 3: 規則效果監測儀表板 📊

### 追蹤指標

```typescript
// src/utils/CleaningMetrics.ts
export class CleaningMetrics {
    private static metrics: Map<string, SiteMetrics> = new Map();

    static recordCleaningEvent(
        siteId: string,
        original: string,
        cleaned: string,
        success: boolean
    ) {
        if (!this.metrics.has(siteId)) {
            this.metrics.set(siteId, {
                totalChapters: 0,
                successfulCleanings: 0,
                averageReductionPercent: 0,
                failedCleanings: 0,
                lastUpdated: Date.now()
            });
        }

        const metrics = this.metrics.get(siteId)!;
        metrics.totalChapters++;

        if (success) {
            metrics.successfulCleanings++;
        } else {
            metrics.failedCleanings++;
        }

        // 計算清理率
        const reductionPercent = (
            (original.length - cleaned.length) / original.length
        ) * 100;

        // 更新平均值
        metrics.averageReductionPercent =
            (metrics.averageReductionPercent * (metrics.totalChapters - 1) +
             reductionPercent) / metrics.totalChapters;

        metrics.lastUpdated = Date.now();
    }

    /**
     * 生成清理效果報告
     */
    static generateReport() {
        const report: Record<string, object> = {};

        this.metrics.forEach((metrics, siteId) => {
            const successRate = (
                metrics.successfulCleanings / metrics.totalChapters * 100
            ).toFixed(2);

            report[siteId] = {
                totalChapters: metrics.totalChapters,
                successRate: `${successRate}%`,
                averageReductionPercent: metrics.averageReductionPercent.toFixed(2),
                failureRate: (
                    metrics.failedCleanings / metrics.totalChapters * 100
                ).toFixed(2),
                recommendation: metrics.averageReductionPercent < 5
                    ? '⚠️ 清理效果不佳，需要添加新規則'
                    : '✅ 清理效果良好'
            };
        });

        return report;
    }
}
```

### 使用

```typescript
// 在 CrawlerEngine 中記錄
const original = await adapter.getChapterContent(url);
const cleaned = ContentCleaner.clean(siteId, original);
const success = cleaned.length > 100;  // 簡單的成功指標

CleaningMetrics.recordCleaningEvent(siteId, original, cleaned, success);

// 定期生成報告
setInterval(() => {
    const report = CleaningMetrics.generateReport();
    console.log('清理效果報告:', report);
}, 86400000); // 每天一次
```

---

## 策略 4: 規則版本控制和A/B測試 🔄

### 實現

```typescript
// src/utils/RuleVersionManager.ts
export class RuleVersionManager {
    private static currentVersion = '1.0.0';

    /**
     * 建議新版本規則
     */
    static proposeNewVersion(
        changes: RuleChange[],
        reason: string
    ): RuleVersion {
        const version = this.incrementVersion();

        return {
            version,
            timestamp: Date.now(),
            changes,
            reason,
            testResults: null,
            status: 'proposed'
        };
    }

    /**
     * A/B 測試：同時使用舊規則和新規則，比較效果
     */
    static async testNewRules(
        newRules: CleanerRulesFile,
        testContent: string[]
    ) {
        const oldResults = testContent.map(content => ({
            original: content,
            cleaned: ContentCleaner.clean('test', content)
        }));

        // 臨時加載新規則
        const oldRules = this.saveCurrentRules();
        this.loadTestRules(newRules);

        const newResults = testContent.map(content => ({
            original: content,
            cleaned: ContentCleaner.clean('test', content)
        }));

        // 恢復舊規則
        this.restoreRules(oldRules);

        return {
            oldAvgReduction: this.calculateAvgReduction(oldResults),
            newAvgReduction: this.calculateAvgReduction(newResults),
            improvement: this.calculateImprovement(oldResults, newResults)
        };
    }

    private static incrementVersion(): string {
        const [major, minor, patch] = this.currentVersion.split('.').map(Number);
        return `${major}.${minor}.${patch + 1}`;
    }
}
```

---

## 策略 5: 用戶反饋收集 👥

### 簡單的反饋機制

```typescript
// src/utils/UserFeedback.ts
export class UserFeedbackCollector {
    /**
     * 記錄漏掉的浮水印
     */
    static reportMissedWatermark(
        siteId: string,
        chapterIndex: number,
        watermarkText: string,
        context: string
    ) {
        const feedback = {
            type: 'missed_watermark',
            siteId,
            chapterIndex,
            watermarkText,
            context,
            timestamp: Date.now()
        };

        // 保存到檔案供後續分析
        const feedbackFile = `./feedback/missed-watermarks-${Date.now()}.json`;
        Bun.write(feedbackFile, JSON.stringify(feedback, null, 2));

        console.log(`💭 反饋已保存: ${feedbackFile}`);
    }

    /**
     * 從反饋日誌自動提議規則
     */
    static generateRulesFromFeedback(feedbackDir: string = './feedback'): ProposedRule[] {
        const proposed: ProposedRule[] = [];
        const feedbackMap = new Map<string, number>();

        // 掃描所有反饋
        const files = Bun.shell(`ls ${feedbackDir}/*.json 2>/dev/null || echo ""`).sync();

        // 統計相同的浮水印
        files.forEach(file => {
            const data = JSON.parse(Bun.file(file).text());
            const key = `${data.siteId}:${data.watermarkText}`;
            feedbackMap.set(key, (feedbackMap.get(key) ?? 0) + 1);
        });

        // 重複出現的浮水印才提議為規則
        feedbackMap.forEach((count, key) => {
            if (count >= 2) {
                const [siteId, watermark] = key.split(':');
                proposed.push({
                    type: 'exact',
                    pattern: watermark,
                    siteId,
                    confidence: Math.min(count / 5, 1.0),
                    recommendation: 'auto_apply'
                });
            }
        });

        return proposed;
    }
}
```

---

## 實施路線圖 🗺️

### 第 1 階段 (立即)
- [ ] 實現 WatermarkAnalyzer (運行時異常偵測)
- [ ] 添加 CleaningMetrics (效果監測)
- [ ] 生成每日報告

### 第 2 階段 (1-2 週)
- [ ] 實現 HeuristicWatermarkDetector
- [ ] 建立規則提議審核系統
- [ ] 創建管理後台查看提議規則

### 第 3 階段 (2-3 週)
- [ ] 實現 RuleVersionManager
- [ ] 添加 A/B 測試能力
- [ ] 自動應用高信心規則

### 第 4 階段 (持續)
- [ ] UserFeedbackCollector (用戶上報機制)
- [ ] 自動化規則更新 CI/CD
- [ ] 規則效果儀表板

---

## 關鍵優勢

| 策略 | 優勢 | 成本 |
|------|------|------|
| 異常偵測 | 實時發現問題 | 低 |
| 啟發式探測 | 自動提議規則 | 中 |
| 效果監測 | 量化改善 | 低 |
| A/B 測試 | 驗證新規則 | 中 |
| 用戶反饋 | 準確性高 | 低 |

---

## 示例：完整工作流

```typescript
// 每次爬取時
for (const chapter of chapters) {
    const original = await adapter.getChapterContent(chapter.url);
    const cleaned = ContentCleaner.clean(siteId, original);

    // 1. 記錄效果指標
    CleaningMetrics.recordCleaningEvent(siteId, original, cleaned, true);

    // 2. 異常偵測
    const uncleaned = WatermarkAnalyzer.analyzeAndRecord(
        siteId, original, cleaned
    );

    // 3. 啟發式探測
    const candidates = HeuristicWatermarkDetector.detectWatermarks(
        cleaned, siteId
    );

    // 4. 保存清理結果
    await storage.saveChapter(title, chapter, cleaned);
}

// 每天
const report = CleaningMetrics.generateReport();
if (report.someMetric < threshold) {
    // 自動觸發規則改善流程
}

// 每週
const proposedRules = [
    ...HeuristicWatermarkDetector.proposeRules(allCandidates),
    ...UserFeedbackCollector.generateRulesFromFeedback()
];
// 發送給管理員審核
```

---

## 下一步建議

1. **優先實現**: WatermarkAnalyzer + CleaningMetrics
2. **集成點**: 在 CrawlerEngine 中添加監測邏輯
3. **反饋渠道**: 提供簡單的方式讓用戶上報漏掉的浮水印
4. **定期審查**: 每週審查提議的規則，更新 content-cleaner.json

這樣就能實現一個持續自我改善的系統，無需每次都手動添加規則！
