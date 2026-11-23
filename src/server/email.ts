/** SMTP via nodemailer. Set SMTP_URL (smtps://user:pass@host:465) and MAIL_FROM. */

import nodemailer from "nodemailer";

export const emailConfigured = () => !!process.env.SMTP_URL && !!process.env.MAIL_FROM;

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  if (!emailConfigured()) throw new Error("SMTP_URL and MAIL_FROM are not set");
  const transport = nodemailer.createTransport(process.env.SMTP_URL!);
  await transport.sendMail({ from: process.env.MAIL_FROM, to, subject, html });
}
