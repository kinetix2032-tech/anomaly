const SITE_ORIGIN = "https://kinetix2032-tech.github.io";
const SITE_HOST = "kinetix2032-tech.github.io";
const PRINTFUL_PRODUCT_ID = 476463917;

const VARIANTS = Object.freeze({
  "5526097392": { size: "S", catalogVariantId: 11546, retailPrice: 35.00 },
  "5526097393": { size: "M", catalogVariantId: 11547, retailPrice: 35.00 },
  "5526097394": { size: "L", catalogVariantId: 11548, retailPrice: 35.00 },
  "5526097395": { size: "XL", catalogVariantId: 11549, retailPrice: 35.00 },
  "5526097396": { size: "2XL", catalogVariantId: 11550, retailPrice: 35.00 },
  "5526097397": { size: "3XL", catalogVariantId: 12644, retailPrice: 40.50 },
  "5526097398": { size: "4XL", catalogVariantId: 12645, retailPrice: 43.00 },
  "5526097399": { size: "5XL", catalogVariantId: 12646, retailPrice: 45.50 }
});

function responseHeaders(origin) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin"
  });

  if (origin === SITE_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", SITE_ORIGIN);
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
  }

  return headers;
}

function jsonResponse(origin, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders(origin)
  });
}

function cleanOptionalString(value, maxLength = 100) {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maxLength) return undefined;
  return cleaned;
}

async function verifyTurnstile(token, request, secret) {
  if (typeof token !== "string" || token.length < 10 || token.length > 2048) {
    return false;
  }

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);

  const remoteIp = request.headers.get("CF-Connecting-IP");
  if (remoteIp) form.set("remoteip", remoteIp);

  try {
    const verifyResponse = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString()
      }
    );

    if (!verifyResponse.ok) return false;

    const result = await verifyResponse.json();
    return result.success === true && result.hostname === SITE_HOST;
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);

    if (origin && origin !== SITE_ORIGIN) {
      return jsonResponse(null, { error: "Origin not allowed." }, 403);
    }

    if (request.method === "OPTIONS") {
      if (origin !== SITE_ORIGIN) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, {
        status: 204,
        headers: responseHeaders(origin)
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse(origin, {
        service: "ANOMALY storefront API",
        status: "ok",
        printfulTokenConfigured: Boolean(env.PRINTFUL_TOKEN),
        turnstileSecretConfigured: Boolean(env.TURNSTILE_SECRET_KEY),
        checkoutEnabled: false
      });
    }

    if (request.method === "GET" && url.pathname === "/api/catalog") {
      return jsonResponse(origin, {
        product: {
          id: PRINTFUL_PRODUCT_ID,
          code: "ANM-001",
          name: "ANOMALY / CORE TEE",
          currency: "USD",
          variants: Object.entries(VARIANTS).map(([syncVariantId, variant]) => ({
            syncVariantId,
            catalogVariantId: variant.catalogVariantId,
            size: variant.size,
            color: "Black",
            price: variant.retailPrice,
            currency: "USD"
          }))
        }
      });
    }

    if (request.method === "POST" && url.pathname === "/api/shipping-rates") {
      if (!env.PRINTFUL_TOKEN) {
        return jsonResponse(origin, {
          error: "Shipping estimates are not configured yet."
        }, 503);
      }

      // Turnstile is required so this public proxy cannot be casually abused.
      // Do not enable shipping estimates until the site widget and this secret
      // are both configured.
      if (!env.TURNSTILE_SECRET_KEY) {
        return jsonResponse(origin, {
          error: "Shipping estimates are not enabled yet."
        }, 503);
      }

      const declaredLength = Number(request.headers.get("Content-Length") || 0);
      if (declaredLength > 12000) {
        return jsonResponse(origin, { error: "Request is too large." }, 413);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse(origin, { error: "A valid JSON request is required." }, 400);
      }

      const verified = await verifyTurnstile(
        body.turnstileToken,
        request,
        env.TURNSTILE_SECRET_KEY
      );

      if (!verified) {
        return jsonResponse(origin, {
          error: "Security check failed. Refresh the page and try again."
        }, 403);
      }

      const inputRecipient = body.recipient || {};
      const countryCode = String(inputRecipient.country_code || "").trim().toUpperCase();
      const stateCode = cleanOptionalString(inputRecipient.state_code, 10)?.toUpperCase();

      if (!/^[A-Z]{2}$/.test(countryCode)) {
        return jsonResponse(origin, { error: "Enter a valid destination country." }, 400);
      }

      if (["US", "CA", "AU"].includes(countryCode) && !stateCode) {
        return jsonResponse(origin, {
          error: "A state or province is required for this destination."
        }, 400);
      }

      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 8) {
        return jsonResponse(origin, { error: "The cart contains an invalid number of items." }, 400);
      }

      const orderItems = [];
      for (const item of body.items) {
        const syncVariantId = String(item?.syncVariantId ?? item?.variantId ?? "");
        const variant = VARIANTS[syncVariantId];
        const quantity = Number(item?.quantity);

        if (!variant || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
          return jsonResponse(origin, {
            error: "The cart contains an invalid product or quantity."
          }, 400);
        }

        orderItems.push({
          variant_id: variant.catalogVariantId,
          quantity,
          value: variant.retailPrice.toFixed(2)
        });
      }

      const recipient = {
        country_code: countryCode,
        ...(stateCode ? { state_code: stateCode } : {})
      };

      const city = cleanOptionalString(inputRecipient.city, 100);
      const zip = cleanOptionalString(inputRecipient.zip, 30);
      if (city) recipient.city = city;
      if (zip) recipient.zip = zip;

      try {
        const printfulResponse = await fetch("https://api.printful.com/shipping/rates", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.PRINTFUL_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            recipient,
            items: orderItems,
            currency: "USD",
            locale: "en_US"
          })
        });

        const payload = await printfulResponse.json().catch(() => null);

        if (!printfulResponse.ok || !Array.isArray(payload?.result)) {
          return jsonResponse(origin, {
            error: "Printful could not calculate shipping for this selection. Check the destination and try again."
          }, 502);
        }

        const rates = payload.result.map((rate) => ({
          id: String(rate.id || rate.name || "STANDARD"),
          name: String(rate.name || "Shipping"),
          rate: Number(rate.rate),
          currency: String(rate.currency || "USD"),
          minDeliveryDays: Number.isFinite(Number(rate.minDeliveryDays))
            ? Number(rate.minDeliveryDays)
            : null,
          maxDeliveryDays: Number.isFinite(Number(rate.maxDeliveryDays))
            ? Number(rate.maxDeliveryDays)
            : null
        })).filter((rate) => Number.isFinite(rate.rate) && rate.rate >= 0);

        return jsonResponse(origin, { rates });
      } catch {
        return jsonResponse(origin, {
          error: "Shipping service is temporarily unavailable. Try again later."
        }, 502);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/checkout") {
      return jsonResponse(origin, {
        error: "Checkout is not connected yet. No payment or Printful order was created."
      }, 503);
    }

    return jsonResponse(origin, { error: "Not found." }, 404);
  }
};
