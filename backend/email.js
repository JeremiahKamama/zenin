const { Resend } = require("resend");

/**
 * Centralized email service for Zenin using Resend.
 * https://resend.com/docs/introduction
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SMTP_FROM = process.env.SMTP_FROM || "Zenin Capital <onboarding@resend.dev>";

// Detect placeholder / unconfigured key
const RESEND_CONFIGURED =
  RESEND_API_KEY &&
  RESEND_API_KEY.startsWith("re_") &&
  RESEND_API_KEY !== "re_your_api_key";

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
  const resetLink = `${frontendUrl}/auth?mode=forgot&token=${resetToken}`;

  const client = getResendClient();

  // --- Dev fallback: no Resend key ---
  if (!client) {
    console.warn("[Email] RESEND_API_KEY missing or placeholder — falling back to console log.");
    logDevResetLink(email, resetLink);
    return false; // return false so callers know real email wasn't sent
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
        <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background-color: #0066ff; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Reset Password</a>
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
    });

    if (error) {
      console.error(`[Email] Resend error sending to ${email}:`, error);
      // Still log the link as a fallback so nothing is totally lost
      logDevResetLink(email, resetLink);
      return false;
    }

    console.log(`[Email] Sent to ${email} via Resend (id: ${data.id})`);
    return true;
  } catch (err) {
    console.error(`[Email] Unexpected error sending to ${email}:`, err);
    logDevResetLink(email, resetLink);
    return false;
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

  // --- Dev fallback: no Resend key ---
  if (!client) {
    console.warn("[Email] RESEND_API_KEY missing or placeholder — falling back to console log.");
    console.log("\n" + "=".repeat(70));
    console.log("[DEV] Verification email NOT sent (Resend not configured).");
    console.log(`[DEV] Recipient: ${email}`);
    console.log(`[DEV] Code     : ${code}`);
    console.log("=".repeat(70) + "\n");
    return false;
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
          ${code}
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
    });

    if (error) {
      console.error(`[Email] Resend error sending to ${email}:`, error);
      return false;
    }

    console.log(`[Email] Sent verification to ${email} (id: ${data.id})`);
    return true;
  } catch (err) {
    console.error(`[Email] Unexpected error sending verification to ${email}:`, err);
    return false;
  }
}

module.exports = {
  sendPasswordResetEmail,
  sendVerificationEmail,
};
