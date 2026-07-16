import { register } from '../router.js';
import * as core from '../../core/session_init.js';

register('session-init', {
  description: 'Make sure the ICT Concepts + Doji Scanner indicator is on the chart, the symbol matches rules.json, and the cloud-saved script matches the repo copy — run this at the start of a session',
  options: {
    symbol: { type: 'string', short: 's', description: 'Symbol to enforce (default: rules.json watchlist[0], falls back to OANDA:GBPUSD)' },
    'dry-run': { type: 'boolean', description: 'Report what would change without changing anything' },
  },
  handler: (opts) => core.ensureIndicators({ symbol: opts.symbol, dry_run: opts['dry-run'] }),
});
