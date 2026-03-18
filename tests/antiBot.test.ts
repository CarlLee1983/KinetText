import { describe, expect, test } from 'bun:test';
import { AntiBotError, assertNoAntiBotText, detectAntiBotText, getRetryDelayMs } from '../src/adapters/antiBot';

describe('anti-bot helpers', () => {
    test('detects common challenge pages', () => {
        expect(detectAntiBotText('<title>Just a moment...</title>')).not.toBeNull();
        expect(detectAntiBotText('Performing security verification')).not.toBeNull();
        expect(detectAntiBotText('Ordinary novel chapter content')).toBeNull();
    });

    test('throws AntiBotError when challenge page is detected', () => {
        expect(() => assertNoAntiBotText('Attention Required! | Cloudflare', 'twkan metadata')).toThrow(AntiBotError);
    });

    test('retry delay grows with attempt number', () => {
        const first = getRetryDelayMs(1, 1000);
        const second = getRetryDelayMs(2, 1000);

        expect(first).toBeGreaterThanOrEqual(1000);
        expect(second).toBeGreaterThanOrEqual(2000);
        expect(second).toBeGreaterThan(first - 400);
    });
});
