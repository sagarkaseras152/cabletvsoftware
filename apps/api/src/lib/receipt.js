export function createReceiptNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const sequence = String(Math.floor(Math.random() * 900) + 100);
  return `RCPT-${date}-${sequence}`;
}
