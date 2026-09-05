import QRCode from "qrcode";

export const renderLoginQr = async (
  url: string,
  expires: Date
): Promise<string> => {
  const code = await QRCode.toString(url, { small: true, type: "terminal" });
  return `\nIn Telegram on your phone: Settings > Devices > Link Desktop Device.\nScan the newest QR code below. It refreshes automatically (expires ${expires.toISOString()}).\n\n${code}\n`;
};
