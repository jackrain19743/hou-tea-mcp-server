export interface UiResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  text: string;
}

const baseStyle = `
  body { margin: 0; font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #f7f4e8; background: #11140f; }
  .wrap { padding: 16px; }
  .card { border: 1px solid rgba(144, 190, 109, .35); border-radius: 14px; background: rgba(255,255,255,.06); padding: 12px; margin: 8px 0; }
  .muted { color: rgba(247,244,232,.65); font-size: 12px; }
  .btn { display: inline-block; margin-top: 10px; padding: 8px 12px; border-radius: 999px; background: #86b45f; color: #11140f; font-weight: 700; }
`;

function html(title: string, body: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>${baseStyle}</style>
</head>
<body>
  <div class="wrap">
    <h3>${title}</h3>
    ${body}
    <p class="muted">Styled according to Hou Tea DESIGN.md: calm, ritual, token-driven, no unsafe wallet handling.</p>
    <p class="muted">If your MCP host does not pass tool results into Apps yet, use the JSON result shown in chat.</p>
  </div>
</body>
</html>`;
}

export const UI_RESOURCES: UiResource[] = [
  {
    uri: "ui://hou-tea/tea-recommendation-grid.html",
    name: "Hou Tea Recommendation Grid",
    description: "Displays product recommendations and follow-up actions.",
    mimeType: "text/html",
    text: html(
      "Tea recommendations",
      `<div class="card"><strong>Recommendation Grid</strong><p class="muted">Use the tool result's recommendations/products array to render cards, images, prices, and explain/buy actions.</p></div>`
    ),
  },
  {
    uri: "ui://hou-tea/payment-review-card.html",
    name: "Hou Tea Payment Review",
    description: "Reviews x402 payment requirements before wallet handoff.",
    mimeType: "text/html",
    text: html(
      "Payment review",
      `<div class="card"><strong>x402 payment intent</strong><p class="muted">Confirm amount, network, recipient, and retry body before handing off to an x402 wallet MCP.</p><span class="btn">Review payment</span></div>`
    ),
  },
  {
    uri: "ui://hou-tea/order-timeline.html",
    name: "Hou Tea Order Timeline",
    description: "Displays order status, payment state, and tracking progress.",
    mimeType: "text/html",
    text: html(
      "Order timeline",
      `<div class="card"><strong>Order status</strong><p class="muted">Render pending payment, verifying, confirmed, shipped, and tracking updates from the tool result.</p></div>`
    ),
  },
];

export function listUiResources() {
  return UI_RESOURCES.map(({ uri, name, description, mimeType }) => ({
    uri,
    name,
    description,
    mimeType,
  }));
}

export function readUiResource(uri: string): UiResource | undefined {
  return UI_RESOURCES.find((r) => r.uri === uri);
}
