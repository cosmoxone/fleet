export function normalizeAcpHttpBaseUrl(rawBaseUrl: string): string {
  const trimmed = rawBaseUrl.trim();
  if (!trimmed) {
    throw new Error('External ACP backend URL is required');
  }

  const url = new URL(trimmed);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`External ACP backend URL must use http: or https:, got ${url.protocol}`);
  }

  if (url.search || url.hash) {
    throw new Error('External ACP backend URL must not include query parameters or fragments');
  }

  const pathname = url.pathname.replace(/\/+$/, '');
  if (pathname.endsWith('/acp')) {
    throw new Error('External ACP backend URL must be the base URL before /acp');
  }

  return `${url.origin}${pathname}`;
}

export function acpWebSocketUrlFromHttpBase(baseUrl: string, token: string): string {
  const base = new URL(normalizeAcpHttpBaseUrl(baseUrl));
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/acp`;
  base.searchParams.set('token', token);
  return base.toString();
}
