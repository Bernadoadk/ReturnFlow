import nodemailer from "nodemailer";
import { EMAIL_TEMPLATES } from "../components/mock-data";
import prisma from "../db.server";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_PORT === "465",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendReturnEmail(
  type: "Request Received" | "Approved" | "Rejected" | "Refunded" | "Shipped" | "Expired",
  data: {
    to: string;
    shop?: string;
    fromEmail?: string;
    customer_name: string;
    rma_number: string;
    order_number: string;
    item_count?: string;
    refund_amount?: string;
    rejection_reason?: string;
    carrier?: string;
    tracking_number?: string;
    store_credit_code?: string;
    label_url?: string;
  }
) {
  try {
    // Try to load custom template from DB first
    let subject = "";
    let body = "";

    if (data.shop) {
      const dbTemplate = await prisma.emailTemplate.findUnique({
        where: { shop_type: { shop: data.shop, type } }
      });
      if (dbTemplate) {
        subject = dbTemplate.subject;
        body = dbTemplate.body;
      }
    }

    // Fallback to built-in templates
    if (!subject || !body) {
      const template = EMAIL_TEMPLATES[type];
      if (!template) throw new Error("Template not found for type: " + type);
      subject = template.subject;
      body = template.body;
    }

    const storeCreditBlock = data.store_credit_code
      ? `\n\nYour store credit code: ${data.store_credit_code}\nUse it at checkout — it's already loaded for $${data.refund_amount || ''}.`
      : "";

    const labelBlock = data.label_url
      ? `\n\nDownload your prepaid shipping label: ${data.label_url}`
      : "";

    const fill = (s: string) => s
      .replace(/\{\{customer_name\}\}/g, data.customer_name)
      .replace(/\{\{rma_number\}\}/g, data.rma_number)
      .replace(/\{\{order_number\}\}/g, data.order_number)
      .replace(/\{\{item_count\}\}/g, data.item_count || "")
      .replace(/\{\{refund_amount\}\}/g, data.refund_amount || "")
      .replace(/\{\{rejection_reason\}\}/g, data.rejection_reason || "")
      .replace(/\{\{carrier\}\}/g, data.carrier || "N/A")
      .replace(/\{\{tracking_number\}\}/g, data.tracking_number || "N/A")
      .replace(/\{\{store_credit_code\}\}/g, data.store_credit_code || "")
      .replace(/\{\{label_url\}\}/g, data.label_url || "")
      + (type === "Approved" && data.label_url ? labelBlock : "")
      + (type === "Refunded" && data.store_credit_code ? storeCreditBlock : "");

    const from = data.fromEmail
      ? `"${process.env.SMTP_FROM_NAME || "ReturnFlow"}" <${data.fromEmail}>`
      : `"${process.env.SMTP_FROM_NAME || "ReturnFlow"}" <${process.env.SMTP_USER}>`;

    const info = await transporter.sendMail({
      from,
      to: data.to,
      subject: fill(subject),
      text: fill(body),
    });

    console.log("Email sent: %s", info.messageId);
    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
}
