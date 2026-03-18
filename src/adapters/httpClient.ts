import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { sleep } from './antiBot';

export interface AdapterHttpClientOptions {
    defaultHeaders?: Record<string, string>;
    timeoutMs?: number;
    requestIntervalMs?: number;
}

function getCookieName(cookie: string): string {
    return cookie.split('=')[0]?.trim() || '';
}

function getCookiePair(cookie: string): string {
    return cookie.split(';')[0]?.trim() || '';
}

export class AdapterHttpClient {
    private readonly client;
    private readonly cookieJar = new Map<string, string>();
    private schedule = Promise.resolve();

    constructor(private readonly options: AdapterHttpClientOptions = {}) {
        this.client = axios.create({
            timeout: options.timeoutMs ?? 30000,
            headers: options.defaultHeaders
        });

        this.client.interceptors.request.use(async (config) => {
            await this.waitForTurn();

            const cookieHeader = this.getCookieHeader();
            if (cookieHeader) {
                config.headers.set('Cookie', cookieHeader);
            }
            return config;
        });

        this.client.interceptors.response.use((response) => {
            this.captureCookies(response);
            return response;
        });
    }

    async get<T = string>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
        return this.client.get<T>(url, config);
    }

    private async waitForTurn(): Promise<void> {
        const gapMs = this.options.requestIntervalMs ?? 0;
        if (gapMs <= 0) {
            return;
        }

        const previous = this.schedule;
        let release!: () => void;
        this.schedule = new Promise<void>((resolve) => {
            release = resolve;
        });

        await previous;
        await sleep(gapMs);
        release();
    }

    private captureCookies(response: AxiosResponse): void {
        const rawCookies = response.headers['set-cookie'];
        if (!rawCookies) {
            return;
        }

        const cookies = Array.isArray(rawCookies) ? rawCookies : [rawCookies];
        for (const cookie of cookies) {
            const pair = getCookiePair(cookie);
            const name = getCookieName(pair);
            if (!name) {
                continue;
            }
            this.cookieJar.set(name, pair);
        }
    }

    private getCookieHeader(): string {
        return Array.from(this.cookieJar.values()).join('; ');
    }
}

export function createDefaultAdapterHttpClient(requestIntervalMs: number = 0): AdapterHttpClient {
    return new AdapterHttpClient({
        timeoutMs: 30000,
        requestIntervalMs,
        defaultHeaders: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
        }
    });
}
