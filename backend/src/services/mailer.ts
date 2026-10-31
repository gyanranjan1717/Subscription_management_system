import nodemailer from 'nodemailer';

interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail({ to, subject, text, html }: SendMailOptions): Promise<boolean> {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  // If no SMTP credentials provided, simulated mode is used
  if (!user || !pass || user.includes('your_email') || pass.includes('your_password')) {
    console.log(`[MAILER SIMULATION] To: ${to} | Subject: "${subject}" | Content: ${text.slice(0, 100)}...`);
    return false;
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });

    await transporter.sendMail({
      from: `"Brightloop" <${user}>`,
      to,
      subject,
      text,
      html: html || `<div style="font-family: sans-serif; padding: 20px;"><h2>${subject}</h2><p>${text.replace(/\n/g, '<br/>')}</p></div>`
    });

    console.log(`[MAILER] Real email successfully delivered to ${to}`);
    return true;
  } catch (err: any) {
    console.warn(`[MAILER ERROR] Failed to send real email to ${to}: ${err.message}`);
    return false;
  }
}
