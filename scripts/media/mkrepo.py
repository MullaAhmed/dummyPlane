"""The throwaway repository the recordings work in: %TEMP%/dummyplane-media/acme-shop,
one commit, then an uncommitted change for the review scene. Prints its path."""
import os
import subprocess
import tempfile

ROOT = os.path.join(tempfile.gettempdir(), "dummyplane-media", "acme-shop")
COMMITTED = {
    "README.md": "# acme-shop\n\nA tiny storefront API used to demo dummyPlane.\n",
    "package.json": '{\n  "name": "acme-shop",\n  "private": true,\n  "type": "module",\n  "scripts": { "test": "vitest run" }\n}\n',
    "src/cart.ts": """export interface Item {
  sku: string;
  price: number;
  quantity: number;
}

export function subtotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function addItem(items: Item[], item: Item): Item[] {
  const found = items.find((i) => i.sku === item.sku);
  if (!found) return [...items, item];
  return items.map((i) => (i.sku === item.sku ? { ...i, quantity: i.quantity + item.quantity } : i));
}
""",
    "src/checkout.ts": """import { subtotal, type Item } from "./cart";

const TAX_RATE = 0.2;

export function total(items: Item[], coupon?: string): number {
  let amount = subtotal(items);
  if (coupon === "WELCOME10") amount = amount * 0.9;
  return Math.round(amount * (1 + TAX_RATE) * 100) / 100;
}
""",
    "src/auth/session.ts": """export interface Session {
  userId: string;
  expiresAt: number;
}

export function isExpired(session: Session, now = Date.now()): boolean {
  return session.expiresAt < now;
}
""",
    "src/cart.test.ts": """import { describe, expect, it } from "vitest";
import { addItem, subtotal } from "./cart";

describe("cart", () => {
  it("sums the items", () => {
    expect(subtotal([{ sku: "a", price: 2, quantity: 3 }])).toBe(6);
  });
  it("merges the same sku", () => {
    expect(addItem([{ sku: "a", price: 2, quantity: 1 }], { sku: "a", price: 2, quantity: 2 })).toHaveLength(1);
  });
});
""",
}
# What an agent "changed": the review scene shows it.
CHANGED = {
    "src/checkout.ts": """import { subtotal, type Item } from "./cart";
import { discountFor } from "./coupons";

const TAX_RATE = 0.2;

export function total(items: Item[], coupon?: string): number {
  const amount = subtotal(items) * (1 - discountFor(coupon));
  return Math.round(amount * (1 + TAX_RATE) * 100) / 100;
}
""",
    "src/coupons.ts": """const COUPONS: Record<string, number> = {
  WELCOME10: 0.1,
  SPRING25: 0.25,
};

/** The share taken off by `code`, 0 for an unknown code. */
export function discountFor(code?: string): number {
  if (!code) return 0;
  return COUPONS[code.toUpperCase()] ?? 0;
}
""",
}


def write(files):
    for name, text in files.items():
        path = os.path.join(ROOT, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, "w", encoding="utf8", newline="\n").write(text)


git = ["git", "-C", ROOT, "-c", "user.name=dummyPlane Demo", "-c", "user.email=demo@example.com"]
if not os.path.isdir(os.path.join(ROOT, ".git")):
    os.makedirs(ROOT, exist_ok=True)
    subprocess.run(["git", "init", "-q", "-b", "main", ROOT], check=True)
    write(COMMITTED)
    subprocess.run(git + ["add", "-A"], check=True)
    subprocess.run(git + ["commit", "-q", "-m", "Initial storefront"], check=True)
write(CHANGED)
print(ROOT)
