// Runtime-only policy. No default exception, including localhost.
export function parseFramePolicy(env = process.env) {
  const invalid = () => { throw new Error('Invalid FRAME_ALLOWED_ANCESTORS or FRAME_ALLOWED_INSECURE_HOSTS'); };
  const validHost = host => host.length <= 253 && host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  const insecure = new Set();
  if (env.FRAME_ALLOWED_INSECURE_HOSTS) for (const raw of env.FRAME_ALLOWED_INSECURE_HOSTS.split(',')) {
    const host = raw.trim();
    if (!validHost(host)) invalid();
    insecure.add(host);
  }
  const entries = [];
  if (!env.FRAME_ALLOWED_ANCESTORS) return entries;
  for (const raw of env.FRAME_ALLOWED_ANCESTORS.split(',')) {
    const parts = raw.trim().split('|');
    if (parts.length !== 2) invalid();
    const [origin, name] = parts;
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(name) || /[\s*\\]/.test(origin)) invalid();
    let url;
    try { url = new URL(origin); } catch { invalid(); }
    if (url.origin !== origin || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !url.hostname) invalid();
    if (!validHost(url.hostname) && !/^\[[0-9a-f:.]+\]$/.test(url.hostname)) invalid();
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && insecure.has(url.hostname))) invalid();
    entries.push({origin, name});
  }
  return entries;
}
export function frameCSP(entries, existing = "") {
  const directives=existing.split(";").map(part=>part.trim()).filter(part=>part && part.split(/\s/)[0].toLowerCase()!=="frame-ancestors");
  const denyAll = !entries.length && existing.split(';').some(part => {
    const fields = part.trim().split(/\s+/);
    return fields[0].toLowerCase() === 'frame-ancestors' && fields.length === 2 && fields[1] === "'none'";
  });
  const ancestors=denyAll ? "frame-ancestors 'none'" : "frame-ancestors 'self'" + [...new Set(entries.map(entry => entry.origin))].map(origin => ' '+origin).join('');
  return [...directives,ancestors].join("; ");
}
