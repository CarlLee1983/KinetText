import { describe, expect, test } from 'bun:test';
import { AdapterHttpClient } from '../src/adapters/httpClient';

describe('AdapterHttpClient', () => {
    test('stores the latest cookie values from set-cookie headers', async () => {
        const client = new AdapterHttpClient();
        const captureCookies = (client as any).captureCookies.bind(client);
        const getCookieHeader = (client as any).getCookieHeader.bind(client);

        captureCookies({
            headers: {
                'set-cookie': [
                    'session=abc; Path=/; HttpOnly',
                    'theme=dark; Path=/'
                ]
            }
        });

        captureCookies({
            headers: {
                'set-cookie': [
                    'session=xyz; Path=/; HttpOnly'
                ]
            }
        });

        expect(getCookieHeader()).toContain('session=xyz');
        expect(getCookieHeader()).toContain('theme=dark');
        expect(getCookieHeader()).not.toContain('session=abc');
    });
});
