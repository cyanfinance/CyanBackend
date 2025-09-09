const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

async function generatePaymentReceiptPDF({
  customerName,
  paymentAmount,
  totalPaid,
  totalLoan,
  toBePaid,
  paymentDate,
  loanId,
  enteredBy,
  logoPath,
  forCustomer = false
}) {
  return new Promise((resolve, reject) => {
    // Compact receipt size: 80mm x 150mm (1pt = 1/72in, 80mm ≈ 226pt, 150mm ≈ 425pt)
    const doc = new PDFDocument({
      size: [550, 400],
      margins: { top: 16, bottom: 16, left: 16, right: 16 }
    });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);
      resolve(pdfData);
    });

    // Border
    doc
      .rect(8, 8, doc.page.width - 16, doc.page.height - 16)
      .strokeColor('#b58900')
      .lineWidth(1.5)
      .stroke();

    // Logo
    if (logoPath && fs.existsSync(logoPath)) {
      doc.image(logoPath, doc.page.width / 2 - 30, 20, { width: 60 });
    }
    doc.moveDown(4);

    // Title
    doc
      .fontSize(15)
      .fillColor('#b58900')
      .font('Helvetica-Bold')
      .text('Payment Receipt', { align: 'center' });
    doc.moveDown(0.5);

    // Office details
    doc
      .fontSize(8)
      .fillColor('#333')
      .font('Helvetica')
      .text('Cyan Finance', { align: 'center' })
      .text('BK Towers, Akkayyapalem, Visakhapatnam, Andhra Pradesh-530016.', { align: 'center' })
      .text('Phone: +91-9700049444', { align: 'center' })
      .text('Email: support@cyanfinance.in', { align: 'center' });
    doc.moveDown(4);

    // Table for all details in 2 rows and 8 columns
    const tableTop = doc.y;
    const tableLeft = 30;
    const colCount = 7;
    const rowHeight = 30;
    const colWidths = [55, 65, 80, 70, 60, 90, 60]; // Last col for Entered By
    const tableWidth = colWidths.reduce((a, b) => a + b, 0);

    // Table data
    const labels = [
      'Date',
      'Receipt No',
      'Customer Name',
      'Payment Amount',
      'Total Paid',
      'Total Loan Amount',
      'To Be Paid',
      // 'Entered By'
    ];
    const values = [
      paymentDate,
      loanId,
      customerName,
      `INR ${Math.round(paymentAmount)}`,
      `INR ${Math.round(totalPaid)}`,
      `INR ${Math.round(totalLoan)}`,
      `INR ${Math.round(toBePaid)}`,
      // enteredBy ? `${enteredBy.name} (${enteredBy.id})` : ''
    ];

    // Draw table border
    doc.rect(tableLeft, tableTop, tableWidth, rowHeight * 2).strokeColor('#b58900').lineWidth(1).stroke();

    // Draw vertical lines
    let x = tableLeft;
    for (let i = 0; i < colCount; i++) {
      if (i > 0) {
        doc.moveTo(x, tableTop).lineTo(x, tableTop + rowHeight * 2).strokeColor('#b58900').stroke();
      }
      x += colWidths[i];
    }
    // Draw horizontal line between rows
    doc.moveTo(tableLeft, tableTop + rowHeight).lineTo(tableLeft + tableWidth, tableTop + rowHeight).strokeColor('#b58900').stroke();

    // Fill in labels (header row)
    x = tableLeft;
    for (let i = 0; i < colCount; i++) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#b58900')
        .text(labels[i], x + 2, tableTop + 5, { width: colWidths[i] - 4, align: 'center' });
      x += colWidths[i];
    }
    // Fill in values (second row)
    x = tableLeft;
    for (let i = 0; i < colCount; i++) {
      doc.font('Helvetica').fontSize(9).fillColor('#222')
        .text(values[i], x + 2, tableTop + rowHeight + 5, { width: colWidths[i] - 4, align: 'center' });
      x += colWidths[i];
    }
    doc.moveDown(3);

    // Thank you (centered at bottom)
    doc.fontSize(11)
      .fillColor('#388e3c')
      .font('Helvetica-Bold')
      .text('Thank you for your payment!', 0, doc.page.height - 80, { align: 'center' });

    // Conditional footer at bottom right
    doc.fontSize(10)
      .fillColor('#333')
      .font('Helvetica-Oblique')
      .text(
        forCustomer ? 'System generated, no sign required' : 'Sign & Stamp',
        doc.page.width - 310,
        doc.page.height - 50,
        { align: 'right' }
      );

    doc.end();
  });
}

module.exports = { generatePaymentReceiptPDF }; 