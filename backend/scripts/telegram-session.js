const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { createInterface } = require("readline/promises");
const { stdin, stdout } = require("process");

async function main() {
  const apiId = Number(process.env.TELEGRAM_API_ID || 0);
  const apiHash = String(process.env.TELEGRAM_API_HASH || "").trim();

  if (!Number.isFinite(apiId) || apiId <= 0 || !apiHash) {
    console.error("Set TELEGRAM_API_ID and TELEGRAM_API_HASH first.");
    process.exit(1);
  }

  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5
  });
  const rl = createInterface({ input: stdin, output: stdout });
  const ask = async (prompt) => String(await rl.question(prompt)).trim();

  await client.start({
    phoneNumber: async () => ask("Phone number (+countrycode...): "),
    password: async () => ask("2FA password (if enabled): "),
    phoneCode: async () => ask("Login code: "),
    onError: (err) => console.error("Telegram auth error:", err?.message || err)
  });

  const session = client.session.save();
  console.log("\nTELEGRAM_SESSION_STRING=");
  console.log(session);
  rl.close();
  await client.disconnect();
}

main().catch((error) => {
  console.error("Failed to generate Telegram session:", error?.message || error);
  process.exit(1);
});
