const { Resend } = require("resend");

/**
 * Centralized email service for Zenin using Resend.
 * https://resend.com/docs/introduction
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SMTP_FROM = process.env.SMTP_FROM || "Zenin Capital <onboarding@resend.dev>";

// Initialize Resend client
let resend = null;

function getResendClient() {
  if (resend) return resend;

  if (!RESEND_API_KEY) {
    console.warn("Email service: RESEND_API_KEY missing. Emails will not be sent.");
    return null;
  }

  resend = new Resend(RESEND_API_KEY);
  return resend;
}

/**
 * Sends a password reset email to a user.
 * @param {string} email - Recipient email address
 * @param {string} resetToken - The raw reset token (not hashed)
 */
async function sendPasswordResetEmail(email, resetToken) {
  const client = getResendClient();
  if (!client) {
    console.error(`Failed to send reset email to ${email}: Resend not configured.`);
    return false;
  }

  const frontendUrl = (process.env.FRONTEND_URL || "https://www.zenin.capital").replace(/\/+$/, "");
  const resetLink = `${frontendUrl}/auth?mode=forgot&token=${resetToken}`;

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
      console.error(`Resend error sending to ${email}:`, error);
      return false;
    }

    console.log(`Email sent to ${email} via Resend: ${data.id}`);
    return true;
  } catch (error) {
    console.error(`Unexpected error sending email to ${email}:`, error);
    return false;
  }
}

module.exports = {
  sendPasswordResetEmail,
};
