try {
  const { Authenticator } = require("otplib/authenticator");
  console.log("Successfully loaded Authenticator from otplib/authenticator");
  const authenticator = new Authenticator();
  console.log("Successfully created Authenticator instance");
} catch (err) {
  console.error("Failed to load Authenticator:", err);
}
