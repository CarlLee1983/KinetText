import { describe, expect, test } from 'bun:test';
import {
    DEFAULT_TRUSTED_CLIENT_TOKEN,
    generateSecMsGec,
    MicrosoftEdgeTTSProvider
} from '../src/tts/MicrosoftEdgeTTSProvider';

describe('MicrosoftEdgeTTSProvider auth', () => {
    test('uses the public Edge TTS token by default', () => {
        delete process.env.MICROSOFT_TTS_TOKEN;
        const provider = new MicrosoftEdgeTTSProvider();
        expect((provider as any).trustedClientToken).toBe(DEFAULT_TRUSTED_CLIENT_TOKEN);
    });

    test('generates Sec-MS-GEC using Windows file time ticks', () => {
        const gec = generateSecMsGec(DEFAULT_TRUSTED_CLIENT_TOKEN, 1_700_000_000);
        expect(gec).toMatch(/^[0-9A-F]{64}$/);
        expect(gec).toBe(generateSecMsGec(DEFAULT_TRUSTED_CLIENT_TOKEN, 1_700_000_000));
    });
});
