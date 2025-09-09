const axios = require('axios');

const sendBrevoEmail = async ({ to, subject, html }) => {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail=process.env.EMAIL_FROM;
  if (!apiKey) throw new Error('Missing BREVO_API_KEY');

  const data = {
    sender: { name: 'Cyan Finance', email: senderEmail },
    to: [{ email: to }],
    subject,
    htmlContent: html
  };

  await axios.post('https://api.brevo.com/v3/smtp/email', data, {
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'accept': 'application/json'
    }
  });
};

// Function to send payment reminder emails
const sendPaymentReminderEmail = async ({ 
  to, 
  name, 
  loanId, 
  amount, 
  dueDate, 
  daysUntilDue = 0,
  isOverdue = false,
  daysOverdue = 0,
  totalPaid,
  remainingBalance,
  installmentNumber,
  totalInstallments
}) => {
  const subject = isOverdue 
    ? `Payment Overdue - Loan ${loanId} - ${daysOverdue} days overdue`
    : daysUntilDue === 0 
    ? `Payment Due Today - Loan ${loanId}`
    : `Payment Reminder - Loan ${loanId} - Due in ${daysUntilDue} days`;

  const urgencyClass = isOverdue ? 'red' : daysUntilDue <= 1 ? 'orange' : 'blue';
  const urgencyText = isOverdue ? 'URGENT' : daysUntilDue <= 1 ? 'DUE SOON' : 'REMINDER';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payment Reminder - Cyan Finance</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; padding: 20px 0; border-bottom: 2px solid #b58900; }
        .logo { color: #b58900; font-size: 24px; font-weight: bold; margin-bottom: 10px; }
        .urgency-badge { 
          display: inline-block; 
          padding: 8px 16px; 
          border-radius: 20px; 
          color: white; 
          font-weight: bold; 
          font-size: 14px;
          margin-bottom: 20px;
        }
        .urgency-red { background-color: #dc2626; }
        .urgency-orange { background-color: #ea580c; }
        .urgency-blue { background-color: #2563eb; }
        .payment-details { 
          background-color: #f8fafc; 
          padding: 20px; 
          border-radius: 8px; 
          margin: 20px 0; 
          border-left: 4px solid #b58900;
        }
        .amount { font-size: 24px; font-weight: bold; color: #dc2626; }
        .due-date { font-size: 18px; font-weight: bold; color: #ea580c; }
        .loan-info { 
          background-color: #f1f5f9; 
          padding: 15px; 
          border-radius: 6px; 
          margin: 15px 0;
        }
        .contact-info { 
          background-color: #f0fdf4; 
          padding: 15px; 
          border-radius: 6px; 
          margin: 15px 0;
          border-left: 4px solid #16a34a;
        }
        .footer { 
          text-align: center; 
          margin-top: 30px; 
          padding-top: 20px; 
          border-top: 1px solid #e5e7eb; 
          color: #6b7280; 
          font-size: 14px;
        }
        .button { 
          display: inline-block; 
          background-color: #b58900; 
          color: white; 
          padding: 12px 24px; 
          text-decoration: none; 
          border-radius: 6px; 
          font-weight: bold;
          margin: 10px 0;
        }
        .warning { 
          background-color: #fef2f2; 
          border: 1px solid #fecaca; 
          color: #dc2626; 
          padding: 15px; 
          border-radius: 6px; 
          margin: 15px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">Cyan Finance</div>
          <div>BK Towers, Akkayyapalem, Visakhapatnam, Andhra Pradesh-530016</div>
          <div>Phone: +91-9700049444 | Email: support@cyanfinance.in</div>
        </div>

        <div class="urgency-badge urgency-${urgencyClass}">${urgencyText}</div>

        <h2>Dear ${name},</h2>

        ${isOverdue ? `
          <div class="warning">
            <strong>⚠️ URGENT: Your payment is ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue!</strong><br>
            Please make your payment immediately to avoid any additional charges or penalties.
          </div>
        ` : daysUntilDue === 0 ? `
          <div class="warning">
            <strong>📅 Your payment is due TODAY!</strong><br>
            Please ensure your payment is made today to avoid any late fees.
          </div>
        ` : `
          <p>This is a friendly reminder about your upcoming loan payment.</p>
        `}

        <div class="payment-details">
          <h3>Payment Details</h3>
          <div class="amount">₹${amount.toLocaleString()}</div>
          <div class="due-date">Due Date: ${new Date(dueDate).toLocaleDateString('en-IN', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          })}</div>
          ${isOverdue ? `<div style="color: #dc2626; font-weight: bold;">Days Overdue: ${daysOverdue}</div>` : ''}
        </div>

        <div class="loan-info">
          <h4>Loan Information</h4>
          <ul>
            <li><strong>Loan ID:</strong> ${loanId}</li>
            <li><strong>Installment:</strong> ${installmentNumber} of ${totalInstallments}</li>
            <li><strong>Total Paid:</strong> ₹${totalPaid.toLocaleString()}</li>
            <li><strong>Remaining Balance:</strong> ₹${remainingBalance.toLocaleString()}</li>
          </ul>
        </div>

        <div class="contact-info">
          <h4>Payment Methods</h4>
          <p>You can make your payment through:</p>
          <ul>
            <li><strong>Cash Payment:</strong> Visit our office during business hours</li>
            <li><strong>Online Transfer:</strong> Use the following details:</li>
          </ul>
          <p><strong>Bank Details:</strong><br>
          Account Name: Cyan Finance<br>
          Account Number: [Your Account Number]<br>
          IFSC Code: [Your IFSC Code]<br>
          Bank Name: [Your Bank Name]</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="tel:+919700049444" class="button">Call Us Now</a>
          <a href="mailto:support@cyanfinance.in" class="button">Email Support</a>
        </div>

        <p><strong>Important Notes:</strong></p>
        <ul>
          <li>Please include your Loan ID (${loanId}) in the payment reference</li>
          <li>Keep the payment receipt for your records</li>
          <li>Contact us immediately if you have any payment issues</li>
          ${isOverdue ? '<li>Late payments may incur additional charges</li>' : ''}
        </ul>

        <p>Thank you for choosing Cyan Finance. We appreciate your business!</p>

        <div class="footer">
          <p><strong>Cyan Finance</strong><br>
          BK Towers, Akkayyapalem, Visakhapatnam, Andhra Pradesh-530016<br>
          Phone: +91-9700049444 | Email: support@cyanfinance.in<br>
          <small>This is an automated reminder. Please do not reply to this email.</small></p>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    await sendBrevoEmail({ to, subject, html });
    console.log(`Payment reminder email sent to ${to} for loan ${loanId}`);
    return true;
  } catch (error) {
    console.error(`Failed to send payment reminder email to ${to} for loan ${loanId}:`, error);
    return false;
  }
};

module.exports = { sendBrevoEmail, sendPaymentReminderEmail }; 