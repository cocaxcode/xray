import { Command } from 'commander';
import { createServer as createNetServer } from 'node:net';
import { installHooks, uninstallHooks, isXrayConfigured, getHookEventList } from './setup/hooks-installer.js';
import { startServer } from './index.js';
import { createInterface } from 'node:readline';

const VERSION = '0.1.0';

function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

async function askConfirmation(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith('y') || answer.toLowerCase().startsWith('s'));
    });
  });
}

export function createCli(): Command {
  const program = new Command();

  program
    .name('cxc-xray')
    .description('Dashboard en tiempo real para sesiones de Claude Code')
    .version(VERSION);

  // Default command: start server
  program
    .option('-p, --port <number>', 'Puerto del servidor', '3333')
    .option('--expose', 'Escuchar en 0.0.0.0 (acceso remoto)')
    .option('--auth-token <token>', 'Token de autenticacion custom (modo expose)')
    .option('--no-open', 'No abrir el browser automaticamente')
    .action(async (options) => {
      const port = parseInt(options.port);

      // Validate expose mode
      // Note: --expose without --auth-token is allowed now (auto-generates token + QR + PIN)

      // Check port
      const available = await checkPortAvailable(port);
      if (!available) {
        console.error(`\n  Error: Puerto ${port} en uso. Usa --port para elegir otro.\n`);
        process.exit(1);
      }

      // Setup hooks if needed
      if (!isXrayConfigured(port)) {
        console.log('\n  xray necesita configurar hooks en ~/.claude/settings.json');
        console.log('  Se anadiran hooks HTTP para estos eventos:\n');
        for (const event of getHookEventList()) {
          console.log(`    - ${event}`);
        }
        console.log('');

        const confirmed = await askConfirmation('  Configurar hooks? (y/n): ');
        if (confirmed) {
          const result = installHooks(port);
          console.log(`  ${result.message}\n`);
        } else {
          console.log('  Hooks no configurados. xray funcionara pero no recibira eventos.\n');
        }
      }

      // Start server
      await startServer({
        port,
        expose: !!options.expose,
        authToken: options.authToken,
        noOpen: !options.open,
      });

      // Open browser (unless --no-open or --expose)
      if (options.open && !options.expose) {
        const openModule = await import('open');
        await openModule.default(`http://localhost:${port}`);
      }
    });

  // Setup command
  program
    .command('setup')
    .description('Solo configurar hooks (sin arrancar el servidor)')
    .option('-p, --port <number>', 'Puerto', '3333')
    .action(async (options) => {
      const port = parseInt(options.port);
      const result = installHooks(port);
      console.log(`\n  ${result.message}\n`);
    });

  // Uninstall command
  program
    .command('uninstall')
    .description('Eliminar hooks de xray de ~/.claude/settings.json')
    .option('-p, --port <number>', 'Puerto', '3333')
    .action(async (options) => {
      const port = parseInt(options.port);
      const result = uninstallHooks(port);
      console.log(`\n  ${result.message}\n`);
    });

  // Status command
  program
    .command('status')
    .description('Verificar si xray esta corriendo')
    .option('-p, --port <number>', 'Puerto', '3333')
    .action(async (options) => {
      const port = parseInt(options.port);
      try {
        const res = await fetch(`http://localhost:${port}/api/health`);
        const data = await res.json() as Record<string, unknown>;
        console.log(`\n  xray corriendo en puerto ${port}`);
        console.log(`  Sesiones: ${data.sessions}`);
        console.log(`  Uptime: ${Math.round(data.uptime as number)}s\n`);
      } catch {
        console.log(`\n  xray no esta corriendo (puerto ${port})\n`);
      }
    });

  // PIN rotation command
  program
    .command('pin')
    .description('Generar nuevo PIN de acceso (modo expose)')
    .option('-p, --port <number>', 'Puerto', '3333')
    .action(async (options) => {
      const port = parseInt(options.port);
      try {
        const res = await fetch(`http://localhost:${port}/api/auth/rotate-pin`, { method: 'POST' });
        if (res.ok) {
          const data = await res.json() as { pin: string; expiresIn: string };
          console.log(`\n  Nuevo PIN: ${data.pin} (valido ${data.expiresIn})\n`);
        } else {
          const data = await res.json() as { error: string };
          console.log(`\n  Error: ${data.error}\n`);
        }
      } catch {
        console.log(`\n  xray no esta corriendo (puerto ${port})\n`);
      }
    });

  return program;
}
