import nodemailer from "nodemailer";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

async function testSmtp() {
  const config = {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  };

  console.log("--- SMTP Test Configuration ---");
  console.log(`Host: ${config.host}`);
  console.log(`Port: ${config.port}`);
  console.log(`User: ${config.user}`);
  console.log(`Pass: ${config.pass ? "**** (Set)" : "MISSING"}`);
  console.log("-------------------------------\n");

  if (!config.host || !config.user || !config.pass) {
    console.error("❌ ERROR: Missing required environment variables (SMTP_HOST, SMTP_USER, SMTP_PASS)");
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  try {
    console.log("⏳ Verifying connection...");
    await transporter.verify();
    console.log("✅ SUCCESS: SMTP connection verified!");

    console.log("⏳ Sending test email...");
    const info = await transporter.sendMail({
      from: `"SMTP Tester" <${config.user}>`,
      to: config.user, // Send to self
      subject: "RoadSense AI - SMTP Test Success",
      text: "If you are reading this, your SMTP configuration is working perfectly!",
    });

    console.log(`✅ SUCCESS: Test email sent! Message ID: ${info.messageId}`);
  } catch (error: any) {
    console.error("❌ FAILED: SMTP Error occurred");
    console.error(`Error Code: ${error.code}`);
    console.error(`Response: ${error.response}`);
    console.error(`Message: ${error.message}`);
    
    if (error.message.includes("Invalid login") || error.message.includes("Authentication failed")) {
      console.log("\n💡 TROUBLESHOOTING TIP: This usually means your App Password is wrong or expired.");
    }
  }
}

testSmtp();
