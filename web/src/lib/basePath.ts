/** Prefix a public asset or API path with the app's base path (next/link does this on its own). */
export const withBase = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
