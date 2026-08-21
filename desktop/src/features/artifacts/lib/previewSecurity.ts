const HOST_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join("; ");

/**
 * Wrap untrusted static HTML in host-owned policy. The iframe remains opaque
 * because callers must omit `allow-same-origin`; artifact CSP and base tags
 * are removed so content cannot weaken or redirect this policy.
 */
export function buildOpaqueHtmlDocument(source: string): string {
  const withoutBase = source.replace(/<base\b[^>]*>/gi, "");
  const withoutArtifactCsp = withoutBase.replace(
    /<meta\b(?=[^>]*http-equiv\s*=\s*["']?content-security-policy["']?)[^>]*>/gi,
    "",
  );
  const policy = `<meta http-equiv="Content-Security-Policy" content="${HOST_CSP}">`;
  if (/<head\b[^>]*>/i.test(withoutArtifactCsp)) {
    return withoutArtifactCsp.replace(
      /<head\b[^>]*>/i,
      (head) => `${head}${policy}`,
    );
  }
  return `<!doctype html><html><head>${policy}</head><body>${withoutArtifactCsp}</body></html>`;
}

export function svgImageDataUrl(source: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
}
