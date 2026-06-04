const { Resend } = require("resend");

/**
 * Centralized email service for Zenin using Resend.
 * https://resend.com/docs/introduction
 */

const RESEND_API_KEY = String(process.env.RESEND_API_KEY || "").trim();
const SMTP_FROM = String(process.env.SMTP_FROM || process.env.EMAIL_FROM || "").trim();
const SMTP_FROM_CONFIGURED = Boolean(SMTP_FROM);
const SMTP_FROM_USES_RESEND_TEST_DOMAIN = /@resend\.dev(?:[>\s"]|$)/i.test(SMTP_FROM);
const RESEND_WEBHOOK_CONFIGURED = Boolean(String(process.env.RESEND_WEBHOOK_SECRET || process.env.RESEND_WEBHOOK_SIGNING_SECRET || "").trim());

// Detect placeholder / unconfigured key
const RESEND_CONFIGURED =
  RESEND_API_KEY &&
  RESEND_API_KEY.startsWith("re_") &&
  RESEND_API_KEY !== "re_your_api_key";

function sanitizeEmailError(error) {
  if (!error) return null;
  return {
    name: error.name || error.code || null,
    message: String(error.message || error.error || error).slice(0, 500),
    statusCode: error.statusCode || error.status || null
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildDeliveryResult({ sent = false, providerMessageId = null, error = null } = {}) {
  return {
    sent: Boolean(sent),
    provider: "resend",
    providerMessageId: providerMessageId || null,
    error: sanitizeEmailError(error),
    deliveryConfig: getEmailDeliveryConfig()
  };
}

function getEmailDeliveryConfig() {
  return {
    resendConfigured: Boolean(RESEND_CONFIGURED),
    fromConfigured: SMTP_FROM_CONFIGURED,
    resendWebhookConfigured: RESEND_WEBHOOK_CONFIGURED,
    from: SMTP_FROM,
    usesResendTestDomain: SMTP_FROM_USES_RESEND_TEST_DOMAIN,
    productionReady: Boolean(RESEND_CONFIGURED && SMTP_FROM_CONFIGURED && !SMTP_FROM_USES_RESEND_TEST_DOMAIN)
  };
}

function isEmailDeliveryProductionReady() {
  return Boolean(getEmailDeliveryConfig().productionReady);
}

// Initialize Resend client (lazy)
let resend = null;

function getResendClient() {
  if (resend) return resend;
  if (!RESEND_CONFIGURED) return null;
  resend = new Resend(RESEND_API_KEY);
  return resend;
}

/**
 * Dev-only fallback: logs the reset link to stdout so it can be used
 * without a real Resend API key during local development.
 */
function logDevResetLink(email, resetLink) {
  if (process.env.NODE_ENV === "production") {
    console.warn("[Email] Password reset email was not sent because Resend is not configured.");
    return;
  }
  console.log("\n" + "=".repeat(70));
  console.log("[DEV] Password reset email NOT sent (Resend not configured).");
  console.log(`[DEV] Recipient : ${email}`);
  console.log(`[DEV] Reset Link: ${resetLink}`);
  console.log("[DEV] Paste the link above into your browser to complete the reset.");
  console.log("=".repeat(70) + "\n");
}

/**
 * Sends a password reset email to a user.
 * Falls back to console logging in local/dev environments.
 * @param {string} email - Recipient email address
 * @param {string} resetToken - The raw reset token (not hashed)
 */
async function sendPasswordResetEmail(email, resetToken) {
  const frontendUrl = (process.env.FRONTEND_URL || "https://www.zenin.capital").replace(/\/+$/, "");
  const resetLink = `${frontendUrl}/auth?mode=forgot&token=${encodeURIComponent(resetToken)}`;
  const escapedResetLink = escapeHtml(resetLink);

  const client = getResendClient();

  // --- Dev fallback: no Resend key ---
  if (!client) {
    console.warn("[Email] RESEND_API_KEY missing or placeholder — falling back to console log.");
    logDevResetLink(email, resetLink);
    return buildDeliveryResult({
      sent: false,
      error: { message: "RESEND_API_KEY missing or placeholder" }
    });
  }

  if (!SMTP_FROM_CONFIGURED) {
    console.error("[Email] SMTP_FROM or EMAIL_FROM is required. Configure a verified sender domain in Resend.");
    return buildDeliveryResult({
      sent: false,
      error: { message: "SMTP_FROM or EMAIL_FROM is missing" }
    });
  }

  if (SMTP_FROM_USES_RESEND_TEST_DOMAIN) {
    console.error("[Email] SMTP_FROM uses a resend.dev test sender. Configure a verified sender domain in Resend.");
    return buildDeliveryResult({
      sent: false,
      error: { message: "SMTP_FROM uses resend.dev test sender" }
    });
  }

  // --- Production: send via Resend ---
  const htmlContent = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e1e1e1; border-radius: 8px; background-color: #ffffff; color: #333333;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #000000; margin: 0;">ZENIN</h1>
        <p style="color: #666666; font-size: 14px; margin-top: 5px;">Capital Management</p>
      </div>
      
      <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 20px;">Reset your password</h2>
      
      <p style="font-size: 16px; line-height: 1.5; margin-bottom: 25px;">
        We received a request to reset the password for your Zenin Capital account. Click the button below to choose a new one:
      </p>
      
      <div style="text-align: center; margin-bottom: 30px;">
        <a href="${escapedResetLink}" style="display: inline-block; padding: 12px 24px; background-color: #0066ff; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Reset Password</a>
      </div>
      
      <p style="font-size: 14px; line-height: 1.5; color: #666666; margin-bottom: 20px;">
        If you didn't request this, you can safely ignore this email. The link will expire in 1 hour.
      </p>
      
      <hr style="border: 0; border-top: 1px solid #eeeeee; margin: 30px 0;">
      
      <p style="font-size: 12px; color: #999999; text-align: center; margin: 0;">
        &copy; ${new Date().getFullYear()} Zenin Capital. All rights reserved.
      </p>
    </div>
  `;

  try {
    const { data, error } = await client.emails.send({
      from: SMTP_FROM,
      to: email,
      subject: "Reset your Zenin Capital password",
      html: htmlContent,
      tags: [
        { name: "zenin_type", value: "password_reset" }
      ],
    });

    if (error) {
      console.error(`[Email] Resend error sending to ${email}:`, error);
      // Still log the link as a fallback so nothing is totally lost
      logDevResetLink(email, resetLink);
      return buildDeliveryResult({ sent: false, error });
    }

    console.log(`[Email] Sent to ${email} via Resend (id: ${data.id})`);
    return buildDeliveryResult({ sent: true, providerMessageId: data?.id || null });
  } catch (err) {
    console.error(`[Email] Unexpected error sending to ${email}:`, err);
    logDevResetLink(email, resetLink);
    return buildDeliveryResult({ sent: false, error: err });
  }
}

/**
 * Sends an account verification email to a user with a 6-digit code.
 * Falls back to console logging in local/dev environments.
 * @param {string} email - Recipient email address
 * @param {string} code - The 6-digit verification code
 */
async function sendVerificationEmail(email, code) {
  const client = getResendClient();
  const escapedCode = escapeHtml(code);

  // --- Dev fallback: no Resend key ---
  if (!client) {
    console.warn("[Email] RESEND_API_KEY missing or placeholder — falling back to console log.");
    console.log("\n" + "=".repeat(70));
    console.log("[DEV] Verification email NOT sent (Resend not configured).");
    console.log(`[DEV] Recipient: ${email}`);
    console.log(`[DEV] Code     : ${code}`);
    console.log("=".repeat(70) + "\n");
    return buildDeliveryResult({
      sent: false,
      error: { message: "RESEND_API_KEY missing or placeholder" }
    });
  }

  if (!SMTP_FROM_CONFIGURED) {
    console.error("[Email] SMTP_FROM or EMAIL_FROM is required. Configure a verified sender domain in Resend.");
    return buildDeliveryResult({
      sent: false,
      error: { message: "SMTP_FROM or EMAIL_FROM is missing" }
    });
  }

  if (SMTP_FROM_USES_RESEND_TEST_DOMAIN) {
    console.error("[Email] SMTP_FROM uses a resend.dev test sender. Configure a verified sender domain in Resend.");
    return buildDeliveryResult({
      sent: false,
      error: { message: "SMTP_FROM uses resend.dev test sender" }
    });
  }

  const htmlContent = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e1e1e1; border-radius: 8px; background-color: #ffffff; color: #333333;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #000000; margin: 0;">ZENIN</h1>
        <p style="color: #666666; font-size: 14px; margin-top: 5px;">Capital Management</p>
      </div>
      
      <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 20px;">Verify your account</h2>
      
      <p style="font-size: 16px; line-height: 1.5; margin-bottom: 25px;">
        To complete your registration with Zenin Capital, please enter the following verification code:
      </p>
      
      <div style="text-align: center; margin-bottom: 30px;">
        <div style="display: inline-block; padding: 16px 32px; background-color: #f3f4f6; color: #000000; border-radius: 8px; font-weight: 700; font-size: 32px; letter-spacing: 0.1em;">
          ${escapedCode}
        </div>
      </div>
      
      <p style="font-size: 14px; line-height: 1.5; color: #666666; margin-bottom: 20px;">
        If you didn't request this, you can safely ignore this email.
      </p>
      
      <hr style="border: 0; border-top: 1px solid #eeeeee; margin: 30px 0;">
      
      <p style="font-size: 12px; color: #999999; text-align: center; margin: 0;">
        &copy; ${new Date().getFullYear()} Zenin Capital. All rights reserved.
      </p>
    </div>
  `;

  try {
    const { data, error } = await client.emails.send({
      from: SMTP_FROM,
      to: email,
      subject: `Verify your Zenin Capital account - ${code}`,
      html: htmlContent,
      tags: [
        { name: "zenin_type", value: "account_verification" }
      ],
    });

    if (error) {
      console.error(`[Email] Resend error sending to ${email}:`, error);
      return buildDeliveryResult({ sent: false, error });
    }

    console.log(`[Email] Sent verification to ${email} (id: ${data.id})`);
    return buildDeliveryResult({ sent: true, providerMessageId: data?.id || null });
  } catch (err) {
    console.error(`[Email] Unexpected error sending verification to ${email}:`, err);
    return buildDeliveryResult({ sent: false, error: err });
  }
}

function logDevAlertEmail(email, alert = {}) {
  if (process.env.NODE_ENV === "production") {
    console.warn("[Email] Alert email was not sent because Resend is not configured.");
    return;
  }
  console.log("\n" + "=".repeat(70));
  console.log("[DEV] Alert email NOT sent (Resend not configured).");
  console.log(`[DEV] Recipient: ${email}`);
  console.log(`[DEV] Type     : ${alert.type || "market_alert"}`);
  console.log(`[DEV] Title    : ${alert.title || "Zenin alert"}`);
  console.log(`[DEV] Body     : ${alert.body || ""}`);
  console.log("=".repeat(70) + "\n");
}

/**
 * Sends a market, watchlist, or workspace assignment alert email.
 * @param {string} email - Recipient email address
 * @param {object} alert - Alert payload
 */
async function sendAlertEmail(email, alert = {}) {
  const client = getResendClient();
  const type = String(alert.type || "market_alert").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 40) || "market_alert";
  const title = String(alert.title || "Zenin alert").trim().slice(0, 140) || "Zenin alert";
  const body = String(alert.body || "A Zenin alert needs your attention.").trim().slice(0, 1200) || "A Zenin alert needs your attention.";
  const workspaceName = String(alert.workspaceName || "Zenin workspace").trim().slice(0, 120) || "Zenin workspace";
  const symbol = String(alert.symbol || "").trim().toUpperCase().slice(0, 32);
  const severity = String(alert.severity || "info").trim().toLowerCase().slice(0, 24) || "info";
  const actionUrl = String(alert.actionUrl || process.env.FRONTEND_URL || "https://www.zenin.capital").trim();

  if (!client) {
    console.warn("[Email] RESEND_API_KEY missing or placeholder — falling back to console log.");
    logDevAlertEmail(email, { type, title, body });
    return buildDeliveryResult({
      sent: false,
      error: { message: "RESEND_API_KEY missing or placeholder" }
    });
  }

  if (!SMTP_FROM_CONFIGURED) {
    console.error("[Email] SMTP_FROM or EMAIL_FROM is required. Configure a verified sender domain in Resend.");
    return buildDeliveryResult({
      sent: false,
      error: { message: "SMTP_FROM or EMAIL_FROM is missing" }
    });
  }

  if (SMTP_FROM_USES_RESEND_TEST_DOMAIN) {
    console.error("[Email] SMTP_FROM uses a resend.dev test sender. Configure a verified sender domain in Resend.");
    return buildDeliveryResult({
      sent: false,
      error: { message: "SMTP_FROM uses resend.dev test sender" }
    });
  }

  const escapedTitle = escapeHtml(title);
  const escapedBody = escapeHtml(body).replace(/\n/g, "<br>");
  const escapedWorkspaceName = escapeHtml(workspaceName);
  const escapedSymbol = escapeHtml(symbol);
  const escapedSeverity = escapeHtml(severity.toUpperCase());
  const escapedActionUrl = escapeHtml(actionUrl);
  const subject = symbol ? `${title} · ${symbol}` : title;

  const htmlContent = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e1e1e1; border-radius: 8px; background-color: #ffffff; color: #333333;">
      <div style="margin-bottom: 24px;">
        <h1 style="color: #000000; margin: 0;">ZENIN</h1>
        <p style="color: #666666; font-size: 14px; margin: 5px 0 0;">${escapedWorkspaceName}</p>
      </div>

      <p style="display: inline-block; margin: 0 0 16px; padding: 6px 10px; border-radius: 999px; background-color: #f3f4f6; color: #111827; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;">
        ${escapedSeverity}${escapedSymbol ? ` · ${escapedSymbol}` : ""}
      </p>

      <h2 style="font-size: 20px; font-weight: 700; margin: 0 0 16px; color: #111827;">${escapedTitle}</h2>

      <p style="font-size: 16px; line-height: 1.55; margin: 0 0 24px;">
        ${escapedBody}
      </p>

      <div style="margin-bottom: 28px;">
        <a href="${escapedActionUrl}" style="display: inline-block; padding: 12px 18px; background-color: #111827; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 15px;">Open Zenin</a>
      </div>

      <p style="font-size: 13px; line-height: 1.5; color: #666666; margin-bottom: 20px;">
        You received this because email notifications are enabled for this Zenin workspace.
      </p>

      <hr style="border: 0; border-top: 1px solid #eeeeee; margin: 24px 0;">

      <p style="font-size: 12px; color: #999999; text-align: center; margin: 0;">
        &copy; ${new Date().getFullYear()} Zenin Capital. All rights reserved.
      </p>
    </div>
  `;

  try {
    const { data, error } = await client.emails.send({
      from: SMTP_FROM,
      to: email,
      subject,
      html: htmlContent,
      text: `${title}\n\n${body}\n\nOpen Zenin: ${actionUrl}`,
      tags: [
        { name: "zenin_type", value: type }
      ],
    });

    if (error) {
      console.error(`[Email] Resend error sending alert to ${email}:`, error);
      return buildDeliveryResult({ sent: false, error });
    }

    console.log(`[Email] Sent ${type} alert to ${email} (id: ${data.id})`);
    return buildDeliveryResult({ sent: true, providerMessageId: data?.id || null });
  } catch (err) {
    console.error(`[Email] Unexpected error sending alert to ${email}:`, err);
    return buildDeliveryResult({ sent: false, error: err });
  }
}

module.exports = {
  getEmailDeliveryConfig,
  isEmailDeliveryProductionReady,
  sendAlertEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
};
