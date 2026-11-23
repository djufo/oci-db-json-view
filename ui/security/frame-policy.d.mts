export function parseFramePolicy(env?: Record<string, string | undefined>): {origin:string; name:string}[];
export function frameCSP(entries: {origin:string; name:string}[], existing?: string): string;
