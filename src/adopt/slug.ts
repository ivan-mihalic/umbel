export function slugify(input: string): string {
  const lower = input.toLowerCase();
  const replaced = lower.replace(/[^a-z0-9]+/g, "-");
  return replaced.replace(/^-+/, "").replace(/-+$/, "");
}

export function isValidSlug(s: string): boolean {
  return s.length > 0 && /^[a-z0-9-]+$/.test(s);
}
