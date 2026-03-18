export function hostnameMatches(url: string, allowedHosts: string[]): boolean {
    try {
        const { hostname } = new URL(url);
        return allowedHosts.includes(hostname.toLowerCase());
    } catch {
        return false;
    }
}
