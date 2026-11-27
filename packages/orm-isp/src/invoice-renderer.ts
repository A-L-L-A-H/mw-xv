export interface InvoiceRenderData {
  readonly invoiceId: string;
  readonly companyName: string;
  readonly companyAddress?: string;
  readonly companyTaxId?: string;
  readonly subscriberId: string | number;
  readonly subscriberName: string;
  readonly subscriberAddress?: string;
  readonly billingPeriod: string;
  readonly issueDate: string;
  readonly dueDate: string;
  readonly items: readonly {
    readonly description: string;
    readonly quantity: number;
    readonly unitPriceMinor: number;
    readonly amountMinor: number;
  }[];
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
  readonly currency: string;
  readonly paymentInstructions?: string;
  readonly qrCodeUrl?: string;
}

export function formatCurrency(amountMinor: number, currency = 'IDR'): string {
  if (currency === 'IDR') {
    return `Rp ${amountMinor.toLocaleString('id-ID')}`;
  }
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}

export function renderInvoiceHtml(data: InvoiceRenderData): string {
  const itemsHtml = data.items
    .map(
      (item) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(item.description)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatCurrency(item.unitPriceMinor, data.currency)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatCurrency(item.amountMinor, data.currency)}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Invoice ${escapeHtml(data.invoiceId)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1f2937; margin: 0; padding: 24px; }
    .header { display: flex; justify-content: space-between; margin-bottom: 24px; border-bottom: 2px solid #3b82f6; padding-bottom: 16px; }
    .invoice-title { font-size: 24px; font-weight: bold; color: #1e3a8a; }
    .details { display: flex; justify-content: space-between; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th { background: #f3f4f6; padding: 8px; text-align: left; border-bottom: 2px solid #e5e7eb; }
    .summary { width: 300px; margin-left: auto; margin-bottom: 24px; }
    .summary-row { display: flex; justify-content: space-between; padding: 4px 0; }
    .total-row { font-weight: bold; font-size: 18px; border-top: 2px solid #1f2937; padding-top: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="invoice-title">TAGIHAN / INVOICE</div>
      <div><strong>${escapeHtml(data.companyName)}</strong></div>
      ${data.companyAddress ? `<div>${escapeHtml(data.companyAddress)}</div>` : ''}
      ${data.companyTaxId ? `<div>NPWP: ${escapeHtml(data.companyTaxId)}</div>` : ''}
    </div>
    <div style="text-align: right;">
      <div><strong>No. Invoice:</strong> ${escapeHtml(data.invoiceId)}</div>
      <div><strong>Tanggal Terbit:</strong> ${escapeHtml(data.issueDate)}</div>
      <div><strong>Jatuh Tempo:</strong> ${escapeHtml(data.dueDate)}</div>
      <div><strong>Periode:</strong> ${escapeHtml(data.billingPeriod)}</div>
    </div>
  </div>

  <div class="details">
    <div>
      <div><strong>Kepada Yth:</strong></div>
      <div>${escapeHtml(data.subscriberName)} (ID: ${escapeHtml(String(data.subscriberId))})</div>
      ${data.subscriberAddress ? `<div>${escapeHtml(data.subscriberAddress)}</div>` : ''}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Deskripsi Layanan</th>
        <th style="text-align: center;">Jumlah</th>
        <th style="text-align: right;">Harga Satuan</th>
        <th style="text-align: right;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
    </tbody>
  </table>

  <div class="summary">
    <div class="summary-row">
      <span>Subtotal:</span>
      <span>${formatCurrency(data.subtotalMinor, data.currency)}</span>
    </div>
    <div class="summary-row">
      <span>PPN:</span>
      <span>${formatCurrency(data.taxMinor, data.currency)}</span>
    </div>
    <div class="summary-row total-row">
      <span>Total Tagihan:</span>
      <span>${formatCurrency(data.totalMinor, data.currency)}</span>
    </div>
  </div>

  ${
    data.paymentInstructions
      ? `<div style="background: #f9fafb; padding: 12px; border-radius: 6px; margin-top: 16px;">
          <strong>Petunjuk Pembayaran:</strong>
          <div>${escapeHtml(data.paymentInstructions)}</div>
        </div>`
      : ''
  }
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
