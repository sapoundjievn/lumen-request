import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "../../../../lib/stripe";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const stripe = getStripe();
    let customerId = String(body.customerId || "");
    if (!customerId) {
      const c = await stripe.customers.create({
        email: body.email,
        name: body.name,
        metadata: { rider_id: String(body.riderId || "") },
      });
      customerId = c.id;
    }
    const origin = req.headers.get("origin") || "https://lumen-request-beta.vercel.app";
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customerId,
      success_url: origin + "/?stripe=ok&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: origin + "/?stripe=cancel",
      payment_method_types: ["card"],
    });
    return NextResponse.json({ url: session.url, customerId });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("session_id") || "";
    if (!id) return NextResponse.json({ error: "no session" }, { status: 400 });
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(id, { expand: ["setup_intent"] });
    const si = session.setup_intent;
    const setup = typeof si === "object" && si ? si : null;
    const pmId = setup && typeof setup.payment_method === "string" ? setup.payment_method : "";
    if (!pmId) return NextResponse.json({ error: "no card" }, { status: 400 });
    const pm = await stripe.paymentMethods.retrieve(pmId);
    if (session.customer && pmId) {
      await stripe.customers.update(String(session.customer), {
        invoice_settings: { default_payment_method: pmId },
      });
    }
    return NextResponse.json({
      customerId: session.customer,
      paymentMethodId: pmId,
      brand: pm.card?.brand || "card",
      last4: pm.card?.last4 || "",
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
