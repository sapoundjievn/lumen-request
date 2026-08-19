import Stripe from "stripe";

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY || "";
  if (!key) throw new Error("STRIPE_SECRET_KEY missing");
  return new Stripe(key);
}

export function dollarsToCents(n: number) {
  return Math.max(50, Math.round(Number(n) * 100));
}
