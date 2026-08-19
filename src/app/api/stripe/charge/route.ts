import { NextRequest, NextResponse } from "next/server";
import { getStripe, dollarsToCents } from "../../../../lib/stripe";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const stripe = getStripe();
    const fare = Number(body.fare) || 0;
    const tip = Number(body.tip) || 0;
    const amount = dollarsToCents(fare + tip);
    const driverCents = Math.round(fare * 0.7 * 100) + Math.round(tip * 100);
    const platformCents = amount - driverCents;
    const customer = String(body.customerId || "");
    const pm = String(body.paymentMethodId || "");
    const tripId = String(body.tripId || "");
    let driverAccount = String(body.driverStripeAccount || "");
    if (!driverAccount && body.driverId && process.env.NEXT_PUBLIC_SUPABASE_URL) {
      try {
        const u = process.env.NEXT_PUBLIC_SUPABASE_URL + "/rest/v1/lumen_driver_accounts?id=eq." + encodeURIComponent(String(body.driverId)) + "&select=stripe_account_id";
        const r = await fetch(u, {
          headers: {
            apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
            Authorization: "Bearer " + (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""),
          },
        });
        const rows = await r.json();
        driverAccount = (Array.isArray(rows) ? rows[0]?.stripe_account_id : "") || "";
      } catch {}
    }
    if (!customer || !pm) {
      return NextResponse.json({ error: "No saved card" }, { status: 400 });
    }
    const create: Parameters<typeof stripe.paymentIntents.create>[0] = {
      amount,
      currency: "usd",
      customer,
      payment_method: pm,
      off_session: true,
      confirm: true,
      metadata: { trip_id: tripId },
    };
    if (driverAccount) {
      create.transfer_data = { destination: driverAccount, amount: driverCents };
    }
    const pi = await stripe.paymentIntents.create(create, {
      idempotencyKey: tripId ? "lumen_" + tripId : undefined,
    });
    return NextResponse.json({
      ok: true,
      id: pi.id,
      amount,
      driverCents,
      platformCents,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
