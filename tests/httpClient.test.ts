import { afterEach, describe, expect, test } from 'bun:test';
import { AdapterHttpClient, resolveAdapterProxyConfig } from '../src/adapters/httpClient';

describe('AdapterHttpClient', () => {
    const originalProxy = process.env.KINETITEXT_HTTP_PROXY;

    afterEach(() => {
        if (originalProxy === undefined) {
            delete process.env.KINETITEXT_HTTP_PROXY;
        } else {
            process.env.KINETITEXT_HTTP_PROXY = originalProxy;
        }
    });

    test('disables env proxy by default to avoid dead local proxy ECONNREFUSED', () => {
        delete process.env.KINETITEXT_HTTP_PROXY;
        expect(resolveAdapterProxyConfig()).toBe(false);
    });

    test('uses KINETITEXT_HTTP_PROXY when explicitly configured', () => {
        process.env.KINETITEXT_HTTP_PROXY = 'http://127.0.0.1:7890';
        expect(resolveAdapterProxyConfig()).toEqual({
            protocol: 'http',
            host: '127.0.0.1',
            port: 7890
        });
    });

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
