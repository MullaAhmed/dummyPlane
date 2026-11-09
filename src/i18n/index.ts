/**
 * The interface is English-only. Each domain keeps its texts in a typed
 * `messages.ts` object: `defineMessages(en)` returns it unchanged, so a
 * component reads `t.someKey` and a value is a text or a function (parameters).
 */
export function defineMessages<M>(en: M): M {
  return en;
}

/** Outside React: the messages of a domain. Kept as an identity helper. */
export function messages<M>(dict: M): M {
  return dict;
}

/** In a component: the messages of a domain. Kept as an identity helper. */
export function useMessages<M>(dict: M): M {
  return dict;
}

/** "1 agent", "3 agents": singular for 1 only. */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
