/**
 * What `@openuidev/devtools` resolves to (vite.config.ts `resolve.alias`).
 *
 * In development, `@openuidev/react-lang` imports the devtools package, whose
 * widget fetches its code from cdn.jsdelivr.net at run time: remote code in
 * the app's window. dummyPlane never loads it: this stub renders nothing and
 * fetches nothing, in `vite dev`, the build and the tests alike.
 */
export function OpenUIDevtools(): null {
  return null;
}

export function mountOpenUIDevtoolsFromCdn(): () => void {
  return () => {};
}
