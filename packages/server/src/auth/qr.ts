import qrcode from 'qrcode-terminal';

/**
 * Muestra el QR code, PIN y URL en la terminal
 */
export function displayAuthInfo(url: string, pin: string, token: string): void {
  const authUrl = `${url}?auth=${token}`;

  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║                                                  ║');
  console.log(`  ║  xray en modo remoto                             ║`);
  console.log('  ║                                                  ║');

  // QR en terminal
  qrcode.generate(authUrl, { small: true }, (qr: string) => {
    const lines = qr.split('\n');
    for (const line of lines) {
      console.log(`  ║  ${line.padEnd(48)}║`);
    }

    console.log('  ║                                                  ║');
    console.log(`  ║  PIN: ${pin}     (valido 5 minutos)            ║`);
    console.log('  ║                                                  ║');
    console.log(`  ║  URL: ${url.padEnd(42)}║`);
    console.log('  ║                                                  ║');
    console.log('  ║  Escanea el QR o introduce el PIN en el movil    ║');
    console.log('  ║                                                  ║');
    console.log('  ╚══════════════════════════════════════════════════╝');
    console.log('');
  });
}
