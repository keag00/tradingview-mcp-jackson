import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/session_init.js';

export function registerSessionInitTools(server) {
  server.tool('session_ensure_indicators', 'Run at the start of a TradingView session: verifies the CDP connection, re-asserts the expected chart symbol (TradingView Desktop can silently revert it across a relaunch), adds the ICT Concepts + Doji Scanner indicator to the chart if it is missing, and checks the cloud-saved script for drift against the repo copy (pushing the repo version if they differ).', {
    symbol: z.string().optional().describe('Symbol to enforce (default: rules.json watchlist[0], falls back to OANDA:GBPUSD)'),
    dry_run: z.boolean().optional().describe('Report what would change without changing anything'),
  }, async ({ symbol, dry_run }) => {
    try { return jsonResult(await core.ensureIndicators({ symbol, dry_run })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
