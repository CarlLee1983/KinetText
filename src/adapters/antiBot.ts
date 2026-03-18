import type { AxiosError } from 'axios';
import type { Page } from 'puppeteer';

const ANTI_BOT_PATTERNS = [
    /just a moment/i,
    /attention required/i,
    /performing security verification/i,
    /verify (?:you are|that you'?re) human/i,
    /checking your browser/i,
    /ddos protection/i,
    /access denied/i,
    /cf-browser-verification/i,
    /cdn-cgi\/challenge-platform/i,
    /captcha/i,
    /too many requests/i,
];

export class AntiBotError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AntiBotError';
    }
}

export function detectAntiBotText(text: string): string | null {
    for (const pattern of ANTI_BOT_PATTERNS) {
        if (pattern.test(text)) {
            return pattern.source;
        }
    }
    return null;
}

export function assertNoAntiBotText(text: string, context: string): void {
    const matched = detectAntiBotText(text);
    if (matched) {
        throw new AntiBotError(`${context}: anti-bot page detected (${matched})`);
    }
}

export function isRetriableAxiosError(error: unknown): boolean {
    const axiosError = error as AxiosError | undefined;
    const status = axiosError?.response?.status;
    return status === 403 || status === 408 || status === 429 || status === 503 || status === 504;
}

export async function sleep(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
}

export function getRetryDelayMs(attempt: number, baseMs: number = 1200): number {
    return baseMs * attempt + Math.floor(Math.random() * 400);
}

export async function withAntiBotRetries<T>(
    task: (attempt: number) => Promise<T>,
    context: string,
    retries: number = 3
): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await task(attempt);
        } catch (error) {
            lastError = error;
            const retryable = error instanceof AntiBotError || isRetriableAxiosError(error);
            if (!retryable || attempt === retries) {
                throw error;
            }
            console.warn(`[anti-bot] ${context} retry ${attempt}/${retries}: ${error instanceof Error ? error.message : String(error)}`);
            await sleep(getRetryDelayMs(attempt));
        }
    }

    throw lastError instanceof Error ? lastError : new Error(`${context}: unknown anti-bot failure`);
}

export async function preparePage(page: Page): Promise<void> {
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1440, height: 900 });
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    });
}

export async function gotoWithAntiBotRetries(
    page: Page,
    url: string,
    context: string,
    successSelectors: string[] = [],
    retries: number = 3
): Promise<string> {
    return withAntiBotRetries(async () => {
        await preparePage(page);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(1500 + Math.floor(Math.random() * 1000));

        if (successSelectors.length > 0) {
            try {
                await page.waitForSelector(successSelectors.join(', '), { timeout: 12000 });
            } catch {
                // fall through to content inspection below
            }
        }

        const html = await page.content();
        assertNoAntiBotText(html, context);
        return html;
    }, context, retries);
}
