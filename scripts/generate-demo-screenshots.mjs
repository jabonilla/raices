/**
 * K2.40: Generate partner demo screenshots (HTML).
 *
 * Creates 4 standalone HTML files showing the key moments in Spanish,
 * styled like a phone screen. For José's settlement partner conversations.
 *
 * Usage: node scripts/generate-demo-screenshots.mjs
 * Output: docs/demo-assets/*.html
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "../docs/demo-assets");

mkdirSync(OUT_DIR, { recursive: true });

function phoneFrame(title, content) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Raíces Demo</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #f0f0f0;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    padding: 20px;
  }
  .phone {
    width: 390px;
    height: 844px;
    background: #ffffff;
    border-radius: 40px;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    display: flex;
    flex-direction: column;
  }
  .screen { flex: 1; overflow-y: auto; padding: 20px; }
  .caption {
    text-align: center;
    padding: 16px;
    color: #666;
    font-size: 14px;
    max-width: 390px;
  }
</style>
</head>
<body>
<div>
  <div class="phone"><div class="screen">${content}</div></div>
  <div class="caption">${title}</div>
</div>
</body>
</html>`;
}

const inviteContent = `
  <h1 style="font-size: 28px; margin-bottom: 8px;">Invitar</h1>
  <p style="color: #666; margin-bottom: 24px;">¿Cómo le dices a esta persona?</p>
  <div style="margin-bottom: 16px;">
    <label style="font-size: 14px; color: #333; display: block; margin-bottom: 8px;">Nombre</label>
    <div style="border: 1px solid #ddd; border-radius: 12px; padding: 16px; font-size: 17px;">Mamá</div>
  </div>
  <div style="margin-bottom: 24px;">
    <label style="font-size: 14px; color: #333; display: block; margin-bottom: 8px;">Número de teléfono</label>
    <div style="border: 1px solid #ddd; border-radius: 12px; padding: 16px; font-size: 17px;">+502 5551 2345</div>
  </div>
  <div style="background: #007AFF; color: white; border-radius: 12px; padding: 16px; text-align: center; font-size: 17px; font-weight: 600;">
    Enviar invitación
  </div>
  <div style="margin-top: 32px; padding: 16px; background: #f0f9ff; border-radius: 12px;">
    <p style="font-size: 15px; font-weight: 600; margin-bottom: 8px;">Invitación enviada.</p>
    <p style="font-size: 14px; color: #555;">Le mandamos un mensaje por WhatsApp. Cuando acepte, lo vas a ver aquí.</p>
  </div>
`;

const requestContent = `
  <p style="font-size: 15px; color: #666; margin-bottom: 4px;">Buenos días, Carlos</p>
  <h1 style="font-size: 28px; margin-bottom: 24px;">Enviar dinero</h1>
  <div style="border: 1px solid #e0e0e0; border-radius: 16px; padding: 20px; margin-bottom: 16px;">
    <p style="font-size: 14px; color: #666; margin-bottom: 8px;">Para</p>
    <p style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">Mamá 🇬🇹</p>
    <p style="font-size: 14px; color: #666; margin-bottom: 8px;">Cantidad</p>
    <p style="font-size: 36px; font-weight: 700; margin-bottom: 16px;">$25.00</p>
    <p style="font-size: 14px; color: #666; margin-bottom: 8px;">Motivo</p>
    <p style="font-size: 17px;">Víveres</p>
  </div>
  <div style="background: #007AFF; color: white; border-radius: 12px; padding: 16px; text-align: center; font-size: 17px; font-weight: 600;">
    Enviar ahora
  </div>
  <p style="font-size: 13px; color: #999; text-align: center; margin-top: 16px;">
    El dinero se mueve cuando aprobés la solicitud.
  </p>
`;

const approvalContent = `
  <h1 style="font-size: 28px; margin-bottom: 8px;">Aprobaciones</h1>
  <p style="color: #666; margin-bottom: 24px; font-size: 15px;">Revisá antes de que se mueva el dinero.</p>
  <div style="border: 2px solid #FF9500; border-radius: 16px; padding: 20px; margin-bottom: 16px; background: #fff9f0;">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <p style="font-size: 17px; font-weight: 600;">$25.00 para Mamá</p>
      <span style="background: #FF9500; color: white; font-size: 12px; padding: 4px 12px; border-radius: 20px; font-weight: 600;">PENDIENTE</span>
    </div>
    <p style="font-size: 15px; color: #555; margin-bottom: 8px;">Motivo: Víveres</p>
    <p style="font-size: 14px; color: #888;">Solicitado hace 2 minutos</p>
  </div>
  <div style="display: flex; gap: 12px;">
    <div style="flex: 1; border: 1px solid #ddd; border-radius: 12px; padding: 16px; text-align: center; font-size: 17px; color: #666;">
      Todavía no
    </div>
    <div style="flex: 1; background: #34C759; color: white; border-radius: 12px; padding: 16px; text-align: center; font-size: 17px; font-weight: 600;">
      Aprobar $25.00
    </div>
  </div>
  <p style="font-size: 13px; color: #999; text-align: center; margin-top: 16px;">
    Nada se mueve hasta que aprobés. El libro queda balanceado: débitos = créditos.
  </p>
`;

const arrivalContent = `
  <h1 style="font-size: 28px; margin-bottom: 24px;">Historial</h1>
  <div style="border: 1px solid #e0e0e0; border-radius: 16px; padding: 20px; margin-bottom: 16px; background: #f0fff4;">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <p style="font-size: 17px; font-weight: 600;">$25.00 para Mamá</p>
      <span style="background: #34C759; color: white; font-size: 12px; padding: 4px 12px; border-radius: 20px; font-weight: 600;">APROBADO</span>
    </div>
    <p style="font-size: 15px; color: #555; margin-bottom: 8px;">Motivo: Víveres</p>
    <p style="font-size: 14px; color: #888;">Hoy, 10:30 AM</p>
  </div>
  <div style="padding: 16px; background: #f0f9ff; border-radius: 12px; margin-bottom: 16px;">
    <p style="font-size: 14px; font-weight: 600; margin-bottom: 8px;">💬 WhatsApp para Mamá:</p>
    <p style="font-size: 15px; color: #333; font-style: italic;">
      "Carlos te envió $25.00 para víveres. Respondé SÍ para recibirlo."
    </p>
  </div>
  <p style="font-size: 13px; color: #999; text-align: center;">
    Mamá no necesita instalar nada. Solo usa WhatsApp.
  </p>
`;

const moments = [
  { file: "01-invite.html", title: "1. Invitación — Carlos invita a Mamá", content: inviteContent },
  { file: "02-request.html", title: "2. Solicitud — $25 para víveres", content: requestContent },
  { file: "03-approval.html", title: "3. Aprobación — El gate", content: approvalContent },
  { file: "04-arrival.html", title: "4. Llegada — WhatsApp para Mamá", content: arrivalContent },
];

for (const m of moments) {
  const html = phoneFrame(m.title, m.content);
  writeFileSync(join(OUT_DIR, m.file), html);
  console.log(`Wrote ${m.file}`);
}

console.log(`\nDone. Open docs/demo-assets/*.html in a browser.`);
