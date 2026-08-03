export function uid(prefix: string): string {
  return prefix + "_" + crypto.randomUUID();
}
