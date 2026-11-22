// Evaluate before importing any application module: imports may start data loads.
export function frameAllowed(win, entries) {
  try {
    if (win.self === win.top) return true;
    let origin;
    if (win.location.ancestorOrigins?.length) origin = win.location.ancestorOrigins[0];
    else if (win.document.referrer) origin = new URL(win.document.referrer).origin;
    if (!origin || origin === 'null') return false;
    return Array.isArray(entries) && entries.some(entry => entry.origin === origin && entry.name === win.name);
  } catch { return false; }
}
export function frameError(doc = globalThis.document) {
  doc.documentElement.innerHTML = '<head><title>Unsupported frame</title></head><body><main><h1>This app is not supported inside a frame</h1></main></body>';
}
export async function startApp(load, configURL = '/frame-config.json') {
  try {
    const response = await fetch(configURL, {cache:'no-store', credentials:'same-origin'});
    if (!response.ok) throw new Error('Frame configuration unavailable');
    const config = await response.json();
    if (!frameAllowed(globalThis.window, config.frameAllowedAncestors)) { frameError(); return; }
  } catch { frameError(); return; }
  await load();
}
